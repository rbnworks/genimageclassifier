# GenImageClassifier

A self-hosted gallery that watches image folders, extracts AI-generation prompts from file metadata, groups images by prompt, and presents them in a React gallery with real-time updates, a slideshow, a collage editor, and a full export system.

> Full architecture and design notes: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Quick start

Copy the example env file and adjust the paths to your image folders:

```bash
cp .env.example .env   # then edit .env
docker compose up --build
```

| Service | URL |
|---|---|
| Gallery | http://localhost:3000 |
| API docs | http://localhost:8000/docs |

---

## Configuration

Watched folders and other settings are driven by two files.

### `.env`

```dotenv
# Host paths that Docker mounts into the backend container.
MEDIA_FOLDER1=H:\Anime
MEDIA_FOLDER2=C:\Users\You\Documents\ComfyUI\output
```

### `docker-compose.yml` (environment section)

| Variable | Default | Description |
|---|---|---|
| `WATCH_DIRS` | `/media/folder1,/media/folder2` | Comma-separated **container-side** mount paths |
| `SCAN_INTERVAL_SECONDS` | `10` | How often the backend re-scans |

Add more folders by extending both `volumes` and `WATCH_DIRS`:

```yaml
environment:
  WATCH_DIRS: /media/folder1,/media/folder2,/media/folder3
volumes:
  - "${MEDIA_FOLDER1}:/media/folder1"
  - "${MEDIA_FOLDER2}:/media/folder2"
  - "D:\\More Art:/media/folder3"
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

## Features

### Dashboard
- Live stat cards: total images, images with/without metadata, unique prompt count.
- Quick-access links to Album, Slideshow, and Settings.
- Stats automatically refresh when the backend detects new images (no page reload needed).

### Prompt Album
- Card grid — one card per unique prompt, sorted by most recently updated.
- Search bar filters visible cards in real time.
- **Delete album** — two-click confirmation removes all images for a prompt from disk and the gallery.

### Image viewer
- Click any card to open a scrollable image modal with full prompt text.
- Click any image to open a full-size preview modal.
- **Delete individual image** — confirm overlay removes the file from disk.

### Slideshow
- Auto-plays all images across all prompts.
- Adjustable interval; pause/resume.

### Collage
- Pick images and arrange them into a collage layout.
- Dedicated collage editor page for fine-grained layout control.

### Real-time updates (WebSocket)
- Backend broadcasts a `scan_updated` event via `/ws/events` after every scan or delete operation.
- All pages subscribe through a singleton `EventSource`-style client — no polling.
- Connection status indicator in the sidebar (grey → amber → green dot with reconnect logic).

### Export (Settings page)
- **Resolution options**: Original, 720p, or 480p (Pillow LANCZOS downscale, aspect-preserved).
- Clicking **Download Prompts ZIP** starts an async background job on the server.
- A progress bar updates live via SSE (`/api/export/prompts/{job_id}/events`).
- Navigating away from Settings does **not** cancel the download — a mini progress bar stays visible in the sidebar.
- The ZIP contains:
  ```
  prompts.json                 ← all prompt metadata; sample_image.url is a relative path
  images/<prompt_id>.<ext>     ← one sample image per unique prompt (binary, DEFLATE-compressed)
  ```

---

## API reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | List all prompt groups (summary + sample image URL) |
| `GET` | `/api/prompts/{prompt_id}/images` | All images for one prompt |
| `GET` | `/api/images` | All indexed images |
| `GET` | `/api/stats` | Counts: total, with/without metadata, unique prompts |
| `DELETE` | `/api/images/{image_id}` | Delete one image from disk + index |
| `DELETE` | `/api/prompts/{prompt_id}` | Delete all images for a prompt from disk + index |
| `POST` | `/api/export/prompts` | Start a ZIP export job → `{job_id, total}` |
| `GET` | `/api/export/prompts/{job_id}/events` | SSE progress stream for an export job |
| `GET` | `/api/export/prompts/{job_id}/download` | Download the completed ZIP |
| `GET` | `/media/{file_path}` | Serve an image file (immutable cache headers) |
| `WS` | `/ws/events` | Real-time event stream (`scan_updated`) |

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
VITE_WS_URL=ws://localhost:8000/ws/events npm run dev
```

---

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, all route handlers, WebSocket hub, export jobs
│   │   ├── repository.py    # In-memory image store, prompt grouping, CRUD helpers
│   │   ├── models.py        # Pydantic models (ImageItem, PromptGroup, …)
│   │   ├── config.py        # Settings (WATCH_DIRS, SCAN_INTERVAL_SECONDS)
│   │   └── scanner/         # Filesystem watcher + metadata extractor (Pillow / piexif)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── api/             # fetch wrappers (client.ts, prompts.ts, stats.ts)
│       ├── components/      # Layout, PromptCard, PromptGrid, PromptModal, ImagePreviewModal
│       ├── hooks/           # usePromptGroups, useExportJob, useRealtimeStatus, …
│       ├── pages/           # Dashboard, PromptAlbum, Slideshow, Collage, Settings
│       └── realtime/        # Singleton WebSocket client (events.ts)
├── docker-compose.yml
├── .env                     # Local host paths (git-ignored)
└── .env.example             # Committed template
```

---

## How it works

1. On startup (and every `SCAN_INTERVAL_SECONDS` thereafter) the backend walks all watched directories.
2. For each supported image the prompt is extracted from embedded metadata.
3. Each prompt string is hashed to a stable `prompt_id` (MD5 hex) used in all API URLs.
4. After each scan the backend broadcasts a `scan_updated` WebSocket event; connected browsers refresh automatically.
5. The frontend fetches `/api/prompts` (with `cache: no-store`) to render the prompt card grid.
6. Deletes (image or album) update the in-memory store, touch `_last_scan_time`, delete from disk, then broadcast another `scan_updated` event.
7. Exports build a ZIP in a thread pool, report progress via SSE, and serve the result as a one-shot file download before cleaning up the temp file.

