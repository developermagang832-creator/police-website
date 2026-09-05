const kvStore = require("../../lib/kv");
const { getUserFromReq } = require("../../lib/auth");

// GET    /api/admin/kritik-saran                    -> daftar semua kiriman warga (LENGKAP,
//                                                        termasuk kontak & alamat IP pengirim
//                                                        — data ini SENGAJA nggak pernah dikirim
//                                                        ke endpoint publik /api/kritik-saran.js)
// PATCH  /api/admin/kritik-saran?id=xxx              -> ubah status postingan (baru/ditindak)
// DELETE /api/admin/kritik-saran?id=xxx              -> hapus 1 postingan (+ semua balasannya)
// DELETE /api/admin/kritik-saran?id=xxx&replyId=yyy  -> hapus 1 balasan aja (postingannya tetap ada)
// Digabung jadi 1 file (bukan folder [id].js terpisah) biar nggak nambah
// jumlah serverless function — sama alasannya kayak "terimaKenaikan" yang
// numpang di endpoint users/[id].js.
module.exports = async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Belum login." });
    if (!user.isHighCommand) return res.status(403).json({ error: "Khusus High Command." });

    if (req.method === "GET") {
      const list = await kvStore.getKritikSaran();
      return res.json({ list: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }

    const { id, replyId } = req.query;
    const list = await kvStore.getKritikSaran();
    const rec = list.find((r) => r.id === id);

    if (req.method === "PATCH") {
      if (!rec) return res.status(404).json({ error: "Kiriman tidak ditemukan." });
      const { status } = req.body || {};
      if (!["baru", "ditindak"].includes(status)) return res.status(400).json({ error: "Status tidak valid." });
      rec.status = status;
      await kvStore.setKritikSaran(list);
      return res.json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (!rec) return res.status(404).json({ error: "Kiriman tidak ditemukan." });

      // Hapus 1 balasan doang, postingan utamanya tetap ada.
      if (replyId) {
        const before = (rec.replies || []).length;
        rec.replies = (rec.replies || []).filter((r) => r.id !== replyId);
        if (rec.replies.length === before) return res.status(404).json({ error: "Balasan tidak ditemukan." });
        await kvStore.setKritikSaran(list);
        return res.json({ ok: true });
      }

      // Hapus seluruh postingan (otomatis ikut hapus semua balasannya).
      await kvStore.setKritikSaran(list.filter((r) => r.id !== id));
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method tidak didukung." });
  } catch (err) {
    console.error("Error di /api/admin/kritik-saran:", err);
    return res.status(500).json({ error: `Server error: ${err.message || "unknown error"}` });
  }
};
