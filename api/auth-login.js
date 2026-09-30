const kvStore = require("../lib/kv");
const { verifyPassword } = require("../lib/password");
const { setSessionCookie, sanitizeUser, getUserFromReq } = require("../lib/auth");
const crypto = require("crypto");
const warga = require("../lib/warga");

const SESSION_TTL_SEC = 12 * 60 * 60;

function redirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.headers.host}/api/auth-login`;
}
function appendCookies(res, ...cookies) { res.setHeader("Set-Cookie", cookies); }

// ====== Login Discord untuk WARGA ======
// Endpoint ini sudah penuh (limit 12 function Vercel Hobby), jadi login Discord
// numpang di sini lewat method GET:
//   GET /api/auth-login?aksi=discord      -> lempar ke halaman izin Discord
//   GET /api/auth-login?code=..&state=..  -> callback dari Discord (Redirect URI)
//   GET /api/auth-login?aksi=warga-me     -> profil warga + papan iklan (JSON)
//   POST /api/auth-login?aksi=warga-logout
async function handleWargaGet(req, res) {
  const q = req.query || {};

  if (q.aksi === "warga-me") {
    let w;
    try { w = await warga.getWargaFromReq(req); }
    catch (err) { return res.status(500).json({ error: "Gagal konek ke database." }); }
    if (!w) return res.status(401).json({ error: "Belum login." });
    let iklan = [];
    try { iklan = await kvStore.getIklan(); } catch (e) { /* iklan opsional */ }
    return res.json({ warga: warga.sanitizeWarga(w), iklan });
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (q.aksi === "discord") {
    if (!clientId || !clientSecret) {
      return res.redirect(302, "/index.html?err=" + encodeURIComponent("Login Discord belum di-setup (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET)."));
    }
    const state = warga.newState();
    appendCookies(res, warga.stateCookie(req, state));
    const url = "https://discord.com/oauth2/authorize?" + new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri(req),
      scope: "identify",
      state,
      prompt: "none", // kalau sudah pernah izinkan, langsung masuk tanpa layar konfirmasi lagi
    }).toString();
    return res.redirect(302, url);
  }

  if (q.code || q.error) {
    const balik = (msg) => {
      appendCookies(res, warga.clearStateCookie(req));
      return res.redirect(302, "/index.html?err=" + encodeURIComponent(msg));
    };
    if (q.error) return balik("Login Discord dibatalkan.");
    const savedState = req.cookies?.[warga.STATE_COOKIE];
    if (!savedState || savedState !== q.state) return balik("Sesi login Discord kedaluwarsa, coba lagi.");
    if (!clientId || !clientSecret) return balik("Login Discord belum di-setup.");

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code: String(q.code),
          redirect_uri: redirectUri(req),
        }),
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok || !token.access_token) throw new Error(token.error_description || token.error || "token ditolak");

      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const dc = await meRes.json();
      if (!meRes.ok || !dc.id) throw new Error("gagal ambil profil Discord");

      const list = await kvStore.getWarga();
      const now = new Date().toISOString();
      let w = list.find((x) => x.discordId === dc.id);
      if (!w) {
        w = { id: crypto.randomBytes(8).toString("hex"), discordId: dc.id, pertamaLogin: now };
        list.push(w);
      }
      w.username = dc.username;
      w.globalName = dc.global_name || null;
      w.avatar = dc.avatar || null;
      w.terakhirLogin = now;
      await kvStore.setWarga(list);

      appendCookies(res, warga.setWargaCookie(req, res, w.id), warga.clearStateCookie(req));
      return res.redirect(302, "/warga.html");
    } catch (err) {
      console.error("[auth-login/discord] gagal:", err.message);
      return balik("Login Discord gagal, coba lagi.");
    }
  }

  return res.status(400).json({ error: "Permintaan tidak dikenal." });
}


// ====== Forum Kritik & Saran ======
// Juga numpang di endpoint ini (limit 12 function). Boleh diakses warga
// (login Discord) DAN anggota (login user/password). Hapus: pemilik konten
// atau High Command.
const MAX_POSTS = 300;
const MAX_KOMENTAR = 200;

async function getForumActor(req) {
  const w = await warga.getWargaFromReq(req);
  if (w) {
    const s = warga.sanitizeWarga(w);
    return { tipe: "warga", id: "w:" + w.id, nama: s.nama, avatar: s.avatar, hc: false };
  }
  const u = await getUserFromReq(req);
  if (u && (u.status || "approved") === "approved") {
    // avatar anggota berupa data-URL besar -> jangan disimpan di forum, pakai inisial
    return { tipe: u.isHighCommand ? "hc" : "anggota", id: "u:" + u.id, nama: u.namaKarakter || u.username, avatar: null, hc: !!u.isHighCommand };
  }
  return null;
}

const potong = (t, n) => String(t == null ? "" : t).trim().slice(0, n);
const penulis = (o) => ({ id: o.id, penulisNama: o.penulisNama, penulisAvatar: o.penulisAvatar || null, penulisTipe: o.penulisTipe, tanggal: o.tanggal });

async function handleForum(req, res, aksi) {
  let actor;
  try { actor = await getForumActor(req); }
  catch (err) { return res.status(500).json({ error: "Gagal konek ke database." }); }
  if (!actor) return res.status(401).json({ error: "Belum login." });

  const q = req.query || {};
  const body = req.body || {};
  const forum = await kvStore.getForum();
  const bolehHapus = (item) => actor.hc || item.penulisId === actor.id;

  if (aksi === "forum-list" && req.method === "GET") {
    const posts = forum
      .map((p) => ({
        id: p.id, jenis: p.jenis, judul: p.judul,
        cuplikan: p.isi.slice(0, 140),
        ...penulis(p),
        jumlahKomentar: (p.komentar || []).length,
        terakhir: p.terakhir || p.tanggal,
        bolehHapus: bolehHapus(p),
      }))
      .sort((a, b) => b.terakhir.localeCompare(a.terakhir));
    return res.json({ peran: actor.tipe, posts });
  }

  if (aksi === "forum-post" && req.method === "GET") {
    const p = forum.find((x) => x.id === q.id);
    if (!p) return res.status(404).json({ error: "Postingan tidak ditemukan." });
    return res.json({
      peran: actor.tipe,
      post: {
        id: p.id, jenis: p.jenis, judul: p.judul, isi: p.isi, ...penulis(p), bolehHapus: bolehHapus(p),
        komentar: (p.komentar || []).map((k) => ({ ...penulis(k), isi: k.isi, bolehHapus: bolehHapus(k) })),
      },
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });
  const sekarang = new Date().toISOString();
  const jeda = (iso, detik) => iso && Date.now() - new Date(iso).getTime() < detik * 1000;

  if (aksi === "forum-buat") {
    const jenis = body.jenis === "kritik" ? "kritik" : body.jenis === "saran" ? "saran" : null;
    const judul = potong(body.judul, 100);
    const isi = potong(body.isi, 2000);
    if (!jenis) return res.status(400).json({ error: "Pilih jenis: Kritik atau Saran." });
    if (judul.length < 3) return res.status(400).json({ error: "Judul minimal 3 karakter." });
    if (isi.length < 5) return res.status(400).json({ error: "Isi minimal 5 karakter." });
    const terakhirSaya = forum.filter((p) => p.penulisId === actor.id).map((p) => p.tanggal).sort().pop();
    if (jeda(terakhirSaya, 30)) return res.status(429).json({ error: "Tunggu sebentar sebelum membuat postingan lagi." });

    const post = {
      id: crypto.randomBytes(6).toString("hex"), jenis, judul, isi,
      penulisId: actor.id, penulisNama: actor.nama, penulisAvatar: actor.avatar, penulisTipe: actor.tipe,
      tanggal: sekarang, terakhir: sekarang, komentar: [],
    };
    forum.push(post);
    while (forum.length > MAX_POSTS) forum.shift();
    await kvStore.setForum(forum);
    return res.json({ ok: true, id: post.id });
  }

  if (aksi === "forum-komen") {
    const p = forum.find((x) => x.id === body.id);
    if (!p) return res.status(404).json({ error: "Postingan tidak ditemukan." });
    const isi = potong(body.isi, 500);
    if (!isi) return res.status(400).json({ error: "Komentar tidak boleh kosong." });
    p.komentar = p.komentar || [];
    if (p.komentar.length >= MAX_KOMENTAR) return res.status(400).json({ error: "Komentar di postingan ini sudah penuh." });
    const terakhirSaya = p.komentar.filter((k) => k.penulisId === actor.id).map((k) => k.tanggal).sort().pop();
    if (jeda(terakhirSaya, 5)) return res.status(429).json({ error: "Pelan-pelan, tunggu beberapa detik." });
    p.komentar.push({
      id: crypto.randomBytes(6).toString("hex"), isi,
      penulisId: actor.id, penulisNama: actor.nama, penulisAvatar: actor.avatar, penulisTipe: actor.tipe, tanggal: sekarang,
    });
    p.terakhir = sekarang;
    await kvStore.setForum(forum);
    return res.json({ ok: true });
  }

  if (aksi === "forum-hapus") {
    const idx = forum.findIndex((x) => x.id === body.id);
    if (idx === -1) return res.status(404).json({ error: "Postingan tidak ditemukan." });
    const p = forum[idx];
    if (body.komentarId) {
      const kIdx = (p.komentar || []).findIndex((k) => k.id === body.komentarId);
      if (kIdx === -1) return res.status(404).json({ error: "Komentar tidak ditemukan." });
      if (!bolehHapus(p.komentar[kIdx])) return res.status(403).json({ error: "Kamu tidak boleh menghapus komentar ini." });
      p.komentar.splice(kIdx, 1);
    } else {
      if (!bolehHapus(p)) return res.status(403).json({ error: "Kamu tidak boleh menghapus postingan ini." });
      forum.splice(idx, 1);
    }
    await kvStore.setForum(forum);
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: "Aksi tidak dikenal." });
}

module.exports = async (req, res) => {
  const aksi = req.query && req.query.aksi;
  if (typeof aksi === "string" && aksi.startsWith("forum-")) return handleForum(req, res, aksi);

  // Warga (login Discord)
  if (req.method === "GET") return handleWargaGet(req, res);
  if (req.method === "POST" && req.query && req.query.aksi === "warga-logout") {
    appendCookies(res, warga.clearWargaCookie(req));
    return res.json({ ok: true });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  // Anggota (username + password). Pendaftaran mandiri sudah DIHAPUS —
  // akun anggota cuma dibuat High Command (Panel Rekap / bot Discord).
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username & password wajib diisi." });

  let users;
  try {
    users = await kvStore.getUsers();
  } catch (err) {
    console.error("[auth-login] gagal konek Upstash:", err.message);
    return res.status(500).json({ error: "Gagal konek ke database — cek UPSTASH_REDIS_REST_URL/TOKEN di Environment Variables." });
  }

  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  if (user.status === "pending") {
    return res.status(403).json({ error: "Akun kamu masih menunggu approval High Command." });
  }
  if (user.status === "ditolak") {
    return res.status(403).json({ error: "Akun kamu ditolak. Hubungi Perwira Tinggi." });
  }

  try {
    setSessionCookie(res, user.id, SESSION_TTL_SEC);
  } catch (err) {
    console.error("[auth-login] gagal buat sesi:", err.message);
    return res.status(500).json({ error: "Gagal membuat sesi login — cek SESSION_SECRET sudah diisi." });
  }

  res.json({ ok: true, user: sanitizeUser(user) });
};
