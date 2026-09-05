// Penyimpanan pakai Upstash Redis — Vercel KV sudah resmi di-deprecated per
// awal 2026, jadi ini pengganti yang direkomendasikan Vercel sendiri.
// Daftar gratis di https://upstash.com, buat database Redis, lalu isi
// UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN di Environment Variables.

const { Redis } = require("@upstash/redis");

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function getUsers() { return (await redis.get("nexotis:users")) || []; }
async function setUsers(users) { await redis.set("nexotis:users", users); }
async function getAbsensi() { return (await redis.get("nexotis:absensi")) || []; }
async function setAbsensi(absensi) { await redis.set("nexotis:absensi", absensi); }
async function getArrests() { return (await redis.get("nexotis:arrests")) || []; }
async function setArrests(arrests) { await redis.set("nexotis:arrests", arrests); }

// ====== Periode rekap (jam kerja/hadir/izin/cuti/alpa) ======
// Tanggal mulai periode akumulasi. SENGAJA cuma berubah kalau High Command
// klik "Reset Semua Duty" (lihat api/admin/reset-all-duty.js) — jadi jam
// kerja dkk numpuk terus dan TIDAK auto-reset tiap ganti minggu kalender.
// Kalau belum pernah di-set (instalasi baru), diinisialisasi ke hari Senin
// minggu ini sekali, lalu disimpan supaya konsisten di request-request berikutnya.
function getMondayISOLocal(d = new Date()) {
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}
async function getPeriodeMulai() {
  let mulai = await redis.get("nexotis:periodeMulai");
  if (!mulai) {
    mulai = getMondayISOLocal();
    await redis.set("nexotis:periodeMulai", mulai);
  }
  return mulai;
}
async function setPeriodeMulai(iso) { await redis.set("nexotis:periodeMulai", iso); }

module.exports = {
  getUsers, setUsers, getAbsensi, setAbsensi, getArrests, setArrests,
  getPeriodeMulai, setPeriodeMulai,
};
