// Kirim notifikasi ke Discord webhook tiap ada laporan absensi masuk.
// Optional: kalau DISCORD_WEBHOOK_URL nggak diisi di Environment Variables,
// fungsi ini cuma diam aja (nggak bikin error, nggak ganggu proses simpan
// laporan).

const TIPE_LABEL = { hadir: "Hadir", izin: "Izin", cuti: "Cuti" };
const TIPE_COLOR = { hadir: 0x22c55e, izin: 0xeab308, cuti: 0x3b82f6 };

function formatTanggalSingkat(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (e) {
    return iso;
  }
}

// URL Panel Rekap tab "Verifikasi Laporan" — dipakai jadi link langsung di
// notifikasi Discord biar High Command bisa approve/reject dari HP tanpa
// perlu buka & cari-cari tab-nya manual. Isi SITE_URL di Environment
// Variables (misal https://domain-kamu.vercel.app) kalau mau link ini aktif.
function laporanPanelUrl() {
  const base = process.env.SITE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/rekap.html?tab=laporan`;
}

// user: { username, pangkat }, record: hasil dari api/absensi.js (record baru)
async function notifyLaporanMasuk(user, record) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return; // fitur opsional — belum di-setup, skip diam-diam

  const fields = [
    { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
    { name: "Tipe", value: TIPE_LABEL[record.tipe] || record.tipe, inline: true },
    { name: "Tanggal", value: formatTanggalSingkat(record.tanggal), inline: true },
  ];

  if (record.tipe === "hadir") {
    fields.push({
      name: "Jam Duty",
      value: `${record.waktuMulai || "-"} - ${record.waktuSelesai || "-"}`,
      inline: true,
    });
  }
  if (record.tipe === "cuti") {
    fields.push({
      name: "Periode Cuti",
      value: `${formatTanggalSingkat(record.cutiMulai)} s/d ${formatTanggalSingkat(record.cutiSelesai)}`,
      inline: true,
    });
  }
  if (record.keterangan) {
    fields.push({ name: "Keterangan", value: String(record.keterangan).slice(0, 500), inline: false });
  }

  const linkPanel = laporanPanelUrl();
  const payload = {
    username: "Absensi Logs",
    embeds: [
      {
        title: "Laporan Absensi Baru",
        url: record.status === "pending" ? linkPanel || undefined : undefined,
        color: TIPE_COLOR[record.tipe] || 0x64748b,
        fields,
        footer: {
          text: record.status === "diterima"
            ? `Status: auto-diterima (< 6 jam) • ID: ${record.id}`
            : linkPanel
              ? `Klik judul di atas buat approve/reject dari HP • ID: ${record.id}`
              : `Status: pending — buka Panel Rekap → Verifikasi Laporan • ID: ${record.id}`,
        },
        timestamp: record.createdAt,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    // Jangan sampai kegagalan kirim webhook bikin laporan gagal tersimpan —
    // cukup dicatat di log server (Vercel → tab Logs).
    console.error("[discord webhook] gagal kirim notifikasi:", err.message);
  }
}

// user: yang submit laporan { username, pangkat }
// hc: HC yang memutuskan { username }
// record: laporan absensi yang statusnya baru diubah (sudah termasuk status & alasan terbaru)
async function notifyStatusDiproses(user, hc, record) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const diterima = record.status === "diterima";
  const fields = [
    { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
    { name: "Tipe", value: TIPE_LABEL[record.tipe] || record.tipe, inline: true },
    { name: "Tanggal", value: formatTanggalSingkat(record.tanggal), inline: true },
    { name: "Diproses oleh", value: hc.username, inline: true },
  ];
  if (!diterima && record.alasan) {
    fields.push({ name: "Alasan Ditolak", value: String(record.alasan).slice(0, 500), inline: false });
  }

  const payload = {
    username: "Absensi Logs",
    embeds: [
      {
        title: diterima ? "Laporan Diterima" : "Laporan Ditolak",
        color: diterima ? 0x22c55e : 0xef4444,
        fields,
        footer: { text: `ID: ${record.id}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[discord webhook] gagal kirim notifikasi status:", err.message);
  }
}

// Helper generik kirim embed ke webhook — dipakai notifyKlaimGaji &
// notifyPendaftaranBaru biar nggak duplikat kode fetch+try/catch.
async function kirimEmbed(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[discord webhook] gagal kirim notifikasi:", err.message);
  }
}

// Dipanggil tiap anggota klaim gaji mingguan.
async function notifyKlaimGaji(user, jam, jumlah) {
  await kirimEmbed({
    username: "Gaji Logs",
    embeds: [
      {
        title: "💰 Klaim Gaji Mingguan",
        color: 0x22c55e,
        fields: [
          { name: "Anggota", value: `${user.username} (${user.pangkat || "-"})`, inline: true },
          { name: "Jam Duty Terverifikasi", value: `${jam.toFixed(1)} Jam`, inline: true },
          { name: "Jumlah Diklaim", value: `Rp ${Number(jumlah).toLocaleString("id-ID")}`, inline: true },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

// Dipanggil tiap ada pendaftaran akun baru (menunggu approval High Command).
async function notifyPendaftaranBaru(pendaftar) {
  const base = process.env.SITE_URL;
  const linkPanel = base ? `${base.replace(/\/+$/, "")}/rekap.html?tab=pendaftaran` : null;
  await kirimEmbed({
    username: "Pendaftaran Logs",
    embeds: [
      {
        title: "🆕 Pendaftaran Akun Baru — Menunggu Approval",
        url: linkPanel || undefined,
        color: 0xeab308,
        fields: [
          { name: "Username", value: pendaftar.username, inline: true },
          { name: "Nama Karakter", value: pendaftar.namaKarakter || "-", inline: true },
        ],
        footer: { text: linkPanel ? "Klik judul di atas untuk approve/reject dari HP." : "Buka Panel Rekap → tab Pendaftaran untuk approve/reject." },
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

module.exports = { notifyLaporanMasuk, notifyStatusDiproses, notifyKlaimGaji, notifyPendaftaranBaru };
