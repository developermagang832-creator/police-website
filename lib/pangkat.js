// ====== Daftar Pangkat Resmi (SERVER-SIDE) ======
// Dipisah jadi file sendiri (bukan lagi di lib/promosi.js, karena fitur
// "Kenaikan Pangkat / target jam promosi" sudah dihapus dari sistem ini).
// Tetap dipakai di server untuk: validasi pangkat saat daftar akun
// (api/auth-login.js), pangkat auto High Command & urutan pangkat di struktur anggota (api/me.js).

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

// Pangkat yang LANGSUNG aktif + otomatis High Command saat daftar (tanpa approval).
// Ubah di sini + PANGKAT_AUTO_HC di app.js kalau mau nambah pangkat lain.
const PANGKAT_AUTO_HC = [PANGKAT_LIST[0]];

module.exports = { PANGKAT_LIST, PANGKAT_AUTO_HC };
