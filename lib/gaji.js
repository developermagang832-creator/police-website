// ====== Sistem Gaji Mingguan (FLAT per pangkat, SERVER-SIDE) ======
// Nominal per pangkat per minggu, berdasarkan "LIST GAJI KEPOLISIAN BULAN
// JULI" yang dikasih, dipetakan urut dari pangkat tertinggi ke terendah
// sesuai PANGKAT_LIST (app.js/lib/promosi.js). Ajun Brigadir Polisi,
// Bhayangkara Kepala, dan Bhayangkara Dua dapat nominal estimasi karena
// nggak ada di list asli.
//
// BUKAN dihitung dari jam duty — flat sesuai pangkat. Nominal boleh diubah
// kapan pun (misal tiap bulan), tinggal edit angka di bawah, nggak perlu
// redeploy struktur apa pun.

const TABEL_GAJI = {
  "Broad of police Commissioners": 1500000, // Menyesuaikan hirarki di atas Chief of Police
  "Chief of Police": 1400000,
  "Assistant Chief": 1300000,
  "Deputy Chief": 1200000,
  "Commander": 1150000,
  "Captain II": 850000,
  "Captain I": 800000,
  "Lieutenant II": 650000,
  "Lieutenant I": 560000,
  "Detective Supervisor": 530000,
  "Sergeant II": 500000,
  "Sergeant I": 480000,
  "Prob. Sergeant": 450000,
  "Detective III": 430000,
  "Detective II": 400000,
  "Detective I": 380000,
  "PO III+1": 350000,
  "PO III": 345000,
  "PO II": 335000,
  "PO I": 330000,
  "Prob. Police Officer": 300000,
};

function getGajiPangkat(pangkat) {
  return TABEL_GAJI[pangkat] || 0;
}

function getMondayISO(d = new Date()) {
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

function sudahKlaimMingguIni(user) {
  return user.gajiKlaimMinggu === getMondayISO();
}

// Mutasi objek user langsung — caller wajib kvStore.setUsers(users) setelahnya.
// Return jumlah yang berhasil diklaim, atau null kalau sudah klaim minggu ini.
function klaimGaji(user) {
  if (sudahKlaimMingguIni(user)) return null;
  const jumlah = getGajiPangkat(user.pangkat);
  const minggu = getMondayISO();
  user.gajiKlaimMinggu = minggu;
  user.riwayatGaji = user.riwayatGaji || [];
  user.riwayatGaji.unshift({ minggu, jumlah, tanggal: new Date().toISOString() });
  user.riwayatGaji = user.riwayatGaji.slice(0, 12); // simpan 12 riwayat terakhir
  return jumlah;
}

module.exports = { TABEL_GAJI, getGajiPangkat, getMondayISO, sudahKlaimMingguIni, klaimGaji };
