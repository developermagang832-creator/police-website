const crypto = require("crypto");
const kvStore = require("../../lib/kv");
const { getUserFromReq, sanitizeUser } = require("../../lib/auth");
const { uploadFotoKeCloudinary } = require("../../lib/cloudinary");
const { kirimLogsGajiManual } = require("../../lib/discord");

// Batas ukuran foto iklan (data URL base64) — sama kayak batas foto laporan
// absensi, biar konsisten dan nggak numpuk jadi request raksasa.
const MAX_FOTO_BYTES = 1.5 * 1024 * 1024;
const MAX_TEKS_IKLAN = 1000;

module.exports = async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) return res.status(401).json({ error: "Belum login." });
  if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

  if (req.method === "GET") {
    const users = await kvStore.getUsers();
    const absensi = await kvStore.getAbsensi();
    const periodeMulai = await kvStore.getPeriodeMulai();
    const iklan = await kvStore.getIklan();
    return res.json({ users: users.map(sanitizeUser), absensi, periodeMulai, iklan });
  }

  // ====== Aksi: kelola Iklan (papan iklan foto + teks di Panel Rekap) ======
  // Numpang di POST /api/admin/rekap — bukan endpoint baru — biar jumlah
  // serverless function nggak nambah (limit 12 di plan Hobby Vercel).
  if (req.method === "POST") {
    const { tambahIklan, hapusIklan, kirimGajiManual } = req.body || {};

    // ====== Aksi: kirim Logs Gaji CUSTOM ke Discord (bonus/koreksi/dll) ======
    // Semua field diisi bebas oleh High Command — TIDAK mengubah data user
    // apa pun, cuma nembak log ke Discord (webhook DISCORD_WEBHOOK_GAJI_URL).
    if (kirimGajiManual) {
      const namaPetugas = String(kirimGajiManual.namaPetugas || "").trim().slice(0, 100);
      const pangkat = String(kirimGajiManual.pangkat || "").trim().slice(0, 100);
      const jumlah = String(kirimGajiManual.jumlah || "").trim().slice(0, 200);
      const diberikanOleh = String(kirimGajiManual.diberikanOleh || `@${user.username}`).trim().slice(0, 100);

      if (!namaPetugas || !pangkat || !jumlah) {
        return res.status(400).json({ error: "Nama, Pangkat, dan Jumlah wajib diisi." });
      }

      await kirimLogsGajiManual({ namaPetugas, pangkat, jumlah, diberikanOleh });
      return res.json({ ok: true });
    }

    if (tambahIklan) {
      const teks = String(tambahIklan.teks || "").trim();
      const foto = tambahIklan.foto || null;
      if (!teks && !foto) return res.status(400).json({ error: "Isi teks atau foto iklan, minimal salah satu." });
      if (teks.length > MAX_TEKS_IKLAN) return res.status(400).json({ error: `Teks iklan maksimal ${MAX_TEKS_IKLAN} karakter.` });

      const iklanId = crypto.randomBytes(8).toString("hex");
      let fotoUrl = null;
      if (foto) {
        if (typeof foto !== "string" || !foto.startsWith("data:image/")) {
          return res.status(400).json({ error: "Format foto iklan tidak valid." });
        }
        if (foto.length * 0.75 > MAX_FOTO_BYTES) {
          return res.status(413).json({ error: "Foto iklan masih terlalu besar. Coba upload ulang." });
        }
        try {
          fotoUrl = await uploadFotoKeCloudinary(foto, `iklan/${iklanId}`);
        } catch (e) {
          return res.status(500).json({ error: "Gagal mengunggah foto: " + e.message });
        }
      }

      const iklanAll = await kvStore.getIklan();
      const record = {
        id: iklanId,
        teks,
        foto: fotoUrl,
        dibuatOleh: user.namaKarakter || user.username,
        createdAt: new Date().toISOString(),
      };
      iklanAll.unshift(record);
      await kvStore.setIklan(iklanAll);
      return res.json({ ok: true, iklan: record });
    }

    if (hapusIklan) {
      const iklanAll = await kvStore.getIklan();
      const filtered = iklanAll.filter((i) => i.id !== hapusIklan);
      await kvStore.setIklan(filtered);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: "Aksi tidak dikenal." });
  }

  res.status(405).json({ error: "Method tidak didukung." });
};
