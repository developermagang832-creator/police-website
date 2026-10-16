const crypto = require("crypto");
const kvStore = require("../lib/kv");
const session = require("../lib/session");
const { hashPassword, verifyPassword } = require("../lib/password");
const { setSessionCookie, sanitizeUser } = require("../lib/auth");
const { PANGKAT_LIST, PANGKAT_AUTO_HC } = require("../lib/pangkat");
const { jakartaTodayISO } = require("../lib/waktu");
const { notifyPendaftaranBaru } = require("../lib/discord");
const { kirimDetailAkun } = require("../lib/mailer");
const notif = require("../lib/notif");

const SESSION_TTL_SEC = 12 * 60 * 60;
const RESET_TTL_MENIT = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

// Satu endpoint ini dipakai buat 4 hal (limit 12 function Vercel Hobby):
//   POST { username, password }                          -> login
//   POST { daftar: true, username, email, password,
//          namaKarakter, pangkat }                       -> daftar akun baru (pending)
//   POST { lupa: true, email }                           -> kirim detail akun + link reset ke email
//   POST { reset: true, token, password }                -> set password baru dari link email

const normEmail = (e) => String(e || "").trim().toLowerCase();

// Token reset ditandatangani (tanpa simpan di database). Ikut "sidik jari"
// password lama, jadi otomatis hangus begitu password berhasil diganti.
function sidikPassword(user) {
  return crypto.createHash("sha256").update(String(user.passwordHash || "")).digest("hex").slice(0, 16);
}
function buatTokenReset(user) {
  return session.sign({ t: "reset", userId: user.id, f: sidikPassword(user), exp: Date.now() + RESET_TTL_MENIT * 60 * 1000 });
}
function baseUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  return `${proto}://${req.headers.host}`;
}

async function daftar(req, res, b) {
  const username = String(b.username || "").trim();
  const email = normEmail(b.email);
  const password = String(b.password || "");
  const namaKarakter = String(b.namaKarakter || "").trim().slice(0, 100);
  const pangkat = String(b.pangkat || "");
  const langsungHC = PANGKAT_AUTO_HC.includes(pangkat);

  if (!username || !password || !email) return res.status(400).json({ error: "Username, email & password wajib diisi." });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "Username 3-32 karakter, cuma boleh huruf, angka, titik, strip, dan underscore." });
  if (!EMAIL_RE.test(email) || email.length > 100) return res.status(400).json({ error: "Format email nggak valid." });
  if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
  if (!namaKarakter) return res.status(400).json({ error: "Nama karakter wajib diisi." });
  if (!PANGKAT_LIST.includes(pangkat)) return res.status(400).json({ error: "Pangkat nggak valid." });

  // Pangkat auto-HC nggak lewat approval, jadi kalau KODE_PANGKAT_TINGGI diisi di
  // Environment Variables, pendaftar wajib tahu kodenya (opsional, biar nggak sembarang orang jadi HC).
  if (langsungHC && process.env.KODE_PANGKAT_TINGGI && String(b.kode || "") !== process.env.KODE_PANGKAT_TINGGI) {
    return res.status(403).json({ error: "Kode akses untuk pangkat ini salah." });
  }

  const users = await kvStore.getUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: "Username sudah dipakai." });
  if (users.some((u) => normEmail(u.email) === email)) return res.status(409).json({ error: "Email sudah terdaftar di akun lain." });

  const baru = {
    id: crypto.randomBytes(8).toString("hex"),
    username,
    email,
    passwordHash: hashPassword(password),
    namaKarakter,
    pangkat, // pangkat biasa = pangkat yang DIAJUKAN, baru berlaku setelah di-approve High Command
    isHighCommand: langsungHC, // pangkat paling atas: langsung High Command
    avatar: null,
    status: langsungHC ? "approved" : "pending", // pangkat paling atas: tanpa approval
    bergabung: jakartaTodayISO(),
  };
  users.push(baru);
  await kvStore.setUsers(users);

  // Kabari High Command (Discord + lonceng website). Gagal kirim nggak boleh bikin daftar gagal.
  if (langsungHC) {
    try {
      await notif.kirimKeHC({ tipe: "peringatan", judul: "Akun High Command baru", isi: `${namaKarakter} (${username}) daftar sebagai ${pangkat} dan langsung aktif tanpa approval.`, href: "rekap.html?tab=users" });
    } catch (e) { console.error("[daftar] notif website:", e.message); }
    return res.json({ ok: true, langsung: true });
  }
  try { await notifyPendaftaranBaru(baru); } catch (e) { console.error("[daftar] notif discord:", e.message); }
  try {
    await notif.kirimKeHC({ tipe: "info", judul: "Pendaftaran akun baru", isi: `${namaKarakter} (${username}) daftar sebagai ${pangkat}.`, href: "rekap.html?tab=pendaftaran" });
  } catch (e) { console.error("[daftar] notif website:", e.message); }

  return res.json({ ok: true });
}

async function lupa(req, res, b) {
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Format email nggak valid." });

  // Jawaban selalu sama, ada atau nggak akunnya — biar orang nggak bisa nebak email siapa yang terdaftar.
  const jawab = () => res.json({ ok: true, message: "Kalau email itu terdaftar, detail akun & link atur password baru sudah dikirim. Cek inbox (dan folder Spam)." });

  // Maks 1 permintaan per email tiap 60 detik (anti-spam).
  if (!(await kvStore.ambilSlot("lupa:" + email, 60))) return jawab();

  const users = await kvStore.getUsers();
  const user = users.find((u) => normEmail(u.email) === email);
  if (!user) return jawab();

  try {
    const token = buatTokenReset(user);
    await kirimDetailAkun({
      to: email,
      username: user.username,
      namaKarakter: user.namaKarakter,
      status: user.status || "approved",
      linkReset: `${baseUrl(req)}/reset.html?token=${encodeURIComponent(token)}`,
      menitBerlaku: RESET_TTL_MENIT,
    });
  } catch (err) {
    console.error("[lupa] gagal kirim email:", err.message);
    return res.status(500).json({ error: "Email gagal dikirim. Coba lagi nanti atau hubungi Perwira Tinggi." });
  }
  return jawab();
}

async function reset(req, res, b) {
  const password = String(b.password || "");
  if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });

  let payload;
  try { payload = session.verify(String(b.token || "")); } catch (e) { payload = null; }
  if (!payload || payload.t !== "reset") return res.status(400).json({ error: "Link nggak valid atau sudah kedaluwarsa. Minta link baru dari halaman login." });

  const users = await kvStore.getUsers();
  const target = users.find((u) => u.id === payload.userId);
  if (!target || sidikPassword(target) !== payload.f) return res.status(400).json({ error: "Link sudah dipakai atau nggak valid. Minta link baru dari halaman login." });

  target.passwordHash = hashPassword(password);
  await kvStore.setUsers(users);
  return res.json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });
  const b = req.body || {};

  try {
    if (b.daftar) return await daftar(req, res, b);
    if (b.lupa) return await lupa(req, res, b);
    if (b.reset) return await reset(req, res, b);
  } catch (err) {
    console.error("[auth-login] error:", err.message);
    return res.status(500).json({ error: "Gagal konek ke database — cek UPSTASH_REDIS_REST_URL/TOKEN di Environment Variables." });
  }

  // ====== Login anggota (username + password) ======
  const { username, password } = b;
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
