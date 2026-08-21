const { clearSessionCookie } = require("../lib/auth");

module.exports = (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
};
