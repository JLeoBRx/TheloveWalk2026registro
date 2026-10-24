# Cloudflare R2 integration

The backend uses R2 only when R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and either R2_ENDPOINT_URL or R2_ACCOUNT_ID are configured. Without those values, the local-folder behavior remains enabled.

The uploader creates:
- originals/<relative path> for full-size original files
- previews/<photo-id>.jpg for browser-friendly display images, including RAW renders
- thumbnails/<photo-id>.webp for the gallery grid
- manifest.json for the album catalogue

The bucket can remain private. The backend reads the manifest during startup and redirects image requests to temporary signed URLs. The visible download button returns JPEG previews for RAW files and originals for standard image formats.

Do not delete GitHub/local copies until the R2 upload is complete, Render is configured, and the gallery has been verified.
