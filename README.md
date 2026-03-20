# GenImageClassifier

A self-hosted gallery that watches image folders, extracts AI-generation prompts from file metadata, groups images by prompt, and presents them in a React gallery with hover overlays and a click-to-expand modal.

> Full architecture and design notes: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Quick start

```bash
docker compose up --build
```

- **Gallery** → http://localhost:3000  
- **API docs** → http://localhost:8000/docs

---

## Configuring watched folders

Edit `docker-compose.yml`. The `WATCH_DIRS` environment variable must always list the **container-side** mount paths (never the Windows host paths).

```yaml
environment:
  WATCH_DIRS: /media/folder1,/media/folder2,/media/myfolder
  SCAN_INTERVAL_SECONDS: "10"
volumes:
  - "H:\\My Images:/media/folder1:ro"   # paths with spaces must be quoted
  - ./media/folder2:/media/folder2:ro
  - "D:\\Art:/media/myfolder:ro"
```

---

## Supported prompt sources

| Format | Where the backend looks |
|---|---|
| **Automatic1111 PNG** | `parameters` PNG text chunk |
| **ComfyUI PNG** | `prompt` / `workflow` JSON chunk (recursive text search) |
| **JPEG / WebP EXIF** | `UserComment`, `ImageDescription` tags |

Images with no recognisable prompt are silently skipped.

---

## Development (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
$env:WATCH_DIRS = "C:\path\to\images"
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev          # proxies /api and /media to localhost:8000
```

---

## How it works

1. On startup (and every `SCAN_INTERVAL_SECONDS` thereafter) the backend walks all watched directories.
2. For each supported image file the prompt is extracted from embedded metadata.
3. Each prompt string is hashed to a stable 32-character `prompt_id` (MD5) used in all API URLs — this avoids URL-length issues with long AI prompts.
4. The frontend fetches `/api/prompts` to render a card grid (one card per unique prompt).
5. Clicking a card fetches `/api/prompts/{prompt_id}` and opens a scrollable modal of all matching images.
