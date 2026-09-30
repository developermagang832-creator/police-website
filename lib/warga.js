// Sesi & helper untuk WARGA (login Discord). Sengaja dipisah dari lib/auth.js:
// cookie-nya beda nama (nexotis_warga) dan payload-nya bertipe "warga", jadi
// sesi warga TIDAK PERNAH dianggap sesi anggota oleh getUserFromReq().

const crypto = require("crypto");
const kvStore = require("./kv");
const session = require("./session");

const WARGA_COOKIE = "nexotis_warga";
const STATE_COOKIE = "nexotis_oauth_state";
const WARGA_TTL_SEC = 7 * 24 * 60 * 60; // warga bukan akun sensitif, 7 hari

function isLocal(req) {
  const host = String((req && req.headers && req.headers.host) || "");
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}
function cookieStr(req, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isLocal(req) ? "" : "; Secure"}`;
}

async function getWargaFromReq(req) {
  const payload = session.verify(req.cookies?.[WARGA_COOKIE]);
  if (!payload || payload.t !== "warga" || !payload.wargaId) return null;
  const list = await kvStore.getWarga();
  return list.find((w) => w.id === payload.wargaId) || null;
}

function setWargaCookie(req, res, wargaId) {
  const token = session.sign({ t: "warga", wargaId, exp: Date.now() + WARGA_TTL_SEC * 1000 });
  return cookieStr(req, WARGA_COOKIE, token, WARGA_TTL_SEC);
}

// state OAuth (anti-CSRF): dibuat pas mulai login, dicek pas Discord balik.
function newState() { return crypto.randomBytes(16).toString("hex"); }
function stateCookie(req, state) { return cookieStr(req, STATE_COOKIE, state, 10 * 60); }
function clearStateCookie(req) { return cookieStr(req, STATE_COOKIE, "", 0); }
function clearWargaCookie(req) { return cookieStr(req, WARGA_COOKIE, "", 0); }

// URL foto profil Discord (atau null kalau nggak punya -> frontend pakai inisial)
function avatarUrl(discordId, avatarHash) {
  if (!avatarHash) return null;
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.${ext}?size=128`;
}

function sanitizeWarga(w) {
  if (!w) return null;
  return {
    id: w.id,
    username: w.username,
    nama: w.globalName || w.username,
    avatar: avatarUrl(w.discordId, w.avatar),
    pertamaLogin: w.pertamaLogin,
    terakhirLogin: w.terakhirLogin,
  };
}

module.exports = {
  WARGA_COOKIE, STATE_COOKIE, getWargaFromReq, setWargaCookie, newState,
  stateCookie, clearStateCookie, clearWargaCookie, sanitizeWarga,
};
