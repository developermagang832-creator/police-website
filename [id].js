const kvStore = require("../../../lib/kv");
const { getUserFromReq } = require("../../../lib/auth");
const { notifyStatusDiproses } = require("../../../lib/discord");
const notif = require("../../../lib/notif");

module.exports = async (req, res) => {
  const hc = await getUserFromReq(req);
  if (!hc) return res.status(401).json({ error: "Belum login." });
  if (!hc.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const { status, alasan } = req.body || {};
  if (!["diterima", "ditolak"].includes(status)) return res.status(400).json({ error: "Status tidak valid." });

  const { id } = req.query;
  const absensi = await kvStore.getAbsensi();
  const rec = absensi.find((a) => a.id === id);
  if (!rec) return res.status(404).json({ error: "Laporan tidak ditemukan." });
  rec.status = status;
  if (status === "ditolak") rec.alasan = alasan || null;
  await kvStore.setAbsensi(absensi);

  // Notifikasi ke Discord biar High Command lain (yang buka dari HP lewat
  // link "Verifikasi Laporan" di notifikasi laporan masuk) tahu laporan ini
  // sudah diproses, dan siapa yang memprosesnya.
  const users = await kvStore.getUsers();
  const pemilik = users.find((u) => u.id === rec.userId);
  if (pemilik) {
    await notifyStatusDiproses(pemilik, hc, rec);
  }

  // Notifikasi di website buat pemilik laporan (lonceng + toast).
  const namaHC = hc.namaKarakter || hc.username;
  await notif.kirim(rec.userId, status === "diterima"
    ? { tipe: "sukses", judul: "Laporan diterima", isi: `Laporan ${rec.tipe} tanggal ${rec.tanggal} disetujui ${namaHC}.`, href: "dashboard.html" }
    : { tipe: "bahaya", judul: "Laporan ditolak", isi: `Laporan ${rec.tipe} tanggal ${rec.tanggal} ditolak ${namaHC}${alasan ? ": " + String(alasan).slice(0, 120) : "."}`, href: "dashboard.html" });

  res.json({ ok: true });
};
