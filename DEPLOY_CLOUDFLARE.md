# Deploy VIDGEN ke Cloudflare

## Opsi A — Cloudflare Git Integration

1. Cloudflare Dashboard → **Workers & Pages**.
2. Pilih **Create / Import a repository**.
3. Hubungkan repository `applikasiku/VIDGEN`.
4. Production branch: `main`.
5. Deploy command: `npm run deploy`.
6. Deploy.

VIDGEN production memakai binding D1 `DATABASE_V2` ke database `vidgen-db` dan binding R2 `STORAGE_V2` ke bucket `vidgen-media`, sesuai `wrangler.jsonc`.

## Opsi B — GitHub Actions

Tambahkan dua GitHub Repository Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Workflow `.github/workflows/deploy-cloudflare.yml` akan berjalan setiap ada push ke `main`.

## Secret aplikasi

Setelah Worker tercipta, buka Cloudflare Worker → **Settings → Variables and Secrets**.

Minimal untuk keamanan:

- `SESSION_SECRET`

Opsional sesuai fitur:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SEEDANCE_API_KEY`
- `SEEDANCE_API_BASE`
- `RUNWAY_API_KEY`
- `RUNWAY_API_BASE`
- `LUMA_API_KEY`
- `VEO_ACCESS_TOKEN`
- `VEO_PROJECT_ID`

Jangan simpan nilai secret di GitHub source code.

## Test deployment

Buka:

```text
https://<domain-worker>/api/health
```

Target:

```json
{
  "ok": true,
  "app": "VIDGEN",
  "runtime": "cloudflare-workers"
}
```

Kemudian buka root domain untuk memastikan PWA VIDGEN tampil.

## Google Drive

Setelah domain produksi diketahui, masukkan OAuth redirect URI berikut di Google Cloud Console:

```text
https://<domain-vidgen>/oauth/google/callback
```

Aktifkan Google Drive API dan simpan Client ID/Client Secret sebagai Cloudflare secrets.
