const crypto = require("crypto");
const kvStore = require("../lib/kv");

// Endpoint ini SENGAJA publik (tanpa getUserFromReq / cek cookie sesi) karena
// ini forum kritik & saran buat warga — warga nggak wajib punya akun anggota
// buat baca ATAU nulis (baik bikin postingan baru maupun bales postingan
// warga lain).
//
// PENTING soal privasi: field "kontak" (nomor WA/Discord) dan "ip" cuma boleh
// kelihatan sama High Command (lewat /api/admin/kritik-saran.js) — makanya di
// endpoint publik ini semua data yang dibalikin ke browser selalu dibersihkan
// dulu lewat sanitizePost()/sanitizeReply() sebelum res.json().

const KATEGORI_VALID = ["kritik", "saran", "lainnya"];

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function sanitizeReply(r) {
  return { id: r.id, nama: r.nama, pesan: r.pesan, createdAt: r.createdAt };
}
function sanitizePost(rec) {
  return {
    id: rec.id,
    kategori: rec.kategori,
    nama: rec.nama,
    pesan: rec.pesan,
    createdAt: rec.createdAt,
    replies: (rec.replies || []).map(sanitizeReply),
  };
}

module.exports = async (req, res) => {
  // Daftar semua postingan (buat ditampilin sebagai forum publik) — data
  // sensitif (kontak, ip, status internal) udah dibuang lewat sanitizePost().
  if (req.method === "GET") {
    const list = await kvStore.getKritikSaran();
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({ list: sorted.map(sanitizePost) });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const body = req.body || {};

  // Honeypot: field "website" cuma ada di HTML tapi disembunyikan lewat CSS,
  // jadi manusia normal nggak bakal ngisi itu. Kalau keisi, hampir pasti bot.
  // Kita balikin sukses palsu (biar bot nggak tau ditolak) tapi nggak disimpan.
  if (body.website) return res.json({ ok: true });

  const ip = getClientIp(req);

  // Anti-spam ringan: 1 kiriman (postingan baru ATAU balasan) per ~25 detik
  // per alamat IP.
  try {
    const last = await kvStore.getKritikSaranLastSubmit(ip);
    if (last) return res.status(429).json({ error: "Tunggu sebentar sebelum mengirim lagi." });
  } catch (e) { /* kalau cek cooldown gagal, tetap lanjut — nggak boleh nge-block warga cuma gara-gara ini */ }

  const list = await kvStore.getKritikSaran();

  // Kalau body punya postId -> ini BALASAN ke postingan warga lain, bukan
  // postingan baru.
  if (body.postId) {
    const rec = list.find((r) => r.id === body.postId);
    if (!rec) return res.status(404).json({ error: "Postingan tidak ditemukan." });

    const pesanTrim = typeof body.pesan === "string" ? body.pesan.trim() : "";
    if (!pesanTrim) return res.status(400).json({ error: "Pesan balasan wajib diisi." });
    if (pesanTrim.length > 1000) return res.status(400).json({ error: "Balasan maksimal 1000 karakter." });
    const namaTrim = (typeof body.nama === "string" ? body.nama.trim() : "").slice(0, 100);

    const reply = {
      id: crypto.randomBytes(8).toString("hex"),
      nama: namaTrim || null,
      pesan: pesanTrim,
      createdAt: new Date().toISOString(),
      ip, // cuma buat dilihat High Command, nggak pernah dikirim balik ke publik
    };
    if (!Array.isArray(rec.replies)) rec.replies = [];
    rec.replies.push(reply);
    await kvStore.setKritikSaran(list);
    try { await kvStore.setKritikSaranLastSubmit(ip); } catch (e) { /* nggak fatal */ }
    return res.json({ ok: true, reply: sanitizeReply(reply) });
  }

  // Bukan balasan -> ini POSTINGAN BARU.
  const { kategori, nama, kontak, pesan } = body;
  if (!KATEGORI_VALID.includes(kategori)) return res.status(400).json({ error: "Kategori tidak valid." });
  const pesanTrim = typeof pesan === "string" ? pesan.trim() : "";
  if (!pesanTrim) return res.status(400).json({ error: "Pesan wajib diisi." });
  if (pesanTrim.length > 2000) return res.status(400).json({ error: "Pesan maksimal 2000 karakter." });
  const namaTrim = (typeof nama === "string" ? nama.trim() : "").slice(0, 100);
  const kontakTrim = (typeof kontak === "string" ? kontak.trim() : "").slice(0, 150);

  const record = {
    id: crypto.randomBytes(8).toString("hex"),
    kategori,
    nama: namaTrim || null,
    kontak: kontakTrim || null, // cuma buat High Command, nggak pernah ditampilin ke warga lain
    pesan: pesanTrim,
    status: "baru", // "baru" | "ditindak"
    createdAt: new Date().toISOString(),
    ip, // cuma buat High Command
    replies: [],
  };

  list.push(record);
  await kvStore.setKritikSaran(list);
  try { await kvStore.setKritikSaranLastSubmit(ip); } catch (e) { /* nggak fatal */ }

  return res.json({ ok: true, post: sanitizePost(record) });
};
