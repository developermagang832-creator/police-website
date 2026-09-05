const crypto = require("crypto");
const kvStore = require("../lib/kv");
const { hashPassword, verifyPassword } = require("../lib/password");
const { setSessionCookie, sanitizeUser } = require("../lib/auth");
const { notifyPendaftaranBaru } = require("../lib/discord");
const { PANGKAT_LIST } = require("../lib/promosi");

const SESSION_TTL_SEC = 12 * 60 * 60;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method tidak didukung." });

  const { username, password, daftar, namaKarakter, pangkat } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username & password wajib diisi." });

  let users;
  try {
    users = await kvStore.getUsers();
  } catch (err) {
    console.error("[auth-login] gagal konek Upstash:", err.message);
    return res.status(500).json({ error: "Gagal konek ke database — cek UPSTASH_REDIS_REST_URL/TOKEN di Environment Variables." });
  }

  // ====== Aksi: daftar akun baru (menunggu approval High Command) ======
  // Numpang di endpoint /api/auth-login yang sudah ada (bukan endpoint baru)
  // karena sama-sama publik/tanpa-login.
  if (daftar) {
    if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
    const sudahAda = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
    if (sudahAda) return res.status(409).json({ error: "Username sudah dipakai, pilih yang lain." });

    const pendaftar = {
      id: crypto.randomBytes(8).toString("hex"),
      username: String(username).trim(),
      passwordHash: hashPassword(password),
      namaKarakter: namaKarakter ? String(namaKarakter).trim().slice(0, 100) : "",
      pangkat: PANGKAT_LIST.includes(pangkat) ? pangkat : "Bhayangkara Dua",
      isHighCommand: false,
      avatar: null,
      status: "pending", // wajib di-approve HC dulu sebelum bisa login
      bergabung: new Date().toISOString().slice(0, 10),
    };

    try {
      users.push(pendaftar);
      await kvStore.setUsers(users);
    } catch (err) {
      console.error("[auth-login/daftar] gagal simpan ke Upstash:", err.message);
      return res.status(500).json({ error: `Gagal simpan pendaftaran: ${err.message}` });
    }

    await notifyPendaftaranBaru(pendaftar);
    return res.json({ ok: true, pending: true });
  }

  // ====== Login biasa ======
  const user = users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }

  if (user.status === "pending") {
    return res.status(403).json({ error: "Akun kamu masih menunggu approval High Command." });
  }
  if (user.status === "ditolak") {
    return res.status(403).json({ error: "Pendaftaran akun kamu ditolak. Hubungi Perwira Tinggi." });
  }

  try {
    setSessionCookie(res, user.id, SESSION_TTL_SEC);
  } catch (err) {
    console.error("[auth-login] gagal buat sesi:", err.message);
    return res.status(500).json({ error: "Gagal membuat sesi login — cek SESSION_SECRET sudah diisi." });
  }

  res.json({ ok: true, user: sanitizeUser(user) });
};
