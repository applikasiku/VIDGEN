# VIDGEN V1.3

VIDGEN adalah **AI Multi-Vendor Music Video Generator** berbasis Cloudflare Workers + Static Assets.

## Status deployment

Repository ini sudah disiapkan untuk deployment Cloudflare dengan:

- Cloudflare Worker API + PWA/static assets dalam satu deployment.
- D1 database binding `DATABASE_V2`.
- R2 media binding `STORAGE_V2`.
- GitHub Actions auto-deploy pada push ke `main`.
- D1 migrations otomatis sesudah Worker berhasil dipublish.
- Health check publik di `/api/health`.
- Google Drive OAuth + resumable archive.
- Adapter Seedance, Google Veo, Runway, dan Luma.
- API keys tetap di Cloudflare Secrets, tidak disimpan di GitHub.

## Arsitektur

```text
GitHub (applikasiku/VIDGEN)
          ↓
Cloudflare Workers
├── Static Assets / PWA
├── Worker API
├── D1 (DB)
├── R2 (MEDIA)
├── Seedance / Veo / Runway / Luma
└── Google Drive archive
```

## Deploy melalui Cloudflare Dashboard — paling mudah

1. Buka Cloudflare Dashboard → **Workers & Pages**.
2. Pilih **Create / Import a repository**.
3. Hubungkan GitHub dan pilih repository `applikasiku/VIDGEN`.
4. Branch production: `main`.
5. Build command dapat dikosongkan.
6. Deploy command: `npm run deploy`.
7. Simpan dan deploy.

Production saat ini memakai binding eksplisit:

- D1: `DATABASE_V2` → `vidgen-db`
- R2: `STORAGE_V2` → `vidgen-media`


Setelah deploy, cek:

```text
https://<worker-domain>/api/health
```

Respons yang benar berisi `"ok": true`.

## Deploy melalui GitHub Actions

Workflow tersedia di:

```text
.github/workflows/deploy-cloudflare.yml
```

Tambahkan repository secrets di GitHub:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Lalu push ke `main` atau jalankan workflow secara manual.

API token Cloudflare harus memiliki izin yang cukup untuk Workers Scripts, D1, dan R2.

## Local development

Gunakan Node.js 20+:

```bash
npm install
npm run db:migrate:local
npm run dev
```

Buka URL yang diberikan Wrangler.

## Production secrets

Jangan masukkan key berikut ke repository. Tambahkan melalui Cloudflare → Worker → Settings → Variables and Secrets atau Wrangler:

```bash
npx wrangler secret put SESSION_SECRET

npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

npx wrangler secret put SEEDANCE_API_KEY
npx wrangler secret put SEEDANCE_API_BASE

npx wrangler secret put RUNWAY_API_KEY
npx wrangler secret put RUNWAY_API_BASE

npx wrangler secret put LUMA_API_KEY

npx wrangler secret put VEO_ACCESS_TOKEN
npx wrangler secret put VEO_PROJECT_ID
```

Provider tanpa credential akan tetap tampil sebagai **demo/fallback mode**.

## Google Drive

Aktifkan Google Drive API dan buat OAuth Web Client. Redirect URI:

```text
https://DOMAIN-VIDGEN/oauth/google/callback
```

Scope:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

Output final dapat diarsipkan ke folder `VIDGEN` di Google Drive pengguna.

## Perintah penting

```bash
npm run dev
npm run cf:check
npm run deploy:worker
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` melakukan **Worker deploy → D1 migration** sehingga deployment pertama dapat mem-provision resource terlebih dahulu.

## Catatan produksi

V1 belum melakukan final stitching/FFmpeg di Worker. Scene video dapat dibuat oleh vendor dan disimpan ke R2; composer video panjang sebaiknya memakai service/container terpisah sebelum hasil akhirnya diarsipkan ke Google Drive.


## Perbaikan deployment 1.0.2

Cloudflare automatic provisioning memberi nama resource berdasarkan Worker dan binding. Jika database lama bernama `vidgen-db` sudah ada tetapi belum terikat ke project, deployment draft binding dapat gagal dengan pesan `A database with that name already exists`.

