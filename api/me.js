const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");
const { getNextPangkatInfo, getEffectivePromoJam, PANGKAT_LIST } = require("../lib/promosi");
const { TABEL_GAJI, getGajiPangkat, sudahKlaimMingguIni, klaimGaji } = require("../lib/gaji");
const { notifyKlaimGaji } = require("../lib/discord");

// Batas ukuran avatar (data URL base64). Avatar dikompres dulu di browser
// (compressAvatarFile di app.js) sebelum dikirim, jadi normalnya jauh di
// bawah ini — batas ini cuma jaga-jaga biar Redis nggak kebanjiran data.
const MAX_AVATAR_CHARS = 500 * 1024;

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

  // ====== Aksi: lihat struktur anggota (semua akun approved) ======
  // Numpang di GET /api/me?view=struktur — bukan endpoint baru — biar
  // jumlah serverless function tidak nambah (limit 12 di plan Hobby Vercel).
  if (req.method === "GET" && req.query && req.query.view === "struktur") {
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
    return res.json({ members });
  }

  if (req.method === "POST") {
    const { klaimGaji: mauKlaim, updateProfile, namaKarakter, avatar } = req.body || {};

    // ====== Aksi: update profil sendiri (nama karakter & foto profil) ======
    if (updateProfile) {
      const users = await kvStore.getUsers();
      const target = users.find((u) => u.id === user.id);
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
      return res.json({ ok: true, user: sanitizeUser(target) });
    }

    // ====== Aksi: klaim gaji mingguan (flat sesuai pangkat) ======
    if (mauKlaim) {
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

    return res.status(400).json({ error: "Aksi tidak dikenal." });
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
