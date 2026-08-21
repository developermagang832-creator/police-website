async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Terjadi kesalahan (${res.status})`);
  return data;
}

// Daftar pangkat resmi, terurut dari tertinggi ke terendah.
// Commander ke atas dianggap High Command.
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
const HIGH_COMMAND_CUTOFF_INDEX = PANGKAT_LIST.indexOf("Commander");
function isPangkatHighCommand(pangkat) {
  const idx = PANGKAT_LIST.indexOf(pangkat);
  return idx !== -1 && idx <= HIGH_COMMAND_CUTOFF_INDEX;
}
// Catatan: syarat & jam kenaikan pangkat SENGAJA tidak ada di sini.
// File ini (app.js) dikirim mentah ke browser semua anggota, jadi angka
// syarat kenaikan pangkat disimpan di server (lib/promosi.js) dan diselipkan
// ke response /api/me — biar anggota nggak bisa lihat threshold jamnya dari
// DevTools/View Source.

function formatTanggal(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function toISO(d) { return d.toISOString().slice(0, 10); }

function getWeekDates() {
  const today = new Date();
  const day = today.getDay() === 0 ? 7 : today.getDay();
  const monday = new Date(today); monday.setDate(today.getDate() - (day - 1));
  const out = [];
  for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(monday.getDate() + i); out.push(toISO(d)); }
  return out;
}
function eachDateInRange(startIso, endIso) {
  if (!startIso || !endIso) return [];
  const out = []; let d = new Date(startIso + "T00:00:00"); const end = new Date(endIso + "T00:00:00");
  while (d <= end) { out.push(toISO(d)); d.setDate(d.getDate() + 1); }
  return out;
}
function isWeekday(iso) { const wd = new Date(iso + "T00:00:00").getDay(); return wd >= 1 && wd <= 5; }
function diffMinutes(mulai, selesai) {
  const [h1, m1] = mulai.split(":").map(Number);
  const [h2, m2] = selesai.split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins;
}

// Hitung statistik mingguan dari daftar record absensi.
function calcStatsFromRecords(records) {
  const week = getWeekDates();
  const todayStr = toISO(new Date());
  const hadirDays = new Set(), izinDays = new Set(), cutiDays = new Set();
  let totalMinutes = 0;

  records.forEach((a) => {
    if (a.status !== "diterima") return; // pending & ditolak nggak ikut dihitung
    if (a.tipe === "hadir" && week.includes(a.tanggal)) {
      hadirDays.add(a.tanggal);
      if (a.waktuMulai && a.waktuSelesai) totalMinutes += diffMinutes(a.waktuMulai, a.waktuSelesai);
    } else if (a.tipe === "izin" && week.includes(a.tanggal)) {
      izinDays.add(a.tanggal);
    } else if (a.tipe === "cuti") {
      eachDateInRange(a.cutiMulai, a.cutiSelesai).forEach((d) => { if (week.includes(d)) cutiDays.add(d); });
    }
  });

  const elapsedWeekdays = week.filter((d) => d <= todayStr && isWeekday(d));
  let alpa = 0;
  elapsedWeekdays.forEach((d) => { if (!hadirDays.has(d) && !izinDays.has(d) && !cutiDays.has(d)) alpa++; });

  const totalJam = totalMinutes / 60;
  return { totalJam, hadir: hadirDays.size, izin: izinDays.size, cuti: cutiDays.size, alpa };
}

/* ====== Navbar ====== */
function renderNavbar(activePage, user) {
  const mount = document.getElementById("navbar-mount");
  if (!mount) return;
  const initials = user.username.slice(0, 2).toUpperCase();
  const linkOrSpan = (href, label, page) =>
    activePage === page ? `<span class="active">${label}</span>` : `<a href="${href}">${label}</a>`;

  const navItems = [
    ["dashboard.html", "Dashboard", "dashboard"],
    ["gaji.html", "Gaji", "gaji"],
    ...(user.isHighCommand ? [["rekap.html", "Panel Rekap Pati Only", "rekap"]] : []),
    ["undang-undang.html", "Undang-Undang", "undang-undang"],
    ["arrest-record.html", "Arrest Record", "arrest-record"],
  ];
  const navLinksHtml = navItems.map(([href, label, page]) => linkOrSpan(href, label, page)).join("");
  const navMenuLinksHtml = navItems.map(([href, label, page]) => linkOrSpan(href, label, page)).join("");

  mount.innerHTML = `
    <div class="navbar">
      <div class="brand"><span class="flag">🚔</span> kepolisian nexotis</div>
      <nav id="nav-links">${navLinksHtml}</nav>
      <div class="nav-toggle-wrap" id="nav-toggle" style="display:none">
        <button type="button" aria-label="Buka menu navigasi" id="nav-toggle-btn">&#8942;</button>
        <div id="nav-menu">${navMenuLinksHtml}</div>
      </div>
      <div class="user" id="profile-toggle" style="position:relative;cursor:pointer">
        <div class="info">
          <div class="name">${user.username}</div>
          <div class="rank">${user.pangkat}${user.isHighCommand ? " · High Command" : ""}</div>
        </div>
        <div class="avatar">${user.avatar ? "" : initials}</div>
        <div id="profile-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:8px;background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:10px;overflow:hidden;min-width:170px;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.3)">
          <button id="menu-ganti-password" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:inherit;cursor:pointer;font-size:13px">Ganti Password</button>
          <button id="menu-logout" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:inherit;cursor:pointer;font-size:13px;border-top:1px solid var(--border,#334155)">Logout</button>
        </div>
      </div>
    </div>`;
  if (user.avatar) {
    const av = mount.querySelector(".avatar");
    av.style.backgroundImage = `url('${user.avatar}')`;
    av.style.backgroundSize = "cover";
  }

  const navbarEl = mount.querySelector(".navbar");
  const navLinksEl = document.getElementById("nav-links");
  const navToggleWrap = document.getElementById("nav-toggle");
  const navMenu = document.getElementById("nav-menu");

  // Cek apakah tab nav muat di lebar navbar. Kalau kepanjangan, sembunyikan
  // tab-nya dan tampilkan tombol titik-tiga merah sebagai gantinya.
  function checkNavOverflow() {
    navToggleWrap.style.display = "none";
    navLinksEl.style.display = "flex";
    const overflowing = navLinksEl.scrollWidth > navLinksEl.clientWidth + 1;
    if (overflowing) {
      navLinksEl.style.display = "none";
      navToggleWrap.style.display = "inline-block";
    }
  }
  checkNavOverflow();
  window.addEventListener("resize", checkNavOverflow);

  const navToggleBtn = document.getElementById("nav-toggle-btn");
  navToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = "none";
    navMenu.classList.toggle("open");
  });

  const toggle = document.getElementById("profile-toggle");
  const menu = document.getElementById("profile-menu");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    navMenu.classList.remove("open");
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", () => {
    menu.style.display = "none";
    navMenu.classList.remove("open");
  });

  document.getElementById("menu-logout").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch (e) { /* tetap lanjut ke login */ }
    window.location.href = "index.html";
  });
  document.getElementById("menu-ganti-password").addEventListener("click", () => {
    menu.style.display = "none";
    openGantiPasswordModal();
  });
}

// Modal ganti password — di-inject sekali ke <body>, dipakai di semua halaman
// yang manggil renderNavbar (dashboard & rekap).
function openGantiPasswordModal() {
  let modal = document.getElementById("ganti-password-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ganti-password-modal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-box" style="text-align:left">
        <h2 style="margin-bottom:14px">Ganti Password</h2>
        <div class="form-group"><label for="cp-current">Password Lama</label><input type="password" id="cp-current" autocomplete="current-password"></div>
        <div class="form-group"><label for="cp-new">Password Baru</label><input type="password" id="cp-new" placeholder="minimal 6 karakter" autocomplete="new-password"></div>
        <div class="error-msg" id="cp-error"></div>
        <div class="sub" id="cp-success" style="color:#22c55e;display:none;margin-bottom:8px">Password berhasil diganti.</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-secondary" id="cp-cancel">Tutup</button>
          <button class="btn btn-primary" id="cp-submit">Simpan</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById("cp-cancel").addEventListener("click", () => modal.classList.remove("open"));

    document.getElementById("cp-submit").addEventListener("click", async () => {
      const errorEl = document.getElementById("cp-error");
      const successEl = document.getElementById("cp-success");
      errorEl.textContent = "";
      successEl.style.display = "none";
      const currentPassword = document.getElementById("cp-current").value;
      const newPassword = document.getElementById("cp-new").value;
      if (!currentPassword || !newPassword) { errorEl.textContent = "Password lama & baru wajib diisi."; return; }

      const btn = document.getElementById("cp-submit");
      btn.disabled = true; btn.textContent = "Menyimpan...";
      try {
        await api("/api/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
        document.getElementById("cp-current").value = "";
        document.getElementById("cp-new").value = "";
        successEl.style.display = "block";
      } catch (e) {
        errorEl.textContent = e.message;
      } finally {
        btn.disabled = false; btn.textContent = "Simpan";
      }
    });
  }
  document.getElementById("cp-error").textContent = "";
  document.getElementById("cp-success").style.display = "none";
  document.getElementById("cp-current").value = "";
  document.getElementById("cp-new").value = "";
  modal.classList.add("open");
}

// Dipanggil di awal tiap halaman terproteksi (dashboard/rekap).
// Kalau belum login, lempar ke index.html. Return user atau null.
async function requireAuth() {
  try {
    const data = await api("/api/me");
    return data.user;
  } catch (e) {
    window.location.href = "index.html";
    return null;
  }
}
