const kvStore = require("../../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../../lib/auth");
const { hashPassword } = require("../../../lib/password");
const { getNextPangkatInfo, getEffectivePromoJam } = require("../../../lib/promosi");

module.exports = async (req, res) => {
  const me = await getUserFromReq(req);
  if (!me) return res.status(401).json({ error: "Belum login." });
  if (!me.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  const { id } = req.query;
  const users = await kvStore.getUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: "User tidak ditemukan." });

  if (req.method === "PATCH") {
    const { pangkat, isHighCommand, newPassword, terimaKenaikan, status } = req.body || {};

    // Aksi "Terima Kenaikan" dari tab Kenaikan Pangkat di Panel Rekap —
    // numpang di endpoint edit-user yang sudah ada (bukan endpoint baru)
    // biar jumlah serverless function tidak nambah.
    if (terimaKenaikan) {
      const next = getNextPangkatInfo(target.pangkat);
      if (!next) return res.status(400).json({ error: "Anggota sudah di pangkat tertinggi." });
      const jamSaatIni = getEffectivePromoJam(target);
      if (next.jam && jamSaatIni < next.jam) {
        return res.status(400).json({ error: "Syarat jam anggota ini belum terpenuhi." });
      }
      target.pangkat = next.pangkat;
      target.promoJam = 0; // reset, mulai progress baru buat pangkat berikutnya lagi
      await kvStore.setUsers(users);
      return res.json({ ok: true, user: sanitizeUser(target) });
    }

    // Approve/reject pendaftaran akun baru dari tab Pendaftaran di Panel
    // Rekap — juga numpang di endpoint ini, bukan endpoint baru.
    if (status !== undefined) {
      if (!["approved", "pending", "ditolak"].includes(status)) {
        return res.status(400).json({ error: "Status tidak valid." });
      }
      target.status = status;
      await kvStore.setUsers(users);
      return res.json({ ok: true, user: sanitizeUser(target) });
    }

    if (pangkat !== undefined) target.pangkat = pangkat;
    if (isHighCommand !== undefined) target.isHighCommand = !!isHighCommand;
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
      target.passwordHash = hashPassword(newPassword);
    }
    await kvStore.setUsers(users);
    return res.json({ ok: true, user: sanitizeUser(target) });
  }

  if (req.method === "DELETE") {
    if (target.id === me.id) return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri." });
    await kvStore.setUsers(users.filter((u) => u.id !== id));
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
