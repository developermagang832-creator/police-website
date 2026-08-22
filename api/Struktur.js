const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");
const { PANGKAT_LIST } = require("../lib/promosi");

// Endpoint ini bisa diakses SEMUA anggota yang sudah login (bukan cuma High
// Command) — beda dari /api/admin/users yang khusus HC. Cuma nampilin field
// yang aman dilihat sesama anggota (bukan data sensitif kayak riwayat gaji).
module.exports = async (req, res) => {
  const me = await getUserFromReq(req);
  if (!me) return res.status(401).json({ error: "Belum login." });
  if (req.method !== "GET") return res.status(405).json({ error: "Method tidak didukung." });

  const users = await kvStore.getUsers();

  const members = users
    .filter((u) => (u.status || "approved") === "approved")
    .map((u) => {
      const s = sanitizeUser(u);
      return {
        id: s.id,
        username: s.username,
        namaKarakter: s.namaKarakter || "",
        pangkat: s.pangkat,
        isHighCommand: !!s.isHighCommand,
        avatar: s.avatar || null,
      };
    })
    .sort((a, b) => {
      const ia = PANGKAT_LIST.indexOf(a.pangkat);
      const ib = PANGKAT_LIST.indexOf(b.pangkat);
      const ra = ia === -1 ? PANGKAT_LIST.length : ia;
      const rb = ib === -1 ? PANGKAT_LIST.length : ib;
      if (ra !== rb) return ra - rb;
      return a.username.localeCompare(b.username);
    });

  res.json({ members });
};
