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

module.exports = { getUsers, setUsers, getAbsensi, setAbsensi, getArrests, setArrests };
