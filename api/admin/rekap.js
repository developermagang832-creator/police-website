const kvStore = require("../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../lib/auth");
const { getNextPangkatInfo, getEffectivePromoJam } = require("../../lib/promosi");

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  const users = await kvStore.getUsers();
  const absensi = await kvStore.getAbsensi();

  // Endpoint ini khusus High Command, jadi angka jam boleh ditampilkan apa
  // adanya (beda dari /api/me yang dipakai anggota biasa, yang cuma dapat
  // persentase tanpa angka jam mentah).
  const promosi = users.map((u) => {
    const next = getNextPangkatInfo(u.pangkat);
    if (!next) return { id: u.id, username: u.username, pangkat: u.pangkat, maxed: true };
    const jamSaatIni = getEffectivePromoJam(u);
    const persenMentah = next.jam ? (jamSaatIni / next.jam) * 100 : 100;
    const persen = Math.min(100, Math.round(persenMentah * 10) / 10);
    return {
      id: u.id,
      username: u.username,
      pangkat: u.pangkat,
      maxed: false,
      pangkatBerikutnya: next.pangkat,
      syarat: next.syarat,
      jamSaatIni: Math.round(jamSaatIni * 10) / 10,
      jamDibutuhkan: next.jam,
      persen,
      tercapai: persen >= 100,
    };
  });

  res.json({ users: users.map(sanitizeUser), absensi, promosi });
};
