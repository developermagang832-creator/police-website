// ====== Daftar Pangkat Resmi (SERVER-SIDE) ======
// Dipisah jadi file sendiri (bukan lagi di lib/promosi.js, karena fitur
// "Kenaikan Pangkat / target jam promosi" sudah dihapus dari sistem ini).
// Tetap dipakai di server untuk: validasi pangkat saat daftar akun
// (api/auth-login.js), aturan approve di Panel Rekap & urutan pangkat di struktur anggota (api/me.js).

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

// Pangkat yang TIDAK boleh di-approve lewat Panel Rekap (tab Pendaftaran).
// Pendaftar dengan pangkat ini harus diproses manual (bukan lewat tombol Setujui).
// Ubah di sini + di PANGKAT_TANPA_REKAP (app.js) kalau mau nambah pangkat lain.
const PANGKAT_TANPA_REKAP = [PANGKAT_LIST[0]];

module.exports = { PANGKAT_LIST, PANGKAT_TANPA_REKAP };
