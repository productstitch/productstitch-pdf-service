# Product Stitch PDF Service

A tiny Playwright (headless Chromium) service that renders posted HTML to PDF.

## Endpoints
- `GET /healthz` → returns `ok`
- `POST /pdf` (JSON):
```json
{
  "html": "<!doctype html><html><body><h1>Hello</h1></body></html>",
  "baseURL": null,
  "format": "Letter",
  "margin": { "top": "12mm", "right": "12mm", "bottom": "16mm", "left": "12mm" },
  "filename": "document.pdf"
}
```

## Local run
```bash
npm ci
node server.js
# then hit http://localhost:3000/healthz
```

## Docker
```bash
docker build -t productstitch-pdf:latest .
docker run -p 3000:3000 --rm productstitch-pdf:latest
```

