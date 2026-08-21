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
