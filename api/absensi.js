const crypto = require("crypto");
const kvStore = require("../lib/kv");
const { getUserFromReq } = require("../lib/auth");
const { notifyLaporanMasuk } = require("../lib/discord");
const { tambahJamPromosi } = require("../lib/promosi");

// Durasi duty dalam jam dari "HH:MM" ke "HH:MM" (menangani lewat tengah malam).
function calcDurasiJam(mulai, selesai) {
  if (!mulai || !selesai) return 0;
  const [h1, m1] = mulai.split(":").map(Number);
  const [h2, m2] = selesai.split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });

  const absensiAll = await kvStore.getAbsensi();

  if (req.method === "GET") {
    return res.json({ absensi: absensiAll.filter((a) => a.userId === user.id) });
  }

  if (req.method === "POST") {
    const { tipe, tanggal, waktuMulai, waktuSelesai, cutiMulai, cutiSelesai, foto, keterangan } = req.body || {};
    const fotoList = Array.isArray(foto) ? foto.filter(Boolean) : [];
    if (!["hadir", "izin", "cuti"].includes(tipe)) return res.status(400).json({ error: "Tipe tidak valid." });
    if (tipe === "hadir" && (fotoList.length < 1 || fotoList.length > 3)) return res.status(400).json({ error: "Wajib 1–3 foto bukti untuk laporan hadir." });

    // Batas aman per foto (base64) supaya nggak numpuk jadi request raksasa yang
    // ditolak platform dengan 413 Payload Too Large sebelum sempat sampai ke sini.
    const MAX_FOTO_BYTES = 1.5 * 1024 * 1024; // ~1.5MB per foto setelah decode base64
    const tooBig = fotoList.some((src) => typeof src === "string" && src.length * 0.75 > MAX_FOTO_BYTES);
    if (tooBig) return res.status(413).json({ error: "Salah satu foto masih terlalu besar. Coba upload ulang foto tersebut." });
    if (tipe === "cuti" && (!cutiMulai || !cutiSelesai)) return res.status(400).json({ error: "Periode cuti wajib diisi." });

    const durasiJam = tipe === "hadir" ? calcDurasiJam(waktuMulai, waktuSelesai) : 0;
    const statusAwal = tipe === "hadir" && durasiJam < 6 ? "diterima" : "pending";

    const record = {
      id: crypto.randomBytes(8).toString("hex"),
      userId: user.id,
      tanggal: tanggal || new Date().toISOString().slice(0, 10),
      tipe,
      waktuMulai: tipe === "hadir" ? waktuMulai : null,
      waktuSelesai: tipe === "hadir" ? waktuSelesai : null,
      cutiMulai: tipe === "cuti" ? cutiMulai : null,
      cutiSelesai: tipe === "cuti" ? cutiSelesai : null,
      foto: fotoList,
      keterangan: keterangan || "",
      status: statusAwal,
      alasan: null,
      createdAt: new Date().toISOString(),
    };
    absensiAll.push(record);
    await kvStore.setAbsensi(absensiAll);

    // Progress kenaikan pangkat disimpan di user, bukan di record absensi —
    // supaya nggak ikut hilang kalau High Command reset semua duty.
    if (tipe === "hadir" && statusAwal === "diterima" && durasiJam > 0) {
      const users = await kvStore.getUsers();
      const u = users.find((x) => x.id === user.id);
      if (u) {
        tambahJamPromosi(u, record.tanggal, durasiJam);
        await kvStore.setUsers(users);
      }
    }

    await notifyLaporanMasuk(user, record);
    return res.json({ ok: true, record });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
