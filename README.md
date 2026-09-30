# Kepolisian Nexotis — login username/password (Vercel)

Versi ini nggak pakai Discord sama sekali — login pakai username & password
biasa, dan **admin (High Command) bisa nambah/edit/hapus akun anggota**
langsung dari Panel Rekap (tab "Kelola Anggota").

Struktur tetap serverless (cocok Vercel):
- **`/api/*.js`** → tiap file jadi 1 serverless function
- **File HTML/CSS/JS di root** → disajikan sebagai static hosting otomatis
- **Sesi login** → cookie yang ditandatangani (HMAC), stateless
- **Data (users & absensi)** → **Upstash Redis** — WAJIB, karena admin harus
  bisa lihat data SEMUA anggota, bukan cuma browser dia sendiri (makanya
  `localStorage` nggak bisa dipakai buat ini)
- **Password** → di-hash pakai `scrypt` bawaan Node (nggak pernah disimpan
  polos, dan nggak pernah dikirim balik ke browser lewat API manapun)

## Login: Anggota vs Warga

- **Anggota** — username + password (dibuatkan High Command). **Tidak ada
  pendaftaran mandiri lagi** (`register.html` dihapus, endpoint `daftar` dicabut).
- **Warga / publik** — tombol "Login dengan Discord" di `index.html`, masuk ke
  `warga.html` (dashboard publik: profil Discord + papan pengumuman/iklan).
  Data warga disimpan terpisah di key `nexotis:warga`; cookie sesinya beda
  (`nexotis_warga`) jadi warga tidak bisa akses halaman/API anggota.
- Login Discord numpang di `api/auth-login.js` (GET) karena function Vercel
  Hobby sudah mentok 12.

### Forum Kritik & Saran (`forum.html`)
- Warga & anggota bisa bikin postingan (Kritik/Saran) dan saling komen.
- Hapus postingan/komentar: pemilik konten atau High Command.
- Data di key `nexotis:forum` (maks 300 postingan, 200 komentar/postingan),
  ada jeda anti-spam (30 dtk per postingan, 5 dtk per komentar).
- Iklan di dashboard warga tampil sebagai popup (sekali tiap halaman dibuka).

### Setup login Discord (sekali saja)
1. https://discord.com/developers/applications → pilih/buat Application →
   **OAuth2** → copy **Client ID** & **Client Secret**
2. Di **OAuth2 → Redirects**, tambah: `https://DOMAIN-KAMU.vercel.app/api/auth-login`
   (harus persis sama, tanpa garis miring di akhir)
3. Environment Variables Vercel: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
   (opsional `DISCORD_REDIRECT_URI` kalau mau paksa URL redirect tertentu)
4. Redeploy

### Profil warga, label otomatis & sinkron Discord

- **Beranda warga** (`warga.html`): profil + banner Discord, statistik, pengumuman
  resmi, aktivitas forum, papan iklan, aksi cepat.
- **Profil Saya** (`profil.html`): warga bisa ubah **bio** & **nama tampilan**
  (atau ikut nama Discord). Foto profil, banner, nickname server & label
  selalu ikut Discord. Tombol "Sinkronkan sekarang" = update dari Discord tanpa logout.
  Bio Discord ("Tentang Saya") **tidak bisa ditarik** (Discord tidak memberi aksesnya
  ke aplikasi lain), jadi bio diisi manual. Anggota (akun username/password)
  isi bio lewat menu **Pengaturan Profil**.
- **Label di forum otomatis** dan selalu dihitung ulang saat halaman dibuka:
  - Akun anggota → **High Command** (kalau `isHighCommand`) atau **Anggota PD**, + pangkat.
  - Warga Discord → **Warga**, atau label dari role server Discord (opsional, lihat di bawah).
- **Label = tampilan saja, BUKAN hak akses.** Hak High Command di forum (sematkan,
  kunci, pindah, hapus punya orang lain) hanya dari akun anggota dengan flag
  High Command. Warga yang punya role HC di Discord dapat *label* HC, tapi tetap
  tidak bisa moderasi. Kalau seorang HC punya sesi anggota + sesi Discord sekaligus,
  sesi anggota yang dipakai (jadi hak HC-nya tidak hilang).
- Nama tampilan warga tidak boleh mengandung "high command", "admin", "moderator",
  "petinggi", "resmi", atau "HC" (cegah nyamar).

#### Env var opsional: label dari role Discord
Kalau tidak diisi, semua warga cuma berlabel **Warga** (semua fitur lain tetap jalan).
Ambil ID lewat Discord: Pengaturan → Advanced → **Developer Mode** ON, lalu klik
kanan server / role → **Copy ID**.

