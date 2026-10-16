// Logo lencana (SVG inline) — emoji 🚔 nggak tampil di sebagian HP/PC (jadi kotak kosong).
const LOGO_SVG = '<svg class="logo-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M12 8.2l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="currentColor" stroke="none"/></svg>';

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
// Pangkat yang langsung aktif + otomatis High Command saat daftar (tanpa approval).
// Harus sama dengan lib/pangkat.js di server.
const PANGKAT_AUTO_HC = [PANGKAT_LIST[0]];
function pangkatAutoHC(pangkat) { return PANGKAT_AUTO_HC.includes(pangkat); }
const HIGH_COMMAND_CUTOFF_INDEX = PANGKAT_LIST.indexOf("Commander");
function isPangkatHighCommand(pangkat) {
  const idx = PANGKAT_LIST.indexOf(pangkat);
  return idx !== -1 && idx <= HIGH_COMMAND_CUTOFF_INDEX;
}

function formatTanggal(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
// PENTING: pakai getter LOKAL (getFullYear/getMonth/getDate), BUKAN
// toISOString() — soalnya toISOString() selalu convert ke UTC, dan device
// anggota (WIB, UTC+7) bisa kegeser mundur 1 hari kalau lagi jam 00:00–06:59
// WIB (masih "kemarin" di UTC). Semua Date di sini dibuat/dimanipulasi pakai
// getter/setter lokal juga (getDay, setDate, dst), jadi ini konsisten.
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

// Hitung statistik akumulasi (jam kerja/hadir/izin/cuti/alpa) dari daftar
// record absensi, terhitung sejak `mulaiIso` (bukan Senin-Minggu kalender
// yang berjalan otomatis) sampai hari ini. Angkanya numpuk terus dan CUMA
// balik ke 0 kalau High Command klik "Reset Semua Duty" di Panel Rekap —
// itu yang menggeser `mulaiIso` (periodeMulai) ke tanggal reset.
// mulaiIso wajib diisi caller (ambil dari periodeMulai API, di-max-kan sama
// tanggal bergabung anggota kalau dia baru gabung setelah periode dimulai).
function calcStatsFromRecords(records, mulaiIso) {
  const todayStr = toISO(new Date());
  const mulai = mulaiIso || todayStr;
  const rangeDates = eachDateInRange(mulai, todayStr);
  const rangeSet = new Set(rangeDates);
  const hadirDays = new Set(), izinDays = new Set(), cutiDays = new Set();
  let totalMinutes = 0;

  records.forEach((a) => {
    if (a.status !== "diterima") return; // pending & ditolak nggak ikut dihitung
    if (a.tipe === "hadir" && rangeSet.has(a.tanggal)) {
      hadirDays.add(a.tanggal);
      if (a.waktuMulai && a.waktuSelesai) totalMinutes += diffMinutes(a.waktuMulai, a.waktuSelesai);
    } else if (a.tipe === "izin" && rangeSet.has(a.tanggal)) {
      izinDays.add(a.tanggal);
    } else if (a.tipe === "cuti") {
      eachDateInRange(a.cutiMulai, a.cutiSelesai).forEach((d) => { if (rangeSet.has(d)) cutiDays.add(d); });
    }
  });

  const elapsedWeekdays = rangeDates.filter((d) => d <= todayStr && isWeekday(d));
  let alpa = 0;
  elapsedWeekdays.forEach((d) => { if (!hadirDays.has(d) && !izinDays.has(d) && !cutiDays.has(d)) alpa++; });

  const totalJam = totalMinutes / 60;
  return { totalJam, hadir: hadirDays.size, izin: izinDays.size, cuti: cutiDays.size, alpa };
}

// Tanggal efektif mulai hitung buat 1 anggota: yang lebih baru antara mulainya
// periode global (periodeMulai) sama tanggal dia gabung — biar anggota yang
// baru gabung di tengah periode nggak keitung "alpa" buat hari sebelum dia ada.
function effectiveMulai(periodeMulai, bergabung) {
  if (bergabung && bergabung > periodeMulai) return bergabung;
  return periodeMulai;
}

// Teks berjalan di bawah navbar — gaya kayak website instansi resmi (mis.
// polri.go.id). Edit teksnya di sini kalau mau ganti pengumuman.
const MARQUEE_TEXT = "Selamat datang di Website Kepolisian Nexotos roleplaying, Tolong ketika ingin laporan arrest record atau duty, dll.. isi yang benar ya temen-temen..";

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
    ["struktur.html", "Struktur Anggota", "struktur"],
  ];
  const navLinksHtml = navItems.map(([href, label, page]) => linkOrSpan(href, label, page)).join("");
  const navMenuLinksHtml = navItems.map(([href, label, page]) => linkOrSpan(href, label, page)).join("");

  mount.innerHTML = `
    <div class="navbar">
      <div class="brand"><span class="flag">${LOGO_SVG}</span> kepolisian nexotis</div>
      <nav id="nav-links">${navLinksHtml}</nav>
      <div class="nav-toggle-wrap" id="nav-toggle" style="display:none">
        <button type="button" aria-label="Buka menu navigasi" id="nav-toggle-btn">&#8942;</button>
        <div id="nav-menu">${navMenuLinksHtml}</div>
      </div>
      <div class="nx-bell-wrap" id="nx-bell-wrap">
        <button type="button" class="nx-bell" id="nx-bell" aria-label="Notifikasi" aria-expanded="false">${NX_BELL_SVG}<span class="nx-badge" id="nx-badge" hidden>0</span></button>
        <div class="nx-panel" id="nx-panel" hidden>
          <div class="nx-panel-h"><b>Notifikasi</b><button type="button" class="nx-readall" id="nx-readall">Tandai semua dibaca</button></div>
          <div class="nx-list" id="nx-list"></div>
        </div>
      </div>
      <div class="user" id="profile-toggle" style="position:relative;cursor:pointer">
        <div class="info">
          <div class="name">${user.username}</div>
          <div class="rank">${user.pangkat}${user.isHighCommand ? " · High Command" : ""}</div>
        </div>
        <div class="avatar">${user.avatar ? "" : initials}</div>
        <div id="profile-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:8px;background:var(--card,#1e293b);border:1px solid var(--border,#334155);border-radius:10px;overflow:hidden;min-width:170px;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.3)">
          <button id="menu-pengaturan-profil" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:inherit;cursor:pointer;font-size:13px">Pengaturan Profil</button>
          <button id="menu-ganti-password" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:inherit;cursor:pointer;font-size:13px;border-top:1px solid var(--border,#334155)">Ganti Password</button>
          <button id="menu-logout" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:inherit;cursor:pointer;font-size:13px;border-top:1px solid var(--border,#334155)">Logout</button>
        </div>
      </div>
    </div>
    <div class="marquee-bar">
      <div class="marquee-track">
        <span class="marquee-text">${MARQUEE_TEXT}</span>
        <span class="marquee-text">${MARQUEE_TEXT}</span>
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
  document.getElementById("menu-pengaturan-profil").addEventListener("click", () => {
    menu.style.display = "none";
    openProfileSettingsModal(user);
  });
  initNotif(user);
}

// Kompres foto profil di browser sebelum dikirim (sama alasannya kayak foto
// bukti absensi di dashboard.html) — tapi avatar dibuat persegi & lebih kecil
// karena cuma ditampilin sebagai lingkaran mungil di navbar & struktur.
function compressAvatarFile(file, maxDim = 480, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Crop ke tengah jadi bujur sangkar dulu, biar avatar nggak gepeng.
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const dim = Math.min(side, maxDim);
      const canvas = document.createElement("canvas");
      canvas.width = dim;
      canvas.height = dim;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, dim, dim);
      URL.revokeObjectURL(objectUrl);
      let q = quality;
      let dataUrl = canvas.toDataURL("image/jpeg", q);
      while (dataUrl.length * 0.75 > 400 * 1024 && q > 0.35) {
        q -= 0.12;
        dataUrl = canvas.toDataURL("image/jpeg", q);
      }
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Gagal memuat foto.")); };
    img.src = objectUrl;
  });
}

// Modal Pengaturan Profil — di-inject sekali ke <body>, dipakai di semua
// halaman yang manggil renderNavbar. Bisa ubah nama karakter & foto profil.
function openProfileSettingsModal(user) {
  let modal = document.getElementById("profile-settings-modal");
  let pendingAvatar; // undefined = nggak diubah, null = dihapus, string = foto baru
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "profile-settings-modal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-box" style="text-align:left;max-width:360px">
        <h2 style="margin-bottom:14px;text-align:center">Pengaturan Profil</h2>
        <div class="avatar-upload-wrap">
          <div class="avatar-upload-circle" id="ps-avatar-circle">Pilih Foto</div>
          <input type="file" id="ps-avatar-input" accept="image/*" style="display:none">
          <button type="button" class="btn-link" id="ps-avatar-remove" style="display:none">Hapus Foto</button>
        </div>
        <div class="form-group"><label for="ps-nama">Nama Karakter</label><input type="text" id="ps-nama" placeholder="nama character kamu" maxlength="100"></div>
        <div class="error-msg" id="ps-error"></div>
        <div class="sub" id="ps-success" style="color:#22c55e;display:none;margin-bottom:8px">Profil berhasil diperbarui.</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-secondary" id="ps-cancel">Tutup</button>
          <button class="btn btn-primary" id="ps-save">Simpan</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById("ps-cancel").addEventListener("click", () => modal.classList.remove("open"));

    const circle = document.getElementById("ps-avatar-circle");
    const input = document.getElementById("ps-avatar-input");
    circle.addEventListener("click", () => input.click());
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      input.value = "";
      if (!file) return;
      const errorEl = document.getElementById("ps-error");
      errorEl.textContent = "";
      try {
        const dataUrl = await compressAvatarFile(file);
        modal.dataset.pendingAvatar = dataUrl;
        circle.style.backgroundImage = `url('${dataUrl}')`;
        circle.style.backgroundSize = "cover";
        circle.textContent = "";
        document.getElementById("ps-avatar-remove").style.display = "inline-block";
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
    document.getElementById("ps-avatar-remove").addEventListener("click", () => {
      modal.dataset.pendingAvatar = "__remove__";
      circle.style.backgroundImage = "";
      circle.textContent = "Pilih Foto";
      document.getElementById("ps-avatar-remove").style.display = "none";
    });

    document.getElementById("ps-save").addEventListener("click", async () => {
      const errorEl = document.getElementById("ps-error");
      const successEl = document.getElementById("ps-success");
      errorEl.textContent = "";
      successEl.style.display = "none";
      const namaKarakter = document.getElementById("ps-nama").value.trim();

      const body = { updateProfile: true, namaKarakter };
      const pending = modal.dataset.pendingAvatar;
      if (pending === "__remove__") body.avatar = null;
      else if (pending) body.avatar = pending;

      const btn = document.getElementById("ps-save");
      btn.disabled = true; btn.textContent = "Menyimpan...";
      try {
        await api("/api/me", { method: "POST", body: JSON.stringify(body) });
        successEl.style.display = "block";
        delete modal.dataset.pendingAvatar;
        setTimeout(() => window.location.reload(), 700);
      } catch (err) {
        errorEl.textContent = err.message;
      } finally {
        btn.disabled = false; btn.textContent = "Simpan";
      }
    });
  }

  document.getElementById("ps-error").textContent = "";
  document.getElementById("ps-success").style.display = "none";
  document.getElementById("ps-nama").value = user.namaKarakter || "";
  document.getElementById("ps-avatar-remove").style.display = user.avatar ? "inline-block" : "none";
  delete modal.dataset.pendingAvatar;
  const circle = document.getElementById("ps-avatar-circle");
  if (user.avatar) {
    circle.style.backgroundImage = `url('${user.avatar}')`;
    circle.style.backgroundSize = "cover";
    circle.textContent = "";
  } else {
    circle.style.backgroundImage = "";
    circle.textContent = "Pilih Foto";
  }
  modal.classList.add("open");
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


/* ============================================================
   Modal & toast notifikasi (gaya SweetAlert) — menggantikan alert()
   ============================================================ */
/* ============================================================
   notify.js — modal & toast notifikasi (gaya SweetAlert, tanpa library)

   Pasang di SEMUA halaman, sebelum script halaman:
     <script src="notify.js"></script>

   Pemakaian:
     notify.success("Success", "Laporan berhasil dikirim.");
     notify.error("Gagal", e.message);
     notify.info("Info", "Data diperbarui.");
     notify.warning("Perhatian", "Periode klaim hampir habis.");
     if (await notify.confirm("Hapus anggota?", "Aksi ini tidak bisa dibatalkan.")) { ... }
     notify.toast("Tersimpan", "success");      // kartu kecil pojok kanan atas

   Drop-in: alert(...) lama otomatis jadi modal. Kalau teksnya mengandung
   "berhasil" / "sukses" tampil sebagai Success, selain itu sebagai Error.
   confirm() bawaan browser TIDAK bisa diganti otomatis (sinkron), jadi
   ganti manual:  if (!confirm("..."))  ->  if (!(await notify.confirm("...")))
   ============================================================ */
(function () {

  var css = `
  :root { --nt-accent: var(--red, #ff7aa2); --nt-accent-dark: var(--red-light, #ff99cc); }
  .nt-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: flex-start; justify-content: center;
    padding: 12vh 16px 16px; background: rgba(0,0,0,.45); opacity: 0; transition: opacity .18s ease; }
  .nt-overlay.show { opacity: 1; }
  .nt-box { width: 100%; max-width: 478px; background: #fff; color: #545454; border-radius: 6px; padding: 0 0 22px;
    box-shadow: 0 10px 40px rgba(0,0,0,.3); transform: scale(.85); opacity: 0;
    transition: transform .22s cubic-bezier(.2,.9,.3,1.2), opacity .18s ease; font-family: var(--font-body, inherit); }
  .nt-overlay.show .nt-box { transform: none; opacity: 1; }
  .nt-icon { position: relative; width: 88px; height: 88px; margin: 32px auto 0; border-radius: 50%; border: 4px solid; box-sizing: content-box; }
  .nt-icon svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .nt-icon.success { border-color: rgba(165,220,134,.3); }
  .nt-icon.error   { border-color: #f27474; }
  .nt-icon.warning { border-color: #f8bb86; }
  .nt-icon.info    { border-color: #3fc3ee; }
  .nt-icon.question{ border-color: #c9dae1; }
  .nt-ring { fill: none; stroke: #a5dc86; stroke-width: 4; stroke-linecap: round; stroke-dasharray: 80 400; stroke-dashoffset: 0; opacity: .0; }
  .nt-icon.success .nt-ring { opacity: .55; animation: nt-spin 1.1s ease-out both; }
  .nt-check, .nt-x1, .nt-x2 { fill: none; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
  .nt-check { stroke: #a5dc86; stroke-dasharray: 60; stroke-dashoffset: 60; animation: nt-draw .45s .3s ease-out forwards; }
  .nt-x1, .nt-x2 { stroke: #f27474; stroke-dasharray: 40; stroke-dashoffset: 40; animation: nt-draw .3s .3s ease-out forwards; }
  .nt-x2 { animation-delay: .5s; }
  .nt-sym { font-size: 52px; font-weight: 700; line-height: 80px; text-align: center; animation: nt-pop .4s .2s ease-out both; }
  .nt-icon.warning .nt-sym { color: #f8bb86; } .nt-icon.info .nt-sym { color: #3fc3ee; } .nt-icon.question .nt-sym { color: #87adbd; }
  .nt-title { margin: 26px 0 0; padding: 0 24px; text-align: center; font-size: 27px; font-weight: 600; color: #595959; }
  .nt-text { margin: 22px 24px 0; font-size: 15px; line-height: 1.5; color: #6b6b6b; text-align: left; white-space: pre-line; word-break: break-word; }
  .nt-actions { display: flex; justify-content: flex-end; gap: 10px; margin: 26px 24px 0; }
  .nt-btn { border: 0; border-radius: 4px; padding: 11px 26px; font-size: 14px; font-weight: 700; color: #fff; cursor: pointer;
    background: var(--nt-accent); transition: background-color .15s, transform .1s; }
  .nt-btn:hover { background: var(--nt-accent-dark); }
  .nt-btn:active { transform: scale(.97); }
  .nt-btn:focus-visible { outline: 3px solid rgba(0,0,0,.25); outline-offset: 2px; }
  .nt-btn.nt-cancel { background: #e5e5e5; color: #555; }
  .nt-btn.nt-cancel:hover { background: #d6d6d6; }
  .nt-btn.nt-danger { background: #e5484d; } .nt-btn.nt-danger:hover { background: #f06a6e; }

  .nt-toasts { position: fixed; top: 14px; right: 14px; z-index: 10001; display: flex; flex-direction: column; gap: 10px; width: min(340px, calc(100vw - 28px)); pointer-events: none; }
  .nt-toast { pointer-events: auto; position: relative; overflow: hidden; display: flex; gap: 12px; align-items: center; background: #fff; color: #545454;
    border-radius: 6px; padding: 13px 14px; box-shadow: 0 6px 22px rgba(0,0,0,.22); border-left: 5px solid #a5dc86;
    transform: translateX(120%); opacity: 0; transition: transform .28s cubic-bezier(.2,.9,.3,1), opacity .2s; font: 14px/1.4 var(--font-body, inherit); cursor: pointer; }
  .nt-toast.show { transform: none; opacity: 1; }
  .nt-toast.error { border-left-color: #f27474; } .nt-toast.warning { border-left-color: #f8bb86; } .nt-toast.info { border-left-color: #3fc3ee; }
  .nt-toast b { display: block; font-size: 14px; color: #444; }
  .nt-toast-bar { position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; background: rgba(0,0,0,.12); transform-origin: left; animation: nt-bar linear forwards; }
  .nt-toast.success .nt-toast-bar { background: #a5dc86; } .nt-toast.error .nt-toast-bar { background: #f27474; }
  .nt-toast.warning .nt-toast-bar { background: #f8bb86; } .nt-toast.info .nt-toast-bar { background: #3fc3ee; }

  @keyframes nt-draw { to { stroke-dashoffset: 0; } }
  @keyframes nt-spin { from { transform: rotate(-90deg); transform-origin: 50% 50%; } to { transform: rotate(270deg); transform-origin: 50% 50%; } }
  @keyframes nt-pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes nt-bar { to { transform: scaleX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .nt-overlay, .nt-box, .nt-toast { transition-duration: .01ms !important; }
    .nt-ring, .nt-check, .nt-x1, .nt-x2, .nt-sym, .nt-toast-bar { animation-duration: .01ms !important; animation-delay: 0s !important; }
  }`;
  var st = document.createElement("style");
  st.id = "nt-css";
  st.textContent = css;
  document.head.appendChild(st);

  var NS = "http://www.w3.org/2000/svg";
  function iconEl(type) {
    var d = document.createElement("div");
    d.className = "nt-icon " + type;
    if (type === "success") {
      d.innerHTML = '<svg viewBox="0 0 88 88"><circle class="nt-ring" cx="44" cy="44" r="42"/><path class="nt-check" d="M26 46 L39 59 L63 32"/></svg>';
    } else if (type === "error") {
      d.innerHTML = '<svg viewBox="0 0 88 88"><path class="nt-x1" d="M30 30 L58 58"/><path class="nt-x2" d="M58 30 L30 58"/></svg>';
    } else {
      var s = document.createElement("div");
      s.className = "nt-sym";
      s.textContent = type === "warning" ? "!" : type === "question" ? "?" : "i";
      d.appendChild(s);
    }
    return d;
  }

  var queue = Promise.resolve();

  // Inti: tampilkan modal, resolve(true) kalau OK, resolve(false) kalau batal.
  function modal(type, title, text, opts) {
    opts = opts || {};
    var job = queue.then(function () {
      return new Promise(function (resolve) {
        var prevFocus = document.activeElement;
        var ov = document.createElement("div");
        ov.className = "nt-overlay";
        var box = document.createElement("div");
        box.className = "nt-box";
        box.setAttribute("role", opts.cancel ? "alertdialog" : "dialog");
        box.setAttribute("aria-modal", "true");
        box.appendChild(iconEl(type));
        var h = document.createElement("h2");
        h.className = "nt-title";
        h.textContent = title || "";
        box.appendChild(h);
        if (text) {
          var p = document.createElement("div");
          p.className = "nt-text";
          p.textContent = text; // textContent: aman dari XSS
          box.appendChild(p);
        }
        var act = document.createElement("div");
        act.className = "nt-actions";
        var cancelBtn = null;
        if (opts.cancel) {
          cancelBtn = document.createElement("button");
          cancelBtn.className = "nt-btn nt-cancel";
          cancelBtn.textContent = opts.cancel;
          act.appendChild(cancelBtn);
        }
        var ok = document.createElement("button");
        ok.className = "nt-btn" + (opts.danger ? " nt-danger" : "");
        ok.textContent = opts.ok || "OK";
        act.appendChild(ok);
        box.appendChild(act);
        ov.appendChild(box);
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add("show"); });
        ok.focus();

        function close(val) {
          document.removeEventListener("keydown", onKey, true);
          ov.classList.remove("show");
          setTimeout(function () { ov.remove(); }, 200);
          if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
          resolve(val);
        }
        function onKey(e) {
          if (e.key === "Escape") { e.preventDefault(); close(false); }
          else if (e.key === "Tab") { // jebak fokus di dalam modal
            var f = box.querySelectorAll("button");
            var first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
        document.addEventListener("keydown", onKey, true);
        ok.addEventListener("click", function () { close(true); });
        if (cancelBtn) cancelBtn.addEventListener("click", function () { close(false); });
        ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(false); });
      });
    });
    queue = job.catch(function () {});
    return job;
  }

  var toastHost = null;
  function toast(message, type, ms, opts) {
    opts = opts || {};
    type = type || "success";
    ms = ms || 3500;
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "nt-toasts";
      toastHost.setAttribute("aria-live", "polite");
      document.body.appendChild(toastHost);
    }
    var t = document.createElement("div");
    t.className = "nt-toast " + type;
    var body = document.createElement("div");
    var b = document.createElement("b");
    b.textContent = opts.title || { success: "Success", error: "Error", warning: "Perhatian", info: "Info" }[type] || "";
    var m = document.createElement("span");
    m.textContent = message;
    body.appendChild(b); body.appendChild(m);
    var bar = document.createElement("div");
    bar.className = "nt-toast-bar";
    bar.style.animationDuration = ms + "ms";
    t.appendChild(body); t.appendChild(bar);
    toastHost.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    var timer = setTimeout(remove, ms);
    function remove() {
      clearTimeout(timer);
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 300);
    }
    t.addEventListener("click", function () {
      remove();
      if (opts.href) location.href = opts.href;
    });
  }

  window.notify = {
    success: function (t, x) { return modal("success", t || "Success", x); },
    error:   function (t, x) { return modal("error", t || "Error", x); },
    warning: function (t, x) { return modal("warning", t || "Perhatian", x); },
    info:    function (t, x) { return modal("info", t || "Info", x); },
    confirm: function (t, x, o) {
      o = o || {};
      return modal("question", t, x, { ok: o.ok || "Ya", cancel: o.cancel || "Batal", danger: !!o.danger });
    },
    toast: toast
  };

  // alert() lama -> modal otomatis (tidak perlu ubah kode lama)
  window.alert = function (msg) {
    var s = String(msg == null ? "" : msg);
    if (/berhasil|sukses|terkirim|tersimpan|diperbarui/i.test(s)) notify.success("Success", s);
    else notify.error("Error", s);
  };
})();


/* ============================================================
   Lonceng notifikasi + animasi angka (v2)
   ============================================================ */
const NX_BELL_SVG = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const NX_TIPE_LABEL = { sukses: "success", bahaya: "error", info: "info", peringatan: "warning" };

function nxEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function nxRel(iso) {
  const d = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return "baru saja";
  if (d < 3600) return Math.floor(d / 60) + " mnt lalu";
  if (d < 86400) return Math.floor(d / 3600) + " jam lalu";
  return Math.floor(d / 86400) + " hari lalu";
}

function initNotif(user) {
  const wrap = document.getElementById("nx-bell-wrap");
  if (!wrap) return;
  const bell = document.getElementById("nx-bell");
  const badge = document.getElementById("nx-badge");
  const panel = document.getElementById("nx-panel");
  const list = document.getElementById("nx-list");
  const seenKey = "nx_seen_" + user.id;
  let items = [];

  function render(unread) {
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    list.innerHTML = items.length
      ? items.map((n) => `<button type="button" class="nx-item ${nxEsc(n.tipe)}${n.baca ? "" : " unread"}" data-id="${nxEsc(n.id)}" data-href="${nxEsc(n.href)}">
          <span class="nx-dot"></span>
          <span class="nx-body"><b>${nxEsc(n.judul)}</b><span>${nxEsc(n.isi)}</span><small>${nxRel(n.waktu)}</small></span>
        </button>`).join("")
      : '<div class="nx-empty">Belum ada notifikasi.</div>';
  }

  function toastBaru() {
    let last = null;
    try { last = localStorage.getItem(seenKey); } catch (e) { /* storage diblokir */ }
    const newest = items.reduce((m, n) => (n.waktu > m ? n.waktu : m), "");
    if (last) {
      const baru = items.filter((n) => !n.baca && n.waktu > last).reverse().slice(-3);
      baru.forEach((n, i) => setTimeout(() => notify.toast(n.isi, NX_TIPE_LABEL[n.tipe] || "info", 5000, { title: n.judul, href: n.href }), i * 450));
      if (baru.length) { bell.classList.remove("ring"); void bell.offsetWidth; bell.classList.add("ring"); }
    }
    if (newest) { try { localStorage.setItem(seenKey, newest); } catch (e) { /* abaikan */ } }
  }

  async function tarik() {
    try {
      const d = await api("/api/me?view=notif");
      items = d.notif || [];
      render(d.unread || 0);
      toastBaru();
    } catch (e) { /* diam: notifikasi bukan fitur kritikal */ }
  }

  bell.addEventListener("click", () => {
    const buka = panel.hidden;
    panel.hidden = !buka;
    bell.setAttribute("aria-expanded", String(buka));
    if (buka) { render(items.filter((n) => !n.baca).length); tarik(); }
  });
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) { panel.hidden = true; bell.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") panel.hidden = true; });

  document.getElementById("nx-readall").addEventListener("click", async () => {
    items.forEach((n) => { n.baca = true; });
    render(0);
    try { await api("/api/me", { method: "POST", body: JSON.stringify({ notifBaca: "all" }) }); } catch (e) { /* abaikan */ }
  });
  list.addEventListener("click", async (e) => {
    const el = e.target.closest(".nx-item");
    if (!el) return;
    const n = items.find((x) => x.id === el.dataset.id);
    if (n && !n.baca) {
      n.baca = true;
      render(items.filter((x) => !x.baca).length);
      try { await api("/api/me", { method: "POST", body: JSON.stringify({ notifBaca: n.id }) }); } catch (err) { /* abaikan */ }
    }
    if (el.dataset.href) location.href = el.dataset.href;
  });

  tarik();
  setInterval(() => { if (!document.hidden) tarik(); }, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tarik(); });
}

/* ====== Animasi angka & progress bar — otomatis, tanpa ubah kode halaman ======
   Cukup pantau elemen angka (.stat-card .value, .pill .num, .tile b) dan
   .progress-fill. Begitu isinya diganti script halaman, angkanya naik dari 0
   dan bar-nya terisi dari kiri. Mati sendiri kalau "reduce motion" aktif. */
(function nxMotion() {
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const SEL_NUM = ".stat-card .value, .pill .num, .tile b";

  function parse(text) {
    const m = String(text).match(/^(\D*?)(\d[\d.,]*)(.*)$/);
    if (!m) return null;
    const raw = m[2];
    let nilai, des = 0, idFmt = false;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) { idFmt = true; const p = raw.split(","); nilai = parseFloat(p[0].replace(/\./g, "") + (p[1] ? "." + p[1] : "")); des = p[1] ? p[1].length : 0; }
    else { nilai = parseFloat(raw.replace(/,/g, ".")); des = (raw.split(/[.,]/)[1] || "").length; if (raw.split(/[.,]/).length > 2) return null; }
    if (!isFinite(nilai) || nilai === 0) return null;
    return { pre: m[1], suf: m[3], nilai, des, idFmt };
  }
  function fmt(p, v) {
    const s = p.idFmt ? v.toLocaleString("id-ID", { minimumFractionDigits: p.des, maximumFractionDigits: p.des }) : v.toFixed(p.des);
    return p.pre + s + p.suf;
  }
  function hitung(el) {
    if (el._nxBusy) return;
    const teks = el.textContent;
    if (el._nxLast === teks) return;
    const p = parse(teks);
    el._nxLast = teks;
    if (!p) return;
    const mulai = performance.now(), dur = 750;
    el._nxBusy = true;
    (function tick(t) {
      const k = Math.min(1, (t - mulai) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(p, p.nilai * e);
      if (k < 1) requestAnimationFrame(tick);
      else { el.textContent = teks; el._nxBusy = false; }
    })(mulai);
  }
  function bar(el) {
    if (el._nxBusy) return;
    const target = el.style.width;
    if (!target || el._nxW === target) return;
    el._nxW = target;
    el._nxBusy = true;
    el.style.width = "0%";
    void el.offsetWidth;
    requestAnimationFrame(() => { el.style.width = target; setTimeout(() => { el._nxBusy = false; }, 50); });
  }
  function pindai(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL_NUM)) hitung(root);
    if (root.matches && root.matches(".progress-fill")) bar(root);
    root.querySelectorAll && root.querySelectorAll(SEL_NUM).forEach(hitung);
    root.querySelectorAll && root.querySelectorAll(".progress-fill").forEach(bar);
  }
  const mo = new MutationObserver((muts) => {
    muts.forEach((m) => {
      const t = m.type === "characterData" ? m.target.parentElement : m.target;
      if (t) pindai(t);
      m.addedNodes && m.addedNodes.forEach(pindai);
    });
  });
  function mulai() { mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style"] }); pindai(document.body); }
  if (document.body) mulai(); else document.addEventListener("DOMContentLoaded", mulai);
})();


// Tombol lihat/sembunyikan password di form login/daftar/reset (class .eye di dalam .field).
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest(".eye");
  if (!b) return;
  const inp = b.parentElement.querySelector("input");
  if (!inp) return;
  inp.type = inp.type === "password" ? "text" : "password";
  b.textContent = inp.type === "password" ? "Lihat" : "Sembunyi";
});
