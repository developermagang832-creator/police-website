// Kirim email lewat Gmail (SMTP) pakai nodemailer.
// Wajib isi di Environment Variables Vercel:
//   GMAIL_USER          -> alamat Gmail pengirim, mis. nexotis.pd@gmail.com
//   GMAIL_APP_PASSWORD  -> "App Password" 16 karakter dari akun Google
//                          (Akun Google -> Keamanan -> Verifikasi 2 Langkah aktif
//                           -> Sandi aplikasi). BUKAN password login Gmail biasa.
const nodemailer = require("nodemailer");

let transporter;
function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD belum diisi di Environment Variables.");
  if (!transporter) {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  }
  return transporter;
}

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Email "lupa akun": berisi username + link buat set password baru.
async function kirimDetailAkun({ to, username, namaKarakter, status, linkReset, menitBerlaku }) {
  const catatan =
    status === "pending" ? "Akun kamu masih menunggu approval High Command, jadi belum bisa dipakai login."
    : status === "ditolak" ? "Pendaftaran akun kamu ditolak. Hubungi Perwira Tinggi."
    : "";
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 12px">Kepolisian Nexotis</h2>
    <p>Ada permintaan bantuan akses akun untuk email ini. Detail akun kamu:</p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:4px 14px 4px 0;color:#555">Username</td><td><b>${esc(username)}</b></td></tr>
      ${namaKarakter ? `<tr><td style="padding:4px 14px 4px 0;color:#555">Nama Karakter</td><td>${esc(namaKarakter)}</td></tr>` : ""}
    </table>
    ${catatan ? `<p style="color:#b45309">${esc(catatan)}</p>` : ""}
    <p>Kalau kamu juga lupa password, klik tombol ini buat bikin password baru (berlaku ${menitBerlaku} menit, cuma bisa dipakai sekali):</p>
    <p><a href="${esc(linkReset)}" style="display:inline-block;background:#1d4bbd;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Atur Password Baru</a></p>
    <p style="font-size:12px;color:#666">Kalau tombolnya nggak jalan, buka link ini: <br>${esc(linkReset)}</p>
    <p style="font-size:12px;color:#666">Bukan kamu yang minta? Abaikan aja email ini, password kamu nggak berubah.</p>
  </div>`;
  const teks =
    `Kepolisian Nexotis\n\nUsername: ${username}\n${namaKarakter ? `Nama Karakter: ${namaKarakter}\n` : ""}${catatan ? catatan + "\n" : ""}\n` +
    `Atur password baru (berlaku ${menitBerlaku} menit, sekali pakai):\n${linkReset}\n\nBukan kamu yang minta? Abaikan email ini.`;

  await getTransporter().sendMail({
    from: `"Kepolisian Nexotis" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Detail akun Kepolisian Nexotis",
    text: teks,
    html,
  });
}

module.exports = { kirimDetailAkun };