| Env var | Isi |
|---|---|
| `DISCORD_GUILD_ID` | ID server Discord Kepolisian Nexotis |
| `DISCORD_ROLE_HC` | ID role High Command (boleh banyak, pisah koma) |
| `DISCORD_ROLE_ANGGOTA` | ID role Anggota PD (boleh banyak, pisah koma) |
| `DISCORD_ROLE_LAIN` | label tambahan: `idRole=Label,idRole=Label` (mis. `123=VIP Warga`) |

Begitu `DISCORD_GUILD_ID` diisi, login Discord ikut meminta izin **baca role di server**
(`guilds.members.read`). Warga lama akan diminta menyetujui izin itu sekali lagi.
Role disegarkan tiap login / klik "Sinkronkan sekarang" — kalau role dicabut di Discord,
labelnya hilang setelah warga itu login/sinkron lagi. Tidak perlu bot & tidak ada
endpoint baru di `/api` (masih 12 function).

## Alur pemakaian

1. **Setup awal (SEKALI SAJA)** — buka `/setup.html`, isi `SETUP_SECRET`
   (dari Environment Variables) + username/password buat akun High Command
   pertama. Halaman ini otomatis nggak bisa dipakai lagi setelah ada 1 user.
2. Login pakai akun itu di `/index.html`
3. Buka **Panel Rekap → tab "Kelola Anggota"** → tambah akun buat anggota lain
   (isi username, password, pangkat, dan level akses: Anggota Biasa / High Command)
4. Anggota itu bisa langsung login pakai username/password yang kamu buatkan

## Setup & Deploy

1. **Push project ini ke GitHub**, lalu **Import ke Vercel**
   (Vercel otomatis kenali struktur static + serverless functions ini)

2. **Daftar Upstash Redis**
   - https://upstash.com → daftar gratis
   - Create Database → tipe **Redis**, region terdekat
   - Bagian **REST API** → copy `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`

3. **Isi Environment Variables** di Vercel (Project Settings → Environment Variables):
   - `SESSION_SECRET` — generate: `openssl rand -base64 32`
   - `SETUP_SECRET` — string acak bebas, buat bikin admin pertama
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

4. **Deploy**

5. Buka `https://domain-kamu.vercel.app/setup.html`, buat akun admin pertama

6. Login, lalu mulai tambah anggota lain dari Panel Rekap

## Fitur baru: Iklan & aturan Gaji

- **Iklan** — High Command bisa tambah iklan (foto + teks) dari **Panel Rekap
  → tab "Iklan"**. Iklan yang aktif otomatis muncul di Dashboard semua
  anggota (di bagian "📢 Papan Iklan"). Foto iklan diupload ke Cloudinary
  (env var `CLOUDINARY_CLOUD_NAME` & `CLOUDINARY_UPLOAD_PRESET` — sama yang
  dipakai buat foto bukti absensi).
- **Klaim Gaji Mingguan** — sekarang cuma bisa diambil **Senin–Rabu**. Kalau
  lewat Rabu belum diklaim, jatah minggu itu **hangus** (nggak bisa diambil
  susulan Kamis–Minggu), dan minggu berikutnya mulai dari 0 lagi.
- **Webhook Logs Gaji dipisah** dari webhook utama (`DISCORD_WEBHOOK_URL`,
  yang dipakai buat log absensi & pendaftaran) — isi env var
  `DISCORD_WEBHOOK_GAJI_URL` di Vercel kalau mau notifikasi klaim gaji
  (format "LOGS GAJI") masuk ke channel Discord yang beda.

## Catatan penting

- **Belum di-deploy/test di sandbox pembuatan ini** (tidak ada akses jaringan)
  — kalau ada error saat deploy beneran, kirim ke saya, saya bantu debug.
- **`/setup.html` otomatis terkunci sendiri** begitu ada 1 user — jadi aman
  ditinggal ter-deploy, orang lain nggak bisa bikin akun admin baru lewat situ.
  Tapi tetap isi `SETUP_SECRET` dengan string yang susah ditebak untuk jaga-jaga.
- **Reset Semua Duty** (Panel Rekap, khusus High Command) menghapus SELURUH
  riwayat absensi semua anggota secara permanen — tidak ada undo.
- **Hapus anggota** juga permanen — riwayat absensi anggota itu tetap
  tersimpan di database (jadi nggak ikut kehapus), tapi dia nggak akan bisa
  login lagi.
- Kalau lupa password akun High Command satu-satunya dan nggak ada akun HC
  lain: cara paling gampang buat reset adalah lewat halaman Upstash Console
  (bagian Data Browser) → cari key `nexotis:users` → edit manual passwordHash
  (perlu generate hash baru dulu; kalau butuh, tanya saya cara generate-nya).
