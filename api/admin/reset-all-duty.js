const kvStore = require("../../lib/kv");
const { getUserFromReq } = require("../../lib/auth");

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const absensi = await kvStore.getAbsensi();
  const resetCount = absensi.length;
  await kvStore.setAbsensi([]);
  // Catatan: ini SENGAJA cuma hapus "nexotis:absensi" (buat reset periode
  // gaji mingguan), TIDAK menyentuh data user sama sekali — jadi progress
  // kenaikan pangkat (promoJam/promoLastHadir di user) tidak ikut ke-reset.
  res.json({ ok: true, resetCount });
};
