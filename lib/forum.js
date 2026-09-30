// Forum komunitas (gaya Invision): kategori -> topik -> post, reaksi, kutip,
// pin/kunci/pindah (High Command). Numpang di api/auth-login.js (limit 12 function).
// Redis: forum:index (ringkasan semua topik), forum:t:<id> (post per topik), forum:jumlah (hitungan post per user).
const crypto = require("crypto");
const kv = require("./kv");
const warga = require("./warga");
const { getUserFromReq } = require("./auth");

const KATEGORI = [
  { id: "pengumuman", nama: "Pengumuman", ikon: "📢", desk: "Informasi resmi Kepolisian Nexotis.", hanyaHC: true },
  { id: "saran", nama: "Saran", ikon: "💡", desk: "Ide dan masukan untuk kepolisian." },
  { id: "kritik", nama: "Kritik", ikon: "📣", desk: "Sampaikan keluhan atau evaluasi." },
  { id: "tanya", nama: "Tanya Jawab", ikon: "❓", desk: "Ada yang mau ditanyakan?" },
  { id: "umum", nama: "Obrolan Umum", ikon: "🗨️", desk: "Ngobrol santai antar warga." },
];
const REAKSI = ["suka", "cinta", "haha", "wow", "sedih"];
const PER_TOPIK = 15, PER_POST = 10, MAX_TOPIK = 500, MAX_POST = 300;
const rid = () => crypto.randomBytes(6).toString("hex");
const potong = (t, n) => String(t == null ? "" : t).trim().slice(0, n);
const jeda = (iso, dtk) => iso && Date.now() - new Date(iso).getTime() < dtk * 1000;

async function aktor(req) {
  const w = await warga.getWargaFromReq(req);
  if (w) { const s = warga.sanitizeWarga(w); return { tipe: "warga", id: "w:" + w.id, nama: s.nama, avatar: s.avatar, sejak: w.pertamaLogin, hc: false }; }
  const u = await getUserFromReq(req);
  if (u && (u.status || "approved") === "approved") {
    // avatar anggota = data-URL besar, jangan disimpan di forum -> pakai inisial
    return { tipe: u.isHighCommand ? "hc" : "anggota", id: "u:" + u.id, nama: u.namaKarakter || u.username, avatar: null, sejak: u.bergabung || null, hc: !!u.isHighCommand };
  }
  return null;
}

// Migrasi otomatis dari versi forum lama (1 key nexotis:forum) — sekali saja.
async function getIdx() {
  let idx = await kv.forumGet("index");
  if (idx) return idx;
  idx = [];
  const lama = await kv.getForum();
  for (const p of Array.isArray(lama) ? lama : []) {
    const mk = (x) => ({ id: x.id, isi: x.isi, penulisId: x.penulisId, penulisNama: x.penulisNama, penulisAvatar: x.penulisAvatar || null, penulisTipe: x.penulisTipe, sejak: null, tanggal: x.tanggal, reaksi: {} });
    const posts = [mk(p), ...(p.komentar || []).map(mk)];
    await kv.forumSet("t:" + p.id, { posts });
    const akhir = posts[posts.length - 1];
    idx.push({ id: p.id, kat: p.jenis === "kritik" ? "kritik" : "saran", judul: p.judul, penulisId: p.penulisId, penulisNama: p.penulisNama, penulisTipe: p.penulisTipe,
      tanggal: p.tanggal, balasan: posts.length - 1, views: 0, pin: false, kunci: false, terakhir: { nama: akhir.penulisNama, tanggal: akhir.tanggal }, cuplikan: p.isi.slice(0, 140) });
  }
  await kv.forumSet("index", idx);
  return idx;
}
const simpanIdx = (idx) => kv.forumSet("index", idx);
async function ubahJumlah(id, d) { const j = (await kv.forumGet("jumlah")) || {}; j[id] = Math.max(0, (j[id] || 0) + d); await kv.forumSet("jumlah", j); }
const katOf = (id) => KATEGORI.find((k) => k.id === id);
const publik = (m) => ({ id: m.id, kat: m.kat, judul: m.judul, penulisNama: m.penulisNama, penulisTipe: m.penulisTipe, tanggal: m.tanggal, balasan: m.balasan, views: m.views || 0, pin: !!m.pin, kunci: !!m.kunci, terakhir: m.terakhir, cuplikan: m.cuplikan });

