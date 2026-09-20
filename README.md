# VIDGEN V1

VIDGEN adalah **AI Multi-Vendor Music Video Generator** berbasis Cloudflare Workers + Static Assets.

## Status deployment

Repository ini sudah disiapkan untuk deployment Cloudflare dengan:

- Cloudflare Worker API + PWA/static assets dalam satu deployment.
- D1 database binding `DB`.
- R2 media binding `MEDIA`.
- **Automatic provisioning** D1 dan R2 pada deployment pertama (Wrangler 4.45+).
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

D1 dan R2 menggunakan draft bindings tanpa ID/nama akun-spesifik. Wrangler akan mem-provision resource dan menghubungkannya ke Worker pada deployment pertama.

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

API token Cloudflare harus memiliki izin yang cukup untuk Workers Scripts serta provisioning D1 dan R2.

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
