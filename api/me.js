const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");
const { getNextPangkatInfo, getEffectivePromoJam } = require("../lib/promosi");
const { TABEL_GAJI, getGajiPangkat, sudahKlaimMingguIni, klaimGaji } = require("../lib/gaji");
const { notifyKlaimGaji } = require("../lib/discord");

function buildPromosiInfo(user) {
  const next = getNextPangkatInfo(user.pangkat);
  if (!next) return { maxed: true };
  const jamSaatIni = getEffectivePromoJam(user);
  const persenMentah = next.jam ? (jamSaatIni / next.jam) * 100 : 100;
  const persen = Math.min(100, Math.round(persenMentah * 10) / 10);
  // Sengaja TIDAK kirim jamSaatIni/next.jam mentah ke anggota — cuma nama
  // pangkat berikutnya, syarat non-angka, dan persentase progress.
  return { maxed: false, pangkatBerikutnya: next.pangkat, syarat: next.syarat, persen, tercapai: persen >= 100 };
}

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });

  // ====== Aksi: klaim gaji mingguan (flat sesuai pangkat) ======
  // Numpang di endpoint /api/me yang sudah ada (bukan endpoint baru) biar
  // jumlah serverless function tidak nambah.
  if (req.method === "POST") {
    const { klaimGaji: mauKlaim } = req.body || {};
    if (!mauKlaim) return res.status(400).json({ error: "Aksi tidak dikenal." });

    const users = await kvStore.getUsers();
    const target = users.find((u) => u.id === user.id);
    if (!target) return res.status(404).json({ error: "User tidak ditemukan." });

    const jumlah = klaimGaji(target);
    if (jumlah === null) {
      return res.status(400).json({ error: "Gaji minggu ini sudah kamu klaim. Coba lagi minggu depan." });
    }

    await kvStore.setUsers(users);
    await notifyKlaimGaji(target, jumlah);

    return res.json({ ok: true, jumlah });
  }

  // ====== GET profil + progress kenaikan pangkat + info gaji ======
  const sanitized = sanitizeUser(user);
  sanitized.promosi = buildPromosiInfo(user);
  sanitized.gaji = {
    tabel: TABEL_GAJI,
    gajiSaya: getGajiPangkat(user.pangkat),
    sudahKlaimMingguIni: sudahKlaimMingguIni(user),
    riwayat: user.riwayatGaji || [],
  };

  res.json({ user: sanitized });
};