async function handle(req, res, aksi) {
  let me;
  try { me = await aktor(req); } catch (e) { return res.status(500).json({ error: "Gagal konek ke database." }); }
  if (!me) return res.status(401).json({ error: "Belum login." });
  const q = req.query || {}, b = req.body || {};
  const idx = await getIdx();
  const cari = (id) => idx.find((x) => x.id === id);
  const bolehBuat = (k) => !!k && (!k.hanyaHC || me.hc);

  if (req.method === "GET") {
    if (aksi === "forum-home") {
      const kategori = KATEGORI.map((k) => {
        const t = idx.filter((x) => x.kat === k.id);
        const last = t.slice().sort((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal))[0];
        return { ...k, topik: t.length, post: t.reduce((n, x) => n + x.balasan + 1, 0), terakhir: last ? { id: last.id, judul: last.judul, nama: last.terakhir.nama, tanggal: last.terakhir.tanggal } : null, bolehBuat: bolehBuat(k) };
      });
      const warg = await kv.getWarga();
      return res.json({ peran: me.tipe, kategori, stat: { topik: idx.length, post: idx.reduce((n, x) => n + x.balasan + 1, 0), warga: warg.length } });
    }
    if (aksi === "forum-topik-list") {
      const semua = q.kat === "semua", k = katOf(q.kat);
      if (!semua && !k) return res.status(404).json({ error: "Kategori tidak ditemukan." });
      const kata = String(q.q || "").toLowerCase().trim();
      let t = idx.filter((x) => (semua || x.kat === q.kat) && (!kata || x.judul.toLowerCase().includes(kata) || x.cuplikan.toLowerCase().includes(kata)));
      const urut = { baru: (a, c) => c.tanggal.localeCompare(a.tanggal), populer: (a, c) => (c.views || 0) - (a.views || 0) || c.balasan - a.balasan }[q.urut] || ((a, c) => c.terakhir.tanggal.localeCompare(a.terakhir.tanggal));
      t = t.slice().sort((a, c) => (c.pin ? 1 : 0) - (a.pin ? 1 : 0) || urut(a, c));
      const halTotal = Math.max(1, Math.ceil(t.length / PER_TOPIK)), hal = Math.min(Math.max(1, +q.hal || 1), halTotal);
      return res.json({ kat: k ? { ...k, bolehBuat: bolehBuat(k) } : { id: "semua", nama: "Hasil Pencarian", ikon: "🔎", desk: "" }, total: t.length, hal, halTotal, topik: t.slice((hal - 1) * PER_TOPIK, hal * PER_TOPIK).map(publik) });
    }
    if (aksi === "forum-topik") {
      const m = cari(q.id);
      if (!m) return res.status(404).json({ error: "Topik tidak ditemukan." });
      const doc = (await kv.forumGet("t:" + m.id)) || { posts: [] };
      const halTotal = Math.max(1, Math.ceil(doc.posts.length / PER_POST)), hal = Math.min(Math.max(1, +q.hal || 1), halTotal);
      if (hal === 1) { m.views = (m.views || 0) + 1; await simpanIdx(idx); }
      const jumlah = (await kv.forumGet("jumlah")) || {};
      const posts = doc.posts.slice((hal - 1) * PER_POST, hal * PER_POST).map((p, i) => {
        const no = (hal - 1) * PER_POST + i + 1, rk = {};
        Object.values(p.reaksi || {}).forEach((r) => { rk[r] = (rk[r] || 0) + 1; });
        return { id: p.id, no, isi: p.isi, penulisNama: p.penulisNama, penulisAvatar: p.penulisAvatar, penulisTipe: p.penulisTipe, sejak: p.sejak, jumlahPost: jumlah[p.penulisId] || 0,
          tanggal: p.tanggal, edit: p.edit || null, reaksi: rk, sayaReaksi: (p.reaksi || {})[me.id] || null, bolehEdit: p.penulisId === me.id, bolehHapus: no > 1 && (me.hc || p.penulisId === me.id) };
      });
      const k = katOf(m.kat);
      return res.json({ peran: me.tipe, hal, halTotal, kategori: me.hc ? KATEGORI.map((x) => ({ id: x.id, nama: x.nama })) : [],
        topik: { ...publik(m), katNama: k ? k.nama : m.kat, bolehKelola: me.hc, bolehBalas: !m.kunci || me.hc, bolehHapus: me.hc || (m.penulisId === me.id && doc.posts.length === 1) }, posts });
    }
    return res.status(400).json({ error: "Aksi tidak dikenal." });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });
  const now = new Date().toISOString();

  if (aksi === "forum-buat") {
    const k = katOf(b.kat), judul = potong(b.judul, 100), isi = potong(b.isi, 5000);
    if (!k) return res.status(400).json({ error: "Pilih kategori." });
    if (!bolehBuat(k)) return res.status(403).json({ error: "Kategori ini khusus High Command." });
    if (judul.length < 3) return res.status(400).json({ error: "Judul minimal 3 karakter." });
    if (isi.length < 5) return res.status(400).json({ error: "Isi minimal 5 karakter." });
    if (jeda(idx.filter((x) => x.penulisId === me.id).map((x) => x.tanggal).sort().pop(), 30)) return res.status(429).json({ error: "Tunggu sebentar sebelum membuat topik lagi." });
    const id = rid();
    await kv.forumSet("t:" + id, { posts: [{ id: rid(), isi, penulisId: me.id, penulisNama: me.nama, penulisAvatar: me.avatar, penulisTipe: me.tipe, sejak: me.sejak, tanggal: now, reaksi: {} }] });
    idx.unshift({ id, kat: k.id, judul, penulisId: me.id, penulisNama: me.nama, penulisTipe: me.tipe, tanggal: now, balasan: 0, views: 0, pin: false, kunci: false, terakhir: { nama: me.nama, tanggal: now }, cuplikan: isi.slice(0, 140) });
    while (idx.length > MAX_TOPIK) { const i = idx.map((x) => !x.pin).lastIndexOf(true); if (i < 0) break; const [gone] = idx.splice(i, 1); await kv.forumDel("t:" + gone.id); }
    await simpanIdx(idx); await ubahJumlah(me.id, 1);
    return res.json({ ok: true, id });
  }

  const m = cari(b.id);
  if (!m) return res.status(404).json({ error: "Topik tidak ditemukan." });
  const doc = (await kv.forumGet("t:" + m.id)) || { posts: [] };
  const sinkron = async () => {
    const a = doc.posts[doc.posts.length - 1];
    m.balasan = Math.max(0, doc.posts.length - 1);
    if (a) m.terakhir = { nama: a.penulisNama, tanggal: a.tanggal };
    m.cuplikan = doc.posts[0] ? doc.posts[0].isi.slice(0, 140) : m.cuplikan;
    await kv.forumSet("t:" + m.id, doc); await simpanIdx(idx);
  };

  if (aksi === "forum-balas") {
    const isi = potong(b.isi, 5000);
    if (m.kunci && !me.hc) return res.status(403).json({ error: "Topik ini dikunci." });
    if (!isi) return res.status(400).json({ error: "Balasan tidak boleh kosong." });
    if (doc.posts.length >= MAX_POST) return res.status(400).json({ error: "Topik ini sudah penuh." });
    if (jeda(doc.posts.filter((p) => p.penulisId === me.id).map((p) => p.tanggal).sort().pop(), 5)) return res.status(429).json({ error: "Pelan-pelan, tunggu beberapa detik." });
    doc.posts.push({ id: rid(), isi, penulisId: me.id, penulisNama: me.nama, penulisAvatar: me.avatar, penulisTipe: me.tipe, sejak: me.sejak, tanggal: now, reaksi: {} });
    await sinkron(); await ubahJumlah(me.id, 1);
    return res.json({ ok: true, halTotal: Math.ceil(doc.posts.length / PER_POST) });
  }
  if (aksi === "forum-edit") {
    const p = doc.posts.find((x) => x.id === b.postId), isi = potong(b.isi, 5000);
    if (!p) return res.status(404).json({ error: "Post tidak ditemukan." });
    if (p.penulisId !== me.id) return res.status(403).json({ error: "Cuma bisa edit post sendiri." });
    if (isi.length < 1) return res.status(400).json({ error: "Isi tidak boleh kosong." });
    p.isi = isi; p.edit = now; await sinkron();
    return res.json({ ok: true });
  }
  if (aksi === "forum-hapus") {
    if (!b.postId) {
      if (!(me.hc || (m.penulisId === me.id && doc.posts.length === 1))) return res.status(403).json({ error: "Kamu tidak boleh menghapus topik ini." });
      for (const p of doc.posts) await ubahJumlah(p.penulisId, -1);
      idx.splice(idx.indexOf(m), 1); await kv.forumDel("t:" + m.id); await simpanIdx(idx);
      return res.json({ ok: true });
    }
    const i = doc.posts.findIndex((x) => x.id === b.postId);
    if (i < 1) return res.status(404).json({ error: "Post tidak ditemukan (post pertama = hapus topiknya)." });
    if (!(me.hc || doc.posts[i].penulisId === me.id)) return res.status(403).json({ error: "Kamu tidak boleh menghapus post ini." });
    const [gone] = doc.posts.splice(i, 1); await sinkron(); await ubahJumlah(gone.penulisId, -1);
    return res.json({ ok: true });
  }
  if (aksi === "forum-reaksi") {
    const p = doc.posts.find((x) => x.id === b.postId);
    if (!p) return res.status(404).json({ error: "Post tidak ditemukan." });
    if (!REAKSI.includes(b.reaksi)) return res.status(400).json({ error: "Reaksi tidak valid." });
    p.reaksi = p.reaksi || {};
    if (p.reaksi[me.id] === b.reaksi) delete p.reaksi[me.id]; else p.reaksi[me.id] = b.reaksi;
    await kv.forumSet("t:" + m.id, doc);
    return res.json({ ok: true });
  }
  if (aksi === "forum-mod") {
    if (!me.hc) return res.status(403).json({ error: "Khusus High Command." });
    if (b.op === "pin") m.pin = !m.pin;
    else if (b.op === "kunci") m.kunci = !m.kunci;
    else if (b.op === "pindah" && katOf(b.kat)) m.kat = b.kat;
    else return res.status(400).json({ error: "Operasi tidak dikenal." });
    await simpanIdx(idx);
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "Aksi tidak dikenal." });
}

module.exports = { handle };
