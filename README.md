# VIDGEN V1

VIDGEN adalah **AI Multi‑Vendor Music Video Generator**. V1 ini dibuat sebagai repository full-stack yang bisa dikembangkan menjadi produksi.

## Yang sudah ada

- PWA responsif desktop/mobile.
- Upload & preview audio lokal.
- Storyboard generator (backend Cloudflare + fallback lokal).
- Scene editor & timeline.
- Multi-vendor UI + Auto Router: Seedance, Google Veo, Runway, Luma.
- Prioritas router: Quality, Balanced, Fast, Cost.
- Fallback vendor switch.
- D1 schema: users, OAuth token, projects, scenes, jobs.
- R2 upload endpoint.
- Google OAuth + scope `drive.file`.
- Google Drive resumable upload dari R2 ke folder `VIDGEN`.
- Luma adapter nyata bila API key tersedia.
- Veo adapter untuk Vertex AI `predictLongRunning` bila token/project tersedia.
- Seedance dan Runway adapter configurable agar endpoint akun/region bisa disesuaikan tanpa merombak aplikasi.
- PWA manifest + service worker.
- GitHub Actions Cloudflare deploy workflow.

> V1 belum melakukan final stitching/FFmpeg di Worker. Untuk videoclip final panjang, gunakan worker/container terpisah (Cloudflare Containers, Railway, VPS, atau service FFmpeg) lalu simpan hasil final ke R2 dan panggil endpoint archive Drive.

## Arsitektur

```text
Browser / PWA
    ↓
Cloudflare Worker + Static Assets
    ├── D1: project / scene / job / OAuth
    ├── R2: audio / reference / scene / final
    ├── Auto Router
    │    ├── Seedance
    │    ├── Veo
    │    ├── Runway
    │    └── Luma
    └── Google Drive OAuth → /VIDGEN archive
```

## Local preview frontend

Frontend bisa langsung dibuka dengan server statis, tetapi API akan masuk **Demo lokal**.

```bash
cd vidgen-v1/public
python -m http.server 8080
```

Buka `http://localhost:8080`.

## Local full-stack Cloudflare

1. Install Node.js 20/22.
2. Jalankan:

```bash
npm install
npx wrangler login
```

3. Buat D1:

```bash
npx wrangler d1 create vidgen-db
```

Salin `database_id` ke `wrangler.jsonc`.

4. Buat R2 bucket:

```bash
npx wrangler r2 bucket create vidgen-media
```

5. Terapkan migration:

```bash
npm run db:migrate:remote
```

6. Salin `.dev.vars.example` ke `.dev.vars` dan isi secret untuk pengembangan lokal.

7. Jalankan:

```bash
npm run dev
```

## Production secrets

Jangan taruh API key di GitHub. Gunakan:

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put LUMA_API_KEY
npx wrangler secret put RUNWAY_API_KEY
npx wrangler secret put RUNWAY_API_BASE
npx wrangler secret put SEEDANCE_API_KEY
npx wrangler secret put SEEDANCE_API_BASE
npx wrangler secret put VEO_ACCESS_TOKEN
npx wrangler secret put VEO_PROJECT_ID
```

Untuk Vertex AI produksi, sebaiknya V1.1 mengganti `VEO_ACCESS_TOKEN` statis dengan service-account/OAuth token minting supaya token tidak perlu diperbarui manual.

## Google OAuth / Drive

Di Google Cloud Console:

- Aktifkan **Google Drive API**.
- Buat OAuth Web Client.
- Tambahkan redirect URI:

```text
https://DOMAIN-VIDGEN/oauth/google/callback
```

- Scope yang dipakai aplikasi:

```text
openid
email
profile
https://www.googleapis.com/auth/drive.file
```

`drive.file` membatasi akses aplikasi pada file yang dibuat/dipilih untuk aplikasi, sehingga lebih sempit daripada akses seluruh Drive.

## Deploy Cloudflare

Setelah D1/R2 dan secrets siap:

```bash
npm install
npm run deploy
```

### GitHub → Cloudflare

Repository ini juga menyertakan `.github/workflows/deploy-cloudflare.yml`.
Tambahkan GitHub Repository Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Push ke branch `main` akan menjalankan deploy.

Alternatif yang lebih sederhana: hubungkan repository langsung menggunakan Cloudflare Workers & Pages GitHub App.

## Catatan GitHub Pages

GitHub Pages hanya cocok untuk frontend demo. **Jangan gunakan GitHub Pages sebagai deployment produksi VIDGEN**, karena tidak menyediakan backend rahasia untuk vendor API, OAuth Google Drive, D1, atau R2. Simpan source di GitHub dan deploy runtime ke Cloudflare.
