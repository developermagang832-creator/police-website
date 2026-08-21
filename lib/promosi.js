// ====== Logika Kenaikan Pangkat (SERVER-SIDE ONLY) ======
// Sengaja dipisah dari app.js (yang dikirim mentah-mentah ke browser semua
// anggota) karena jam syarat kenaikan pangkat nggak boleh kelihatan oleh
// anggota biasa — kalau taruh di app.js, tinggal buka DevTools/View Source
// langsung ketahuan semua angkanya. Di sini aman karena cuma jalan di
// server (Vercel serverless function), nggak pernah dikirim ke browser.
//
// Progress kenaikan pangkat disimpan LANGSUNG di objek user (field
// `promoJam` & `promoLastHadir`), BUKAN dihitung dari riwayat absensi.
// Alasannya: "Reset Semua Duty" di Panel Rekap menghapus SELURUH riwayat
// absensi (buat reset periode gaji mingguan) — kalau progress kenaikan
// pangkat ikut dihitung dari situ, otomatis ikut kehapus juga. Dengan
// disimpan terpisah di user, reset duty TIDAK memengaruhi progress
// kenaikan pangkat sama sekali.
//
// Satu-satunya cara progress-nya balik ke 0 adalah auto-reset kalau anggota
// nggak ada laporan HADIR yang diterima selama lebih dari 7 hari berturut-
// turut (dianggap vakum/nggak aktif).

const PANGKAT_LIST = [
  "Broad of police Commissioners",
  "Chief of Police",
  "Assistant Chief",
  "Deputy Chief",
  "Commander",
  "Captain II",
  "Captain I",
  "Lieutenant II",
  "Lieutenant I",
  "Detective Supervisor",
  "Sergeant II",
  "Sergeant I",
  "Prob. Sergeant",
  "Detective III",
  "Detective II",
  "Detective I",
  "PO III+1",
  "PO III",
  "PO II",
  "PO I",
  "Prob. Police Officer",
];

// Key = nama pangkat TUJUAN. "jam" = total jam duty kumulatif ALL-TIME yang
// harus dicapai. "syarat" = teks syarat tambahan (non-angka) yang boleh
// ditampilkan ke anggota. Edit bebas angka & teksnya sesuai SOP fraksi —
// file ini nggak pernah dikirim ke browser jadi aman.
const SYARAT_KENAIKAN = {
  "PO I":            { jam: 30,  syarat: "Memahami SOP dasar organisasi & fungsi penugasan utama." },
  "PO II":          { jam: 40,  syarat: "Aktif duty minimal 2 minggu berturut-turut tanpa alpa." },
  "PO III":        { jam: 50,  syarat: "Direkomendasikan oleh atasan langsung (Kanit/Kasat)." },
  "PO III+1":         { jam: 60,  syarat: "Lulus ujian tertulis dasar kepolisian." },
  "Detective I":        { jam: 90,  syarat: "Aktif duty minimal 4 minggu berturut-turut tanpa alpa." },
  "Detective II":             { jam: 120, syarat: "Direkomendasikan oleh atasan langsung (Kanit/Kasat)." },
  "Detective III":      { jam: 160, syarat: "Lulus pelatihan lanjutan & memahami kode etik secara penuh." },
  "Prob. Sergeant":   { jam: 200, syarat: "Pernah membina atau mendampingi minimal 1 anggota baru." },
  "Sergeant I":  { jam: 250, syarat: "Lulus ujian kenaikan pangkat tingkat Bintara." },
  "Detective Supervisor":       { jam: 350, syarat: "Menjabat sebagai penanggung jawab minimal 1 divisi/unit." },
  "Sergeant II":        { jam: 300, syarat: "Direkomendasikan oleh Kasat/Kabag terkait." },
  "Lieutenant I":       { jam: 420, syarat: "Lulus ujian kenaikan pangkat tingkat Perwira Pertama." },
  "Lieutenant II":            { jam: 500, syarat: "Rekam jejak bersih tanpa pelanggaran kode etik berat." },
  "Captain I": { jam: 600, syarat: "Direkomendasikan langsung oleh High Command." },
  "Captain II":      { jam: 700, syarat: "Lulus evaluasi kepemimpinan dari High Command." },
  "Commander":    { jam: 900, syarat: "Kontribusi aktif dalam pengembangan fraksi (SOP/pelatihan/dll)." },
  "Deputy Chief":   { jam: 1000, syarat: "Persetujuan mutlak dari seluruh anggota High Command." },
  "Assistant Chief":   { jam: 1150, syarat: "Masa jabatan minimal 3 bulan di pangkat sebelumnya." },
  "Chief of Police":             { jam: 1300, syarat: "Rekomendasi resmi dan persetujuan pimpinan tertinggi fraksi." },
  "Broad of police Commissioners":             { jam: 1500, syarat: "Ditunjuk langsung oleh pimpinan tertinggi fraksi/owner server." },
};

const BATAS_HARI_TIDAK_AKTIF = 7;

function hariSelisih(tanggalLama, tanggalBaru) {
  const a = new Date(tanggalLama + "T00:00:00");
  const b = new Date(tanggalBaru + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// Info pangkat berikutnya + syarat mentahnya (jam & teks). Dipakai internal
// oleh api/me.js & api/admin/rekap.js — JANGAN kirim field "jam" ini mentah-
// mentah ke response /api/me yang bisa dibaca anggota biasa.
function getNextPangkatInfo(pangkatSekarang) {
  const idx = PANGKAT_LIST.indexOf(pangkatSekarang);
  if (idx <= 0) return null; // 0 = Broad of police Commissioners (tertinggi), -1 = nggak dikenali
  const nama = PANGKAT_LIST[idx - 1];
  const req = SYARAT_KENAIKAN[nama] || { jam: 0, syarat: "Syarat belum diatur — hubungi High Command." };
  return { pangkat: nama, jam: req.jam, syarat: req.syarat };
}

// Dipanggil tiap kali ada laporan HADIR yang berstatus "diterima" (baik
// auto-diterima langsung, atau lewat verifikasi manual High Command).
// Mutasi objek user secara langsung — caller wajib kvStore.setUsers(users)
// setelah manggil ini.
function tambahJamPromosi(user, tanggalLaporan, jam) {
  if (!jam || jam <= 0) return;
  if (user.promoLastHadir && hariSelisih(user.promoLastHadir, tanggalLaporan) > BATAS_HARI_TIDAK_AKTIF) {
    user.promoJam = 0; // vakum >7 hari sejak laporan hadir terakhir -> auto-reset
  }
  user.promoJam = (user.promoJam || 0) + jam;
  // promoLastHadir cuma maju, nggak mundur kalau ada laporan yang diinput mundur
  if (!user.promoLastHadir || tanggalLaporan > user.promoLastHadir) {
    user.promoLastHadir = tanggalLaporan;
  }
}

// Progress efektif SAAT INI (read-only, nggak nulis ke DB) — dipakai pas
// nampilin ke anggota, biar auto-reset karena vakum kelihatan real-time
// walau anggota belum bikin laporan baru buat men-trigger reset beneran.
function getEffectivePromoJam(user) {
  if (!user.promoLastHadir) return user.promoJam || 0;
  const hariIni = new Date().toISOString().slice(0, 10);
  if (hariSelisih(user.promoLastHadir, hariIni) > BATAS_HARI_TIDAK_AKTIF) return 0;
  return user.promoJam || 0;
}

module.exports = { PANGKAT_LIST, getNextPangkatInfo, tambahJamPromosi, getEffectivePromoJam };
