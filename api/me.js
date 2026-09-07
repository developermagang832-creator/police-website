const kvStore = require("../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../lib/auth");
const { PANGKAT_LIST } = require("../lib/pangkat");
const { TABEL_GAJI, getGajiPangkat, sudahKlaimMingguIni, klaimGaji } = require("../lib/gaji");
const { notifyKlaimGaji } = require("../lib/discord");

// Batas ukuran avatar (data URL base64). Avatar dikompres dulu di browser
// (compressAvatarFile di app.js) sebelum dikirim, jadi normalnya jauh di
// bawah ini — batas ini cuma jaga-jaga biar Redis nggak kebanjiran data.
const MAX_AVATAR_CHARS = 500 * 1024;

// Tanggal efektif mulai hitung buat 1 anggota: yang lebih baru antara
// mulainya periode global (periodeMulai) sama tanggal dia gabung.
function effectiveMulai(periodeMulai, bergabung) {
  if (bergabung && bergabung > periodeMulai) return bergabung;
  return periodeMulai;
}

// Total jam duty (laporan "hadir" berstatus "diterima") + jumlah hari hadir
// sejak `mulaiIso` sampai hari ini — dipakai buat Leaderboard dashboard.
function calcTotalJamHadir(records, mulaiIso) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const mulai = mulaiIso || todayStr;
  let totalMinutes = 0;
  const hadirDays = new Set();
  records.forEach((a) => {
    if (a.status !== "diterima" || a.tipe !== "hadir") return;
    if (a.tanggal < mulai || a.tanggal > todayStr) return;
    hadirDays.add(a.tanggal);
    if (a.waktuMulai && a.waktuSelesai) {
      const [h1, m1] = a.waktuMulai.split(":").map(Number);
      const [h2, m2] = a.waktuSelesai.split(":").map(Number);
      let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 24 * 60;
      totalMinutes += mins;
    }
  });
  return { totalJam: totalMinutes / 60, hadir: hadirDays.size };
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

  // ====== Aksi: leaderboard jam duty (buat dashboard) ======
  // Numpang di GET /api/me?view=leaderboard — dipakai dashboard.html biar
  // langsung kelihatan tiap kali dibuka/di-refresh. Top 5 berdasarkan total
  // jam duty terverifikasi di periode berjalan (reset ikut "Reset Semua Duty").
  if (req.method === "GET" && req.query && req.query.view === "leaderboard") {
    const users = await kvStore.getUsers();
    const absensi = await kvStore.getAbsensi();
    const periodeMulai = await kvStore.getPeriodeMulai();
    const board = users
      .filter((u) => (u.status || "approved") === "approved")
      .map((u) => {
        const records = absensi.filter((a) => a.userId === u.id);
        const mulai = effectiveMulai(periodeMulai, u.bergabung);
        const { totalJam, hadir } = calcTotalJamHadir(records, mulai);
        return {
          id: u.id,
          username: u.username,
          namaKarakter: u.namaKarakter || "",
          pangkat: u.pangkat,
          avatar: u.avatar || null,
          totalJam: Math.round(totalJam * 10) / 10,
          hadir,
        };
      })
      .filter((r) => r.totalJam > 0)
      .sort((a, b) => b.totalJam - a.totalJam || b.hadir - a.hadir)
      .slice(0, 5);
    return res.json({ leaderboard: board, periodeMulai });
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

  // ====== GET profil + info gaji ======
  const sanitized = sanitizeUser(user);
  sanitized.gaji = {
    tabel: TABEL_GAJI,
    gajiSaya: getGajiPangkat(user.pangkat),
    sudahKlaimMingguIni: sudahKlaimMingguIni(user),
    riwayat: user.riwayatGaji || [],
  };

  res.json({ user: sanitized });
};
