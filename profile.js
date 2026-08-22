const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");

// Batas ukuran avatar (data URL base64). Avatar dikompres dulu di browser
// (lihat compressAvatarFile di app.js) sebelum dikirim, jadi normalnya jauh
// di bawah ini — batas ini cuma jaga-jaga biar Redis nggak kebanjiran data.
const MAX_AVATAR_CHARS = 500 * 1024;

module.exports = async (req, res) => {
  const me = await getUserFromReq(req);
  if (!me) return res.status(401).json({ error: "Belum login." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const { namaKarakter, avatar } = req.body || {};

  const users = await kvStore.getUsers();
  const target = users.find((u) => u.id === me.id);
  if (!target) return res.status(404).json({ error: "Akun tidak ditemukan." });

  if (namaKarakter !== undefined) {
    target.namaKarakter = String(namaKarakter).trim().slice(0, 100);
  }

  if (avatar !== undefined) {
    if (avatar === null) {
      target.avatar = null; // hapus foto profil, balik ke inisial
    } else {
      if (typeof avatar !== "string" || !avatar.startsWith("data:image/")) {
        return res.status(400).json({ error: "Format foto profil tidak valid." });
      }
      if (avatar.length > MAX_AVATAR_CHARS) {
        return res.status(400).json({ error: "Foto profil terlalu besar." });
      }
      target.avatar = avatar;
    }
  }

  await kvStore.setUsers(users);
  res.json({ ok: true, user: sanitizeUser(target) });
};
