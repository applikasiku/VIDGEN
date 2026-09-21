# VIDGEN V1.4.1

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
- Adapter Seedance, Google AI (Veo 3.1 + Omni Flash), Runway, dan Luma.
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
├── Seedance / Google AI / Runway / Luma
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

npx wrangler secret put RUNWAY_API_KEY

npx wrangler secret put LUMA_API_KEY

npx wrangler secret put GOOGLE_AI_API_KEY
```

Provider tanpa credential akan tetap tampil sebagai **demo/fallback mode**.

## Provider runtime variables

Base URL/model non-secret dikonfigurasi di `wrangler.jsonc`:

- `SEEDANCE_API_BASE` → BytePlus LAS operator endpoint.
- `SEEDANCE_MODEL` → Seedance 2.x model ID.
- `RUNWAY_API_BASE` → `https://api.dev.runwayml.com/v1`.
- `RUNWAY_MODEL` → `gen4.5`.
- `LUMA_MODEL` → `ray-2`.
- `GOOGLE_AI_API_BASE` → Gemini Developer API.
- `GOOGLE_AI_DEFAULT_MODEL` → model Google default untuk project baru.

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


## Rilis 1.4.0

VIDGEN 1.4.0 memperkenalkan **Real Render Pipeline**:

- Adapter provider diperbarui untuk task async Seedance 2.x, Runway Gen-4.5, Luma Ray 2, dan Vertex AI Veo.
- Job scene sekarang menyimpan `scene_id` sehingga status render dapat dipetakan ke scene secara presisi.
- Worker mem-poll task provider, menormalisasi status queued/running/completed/failed, dan memperbarui D1.
- Output video provider yang selesai disalin ke Cloudflare R2 agar link sementara provider tidak menjadi sumber permanen.
- Veo dapat menyimpan output base64 langsung ke R2; Runway/Luma/Seedance menggunakan output URL provider lalu diarsipkan ke R2.
- Reference image diberikan ke provider sebagai temporary signed-by-token media URL; Veo juga menerima bytes base64 untuk JPEG/PNG yang sesuai.
- Fallback vendor bekerja saat submit gagal dan dapat melanjutkan otomatis ke provider lain ketika task async berakhir gagal.
- Scene Inspector menyediakan preview output R2, status scene, edit prompt, pilihan vendor, fallback, dan Regenerate Scene.
- Render Queue melakukan polling dengan interval berjitter dan berhenti otomatis saat tidak ada job aktif.
- Endpoint output scene aman tersedia melalui sesi pengguna.
- PWA, frontend, backend, dan konfigurasi Worker disinkronkan ke 1.4.0.

Catatan produksi: credential provider tetap harus dikonfigurasi di Cloudflare Secrets. Provider yang belum memiliki credential akan tetap menggunakan demo mode dan tidak menghasilkan file video nyata.


## Rilis 1.4.1

VIDGEN 1.4.1 menambahkan **Google Multi-Model Router** melalui Gemini Developer API:

- Google AI memakai satu Cloudflare Secret: `GOOGLE_AI_API_KEY`.
- Model tersedia: `veo-3.1-generate-preview` (Quality), `veo-3.1-fast-generate-preview` (Fast), `veo-3.1-lite-generate-preview` (Lite), dan `gemini-omni-1.1-flash` (Omni 1.1 Flash).
- Veo memakai long-running operation dan dipoll sampai selesai.
- Omni Flash memakai Interactions API dan output video base64 langsung diarsipkan ke R2.
- Reference image JPEG/PNG dapat dikirim ke Google sebagai image conditioning/reference input.
- Pilihan model Google disimpan per project di D1 melalui kolom `google_model` dan dipulihkan ketika project dibuka kembali.
- Scene Inspector dapat memilih model Google saat regenerate satu scene.
- Auto Router sekarang memakai provider `google` sebagai bagian dari routing dan fallback.
- Output Google yang selesai tetap diarsipkan ke Cloudflare R2.
- Perbaikan selector frontend untuk daftar project, aset, scene, vendor, template, dan navigasi.

Tambahkan `GOOGLE_AI_API_KEY` melalui Cloudflare Worker → Settings → Variables and Secrets sebagai **Secret**, bukan build variable.
