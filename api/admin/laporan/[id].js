const kvStore = require("../../../lib/kv");
const { getUserFromReq } = require("../../../lib/auth");
const { tambahJamPromosi } = require("../../../lib/promosi");

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
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const { status } = req.body || {};
  if (!["diterima", "ditolak"].includes(status)) return res.status(400).json({ error: "Status tidak valid." });

  const { id } = req.query;
  const absensi = await kvStore.getAbsensi();
  const rec = absensi.find((a) => a.id === id);
  if (!rec) return res.status(404).json({ error: "Laporan tidak ditemukan." });
  const statusSebelumnya = rec.status;
  rec.status = status;
  await kvStore.setAbsensi(absensi);

  // Kalau baru disetujui sekarang (bukan yang udah diterima sebelumnya) dan
  // tipenya hadir, tambahkan jam ke progress kenaikan pangkat pemilik laporan.
  if (status === "diterima" && statusSebelumnya !== "diterima" && rec.tipe === "hadir") {
    const durasiJam = calcDurasiJam(rec.waktuMulai, rec.waktuSelesai);
    if (durasiJam > 0) {
      const users = await kvStore.getUsers();
      const u = users.find((x) => x.id === rec.userId);
      if (u) {
        tambahJamPromosi(u, rec.tanggal, durasiJam);
        await kvStore.setUsers(users);
      }
    }
  }

  res.json({ ok: true });
};
