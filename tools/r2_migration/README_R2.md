# Cloudflare R2 migration for The Love Walk 2026

This tool uploads the original photos, including Canon CR2, to a private R2 bucket. It also creates display-sized JPEG previews and WebP thumbnails. The manifest is published only after every image has uploaded successfully.

## Create the bucket and API token
1. Open https://dash.cloudflare.com/ and sign in.
2. Go to Storage & databases > R2 Object Storage and create a bucket named the-love-walk-fotos (or use another name).
3. Under R2 Overview > Manage API Tokens, create a token with Object Read & Write, limited to this bucket.
4. Keep the Account ID, Access Key ID, and Secret Access Key private. Official instructions: https://developers.cloudflare.com/r2/get-started/s3/
5. Copy .env.r2.example to .env.r2 and put the values in that local file. Never commit .env.r2 or paste its secret key into chat.

## Upload from Windows
- Install Python 3.11 or 3.12.
- Keep a local copy of the original images.
- Run INICIAR_MIGRACAO.bat and select the folder with JPG, PNG, WebP, and RAW images.
- If any file fails, the manifest is not published. Review r2_upload_errors.json and run the tool again.

## Configure Render
In the the-love-walk-2026-album service Environment settings, add:
- R2_ACCOUNT_ID (or R2_ENDPOINT_URL)
- R2_BUCKET
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_PREFIX = the-love-walk-2026

The backend loads the manifest from the private bucket and redirects media requests to temporary signed URLs. Do not remove local or GitHub copies until the public album has been tested after a real deploy.

R2 Standard currently includes 10 GB-month of storage and free egress. Check the current pricing: https://developers.cloudflare.com/r2/pricing/