V1.0.2 menggunakan Worker `vidgen-production` sehingga resource production baru tidak berbenturan dengan resource lama. Backend juga menjalankan bootstrap schema idempotent (`CREATE TABLE IF NOT EXISTS`) sebelum endpoint database digunakan, jadi deploy command sederhana `npx wrangler deploy` tetap dapat menghasilkan aplikasi yang bisa dibuka tanpa langkah migration terpisah pada deployment pertama.

Setelah deployment sukses, endpoint pemeriksaan:

```text
/api/health
```

Endpoint ini tidak bergantung pada D1 dan akan tetap merespons saat Worker berhasil dipublish.


## Perbaikan deployment 1.0.3

Cloudflare Workers Builds untuk project ini mengharapkan nama Worker `vidgen` dan akan menimpa nama lain melalui CI. Karena draft binding lama `DB` memicu auto-provisioning resource bernama `vidgen-db` yang sudah ada, binding production diganti menjadi:

- D1: `DATABASE_V2`
- R2: `STORAGE_V2`

Kode Worker sudah diperbarui untuk memakai `env.DATABASE_V2` dan `env.STORAGE_V2`. Dengan nama binding baru, automatic provisioning tidak lagi memakai draft binding lama yang berbenturan.


## Rilis 1.1.0

VIDGEN 1.1.0 memperbarui antarmuka dan workflow produksi dengan:

- Sidebar desktop fixed dan layout responsif yang tidak ikut scroll.
- Menu Template Video untuk preset workflow cepat.
- Prompt Library untuk memasukkan konsep visual siap pakai.
- Riwayat proyek berbasis data project backend.
- Pengaturan default rasio, resolusi, durasi scene, vendor, dan penyimpanan Drive.
- Perbaikan panel Analisis & Storyboard serta Pengaturan Video untuk desktop, tablet, dan mobile.
- Sinkronisasi versi frontend/backend/PWA menjadi 1.1.0.
- Perbaikan selector JavaScript pada Template, Prompt Library, dan preferensi agar semua fitur baru dapat dijalankan stabil.

Domain produksi: `https://vidgen.purbalink.web.id`.


## Rilis 1.2.0

VIDGEN 1.2.0 menambahkan workflow produksi berikut:

- Reference Image Library tersimpan privat di Cloudflare R2 dengan metadata di D1.
- Upload JPG/PNG/WEBP maksimal 10 MB, preview melalui Worker, pilih sebagai reference, dan hapus aset.
- Storyboard engine lebih kaya dengan mood, gaya kamera, shot, camera motion, lighting, beat sync, lyric sync, dan continuity guidance.
- Reference image yang dipilih dipakai sebagai guidance identitas/style pada prompt storyboard.
- Render Queue menampilkan ringkasan aktif/selesai/gagal, progress, error, tombol refresh, dan polling status berkala.
- UI aset dan storyboard responsif untuk desktop, tablet, dan mobile.
- Versi frontend/backend/PWA disinkronkan ke 1.2.0.

Catatan: v1.2.0 menyimpan dan mengelola reference image secara nyata di R2. Direct image-conditioning ke setiap provider AI tetap mengikuti kemampuan/API provider dan dapat ditambahkan pada adapter provider berikutnya.


## Rilis 1.3.0

VIDGEN 1.3.0 mengubah editor menjadi workspace project yang bisa dilanjutkan:

- Audio otomatis diupload ke Cloudflare R2 saat dipilih (maksimal 50 MB pada endpoint aplikasi).
- Project menyimpan nama dan R2 key audio sehingga draft dapat dibuka kembali.
- Endpoint aman untuk memutar kembali audio project dari R2.
- Project dapat dibuka, diedit, disimpan ulang, atau dihapus dari menu Proyek.
- Tombol Simpan Draft tersedia sebelum render.
- Reference image terpilih disimpan sebagai relasi project di D1 melalui tabel project_assets.
- Saat project dibuka kembali, scene, render jobs, reference image, audio, genre, style, rasio, resolusi, vendor, dan priority dipulihkan ke editor.
- Penghapusan project juga membersihkan audio project dari R2; scene/job/reference link dibersihkan melalui foreign-key cascade.
- Memperbaiki bug selector genre pada Template preset.
- Versi frontend/backend/PWA disinkronkan ke 1.3.0.
