const kvStore = require("../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../lib/auth");

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  const users = await kvStore.getUsers();
  const absensi = await kvStore.getAbsensi();
  const periodeMulai = await kvStore.getPeriodeMulai();

  res.json({ users: users.map(sanitizeUser), absensi, periodeMulai });
};
