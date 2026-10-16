// Notifikasi di dalam website (lonceng di navbar + toast otomatis).
// Disimpan per anggota di Redis: nexotis:notif:<userId> (terbaru di depan).
// Semua fungsi di sini AMAN: kalau gagal cuma dicatat di log, nggak pernah
// menggagalkan aksi utamanya (kirim laporan, ACC laporan, dst).
const crypto = require("crypto");
const kv = require("./kv");

const MAKS = 40;                       // simpan maksimal 40 notif per anggota
const UMUR_MS = 30 * 24 * 3600 * 1000; // dan buang yang lebih tua dari 30 hari
const TIPE = ["sukses", "bahaya", "info", "peringatan"];

function rapikan(n) {
  return {
    id: crypto.randomBytes(6).toString("hex"),
    tipe: TIPE.includes(n.tipe) ? n.tipe : "info",
    judul: String(n.judul || "").slice(0, 80),
    isi: String(n.isi || "").slice(0, 220),
    href: n.href ? String(n.href).slice(0, 200) : "",
    waktu: new Date().toISOString(),
    baca: false,
  };
}

async function kirim(userId, n) {
  try {
    if (!userId) return;
    const batas = Date.now() - UMUR_MS;
    const lama = (await kv.notifGet(userId)).filter((x) => new Date(x.waktu).getTime() > batas);
    lama.unshift(rapikan(n));
    await kv.notifSet(userId, lama.slice(0, MAKS));
  } catch (e) {
    console.error("[notif] gagal kirim:", e.message);
  }
}

async function kirimKeBanyak(userIds, n) {
  await Promise.all(userIds.map((id) => kirim(id, n)));
}

// Semua High Command (kecuali pelaku aksinya, kalau diisi `kecualiId`).
async function kirimKeHC(n, kecualiId) {
  try {
    const users = await kv.getUsers();
    const ids = users
      .filter((u) => u.isHighCommand && (u.status || "approved") === "approved" && u.id !== kecualiId)
      .map((u) => u.id);
    await kirimKeBanyak(ids, n);
  } catch (e) {
    console.error("[notif] gagal kirim ke HC:", e.message);
  }
}

// Semua anggota aktif (kecuali `kecualiId`).
async function kirimKeSemua(n, kecualiId) {
  try {
    const users = await kv.getUsers();
    const ids = users.filter((u) => (u.status || "approved") === "approved" && u.id !== kecualiId).map((u) => u.id);
    await kirimKeBanyak(ids, n);
  } catch (e) {
    console.error("[notif] gagal kirim ke semua:", e.message);
  }
}

async function daftar(userId) {
  const notif = await kv.notifGet(userId);
  return { notif: notif.slice(0, MAKS), unread: notif.filter((x) => !x.baca).length };
}

async function tandaiBaca(userId, id) {
  try {
    const notif = await kv.notifGet(userId);
    let ubah = false;
    notif.forEach((x) => { if (!x.baca && (id === "all" || x.id === id)) { x.baca = true; ubah = true; } });
    if (ubah) await kv.notifSet(userId, notif);
  } catch (e) {
    console.error("[notif] gagal tandai baca:", e.message);
  }
}

module.exports = { kirim, kirimKeBanyak, kirimKeHC, kirimKeSemua, daftar, tandaiBaca };
