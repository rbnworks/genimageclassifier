# Architecture — GenImageClassifier

## Overview

GenImageClassifier is a two-service Docker application that indexes AI-generated images from one or more local folders and serves them as a gallery grouped by the prompt that was used to generate each image.

```
 Host filesystem (read-only volumes)
         │
         ▼
 ┌───────────────────────────────┐        ┌──────────────────────────┐
 │  backend  (FastAPI :8000)     │◄──────►│  frontend  (Vite :3000)  │
 │  - periodic directory scanner │  HTTP  │  - React + TypeScript    │
 │  - metadata extraction        │        │  - CSS Modules           │
 │  - in-memory index            │        │  - React Router v6       │
 │  - REST API                   │        └──────────────────────────┘
 └───────────────────────────────┘
         │
   Docker network: app-net
```

---

## Repository layout

```
GenImageClassifier/
├── docker-compose.yml
├── .gitignore
├── README.md
├── ARCHITECTURE.md            ← this file
├── media/
│   ├── folder1/               ← placeholder; mount real host folders here
│   └── folder2/
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── config.py          ← env-var settings (Pydantic BaseSettings)
│       ├── models.py          ← Pydantic response models
│       ├── repository.py      ← in-memory index + grouping logic
│       ├── main.py            ← FastAPI app: routes + lifespan
│       └── scanner/
│           ├── metadata.py    ← prompt extraction (Pillow / EXIF)
│           └── watcher.py     ← asyncio periodic scanner
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts         ← dev proxy → backend
    ├── index.html
    └── src/
        ├── api/
        │   ├── client.ts      ← apiFetch helper
        │   └── prompts.ts     ← typed API calls + TS interfaces
        ├── components/
        │   ├── Layout.tsx / .module.css      ← shell with right-side nav
        │   ├── PromptCard.tsx / .module.css  ← image card + hover overlay
        │   ├── PromptGrid.tsx / .module.css  ← responsive CSS grid
        │   └── PromptModal.tsx / .module.css ← Esc-closeable modal
        ├── pages/
        │   ├── HomePage.tsx / .module.css    ← main gallery page
        │   └── SettingsPage.tsx / .module.css
        ├── App.tsx            ← router + route definitions
        ├── main.tsx
        └── index.css
```

---

## Backend

### Technology stack

| Package | Purpose |
|---|---|
| `fastapi` | REST framework |
| `uvicorn` | ASGI server |
| `pillow` | Image open + metadata access |
| `pydantic-settings` | Env-var configuration |
| `aiofiles` | (available for async file I/O if needed) |

### Configuration (`app/config.py`)

Settings are loaded from environment variables (or an optional `.env` file):

| Variable | Default | Description |
|---|---|---|
| `WATCH_DIRS` | `/media/folder1,/media/folder2` | Comma-separated **container-side** paths to scan |
| `SCAN_INTERVAL_SECONDS` | `10` | How often to rescan (seconds) |

> **Important:** `WATCH_DIRS` must contain the container mount targets, not the Windows host paths. The Docker volume mapping (`H:\Anime Girls:/media/folder1`) translates the host path into the container path automatically.

### Metadata extraction (`app/scanner/metadata.py`)

Supported formats and extraction priority:

| Priority | Format | Where the prompt is read from |
|---|---|---|
| 1 | **PNG (Automatic1111)** | `parameters` PNG tEXt chunk — contains full positive prompt + negative + steps |
| 2 | **PNG (ComfyUI)** | `prompt` or `workflow` PNG tEXt chunk — parsed as JSON, recursively searched for `text`, `prompt`, or `positive` keys |
| 3 | **JPEG / WebP / other** | EXIF tags: `UserComment` → `ImageDescription` → `XPComment` |

Files with no recognisable prompt are excluded from the index entirely.

The `created_at` timestamp is taken from the file's `mtime` (OS modification time).

### Periodic scanner (`app/scanner/watcher.py`)

- Runs as an `asyncio` background task started in the FastAPI `lifespan` context.
- Walks every directory in `watch_dirs_list` recursively.
- Passes all found file paths to `repository.index_media()`.
- Sleeps for `SCAN_INTERVAL_SECONDS` then repeats.
- Missing directories produce a warning log and are skipped gracefully.

### In-memory index (`app/repository.py`)

The store is a plain Python dict `Dict[str, ImageItem]` keyed on absolute file path.

```
_store = {
  "/media/folder1/image001.png": ImageItem(id=..., prompt=..., ...),
  ...
}
```

**Prompt ID hashing:**  
Every prompt string is hashed with MD5 → `prompt_id` (32-char hex). This hash is:
- Returned in every `PromptGroup` response.
- Used as the URL path segment for `/api/prompts/{prompt_id}`.
- Used for lookups in `get_images_for_prompt_id()`.

This prevents URL truncation / 404s that occurred when very long AI prompt strings (500–1000+ characters) were used raw in URLs.

### REST API (`app/main.py`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/prompts` | List all prompt groups, sorted newest-first. Each entry includes `prompt_id`, full `prompt` text, `sample_image`, and `count`. |
| `GET` | `/api/prompts/{prompt_id}` | All `ImageItem` objects for the given prompt hash, sorted newest-first. Returns 404 if hash not found. |
| `GET` | `/media/{file_path:path}` | Serve a raw image file. Path is validated against `WATCH_DIRS` to prevent path-traversal (SSRF / directory traversal mitigation). |

CORS is enabled with `allow_origins=["*"]` for development. Restrict in production.

### Pydantic models (`app/models.py`)

```python
class ImageItem(BaseModel):
    id: str           # MD5 of absolute file path
    path: str         # absolute path inside container
    url: str          # e.g. /media/folder1/image.png
    prompt: str       # full extracted prompt text
    created_at: datetime

class PromptGroup(BaseModel):
    prompt_id: str        # MD5 of prompt string (used in URLs)
    prompt: str           # full prompt text
    sample_image: ImageItem
    count: int
```

---

## Frontend

### Technology stack

| Package | Purpose |
|---|---|
| `react` + `react-dom` | UI framework |
| `react-router-dom` v6 | Client-side routing |
| `vite` | Dev server + bundler |
| `typescript` | Static typing |
| CSS Modules | Scoped styles (no external CSS framework) |

### Routing (`App.tsx`)

```
/           → HomePage    (wrapped in Layout)
/settings   → SettingsPage (wrapped in Layout)
```

### Layout (`components/Layout.tsx`)

```
┌──────────────────────────────┬────────┐
│                              │  GIC   │
│   <Outlet /> (page content)  │  Home  │
│                              │Settings│
└──────────────────────────────┴────────┘
                                  80px right sidebar, sticky
```

### Data flow (HomePage)

```
mount
  └─ fetchPromptGroups() → GET /api/prompts
        └─ renders PromptGrid
              └─ PromptCard × N  (one per prompt)
                    │  click
                    ▼
              fetchImagesByPrompt(prompt_id) → GET /api/prompts/{prompt_id}
                    └─ opens PromptModal with all images
```

### API layer (`src/api/`)

- **`client.ts`** — `apiFetch<T>(path)`: thin `fetch` wrapper; throws on non-2xx with status + body in message. `API_BASE_URL` is configurable via `VITE_API_BASE_URL` env var (empty string in Docker because Vite proxies `/api` and `/media` to the backend).
- **`prompts.ts`** — exports `PromptGroup`, `ImageItem` interfaces and `fetchPromptGroups()` / `fetchImagesByPrompt(promptId)`.

### Hover overlay (pure CSS)

```css
/* PromptCard.module.css */
.overlay { opacity: 0; transition: opacity 0.25s; }
.card:hover .overlay { opacity: 1; }
```

No JavaScript state is used for hover — purely CSS `:hover` on the card container.

---

## Docker

### Services

| Service | Image base | Port | Notes |
|---|---|---|---|
| `backend` | `python:3.12-slim` | 8000 | Runs `uvicorn app.main:app` |
| `frontend` | `node:20-slim` | 3000 | Runs `npm run dev` (Vite dev server) |

Both services share the `app-net` bridge network so the frontend Vite proxy can reach `http://backend:8000`.

### Volume mapping

Host folders are mounted **read-only** into the backend container. Multiple folders can be added by appending entries to both `volumes` and `WATCH_DIRS`:

```yaml
environment:
  WATCH_DIRS: /media/folder1,/media/folder2,/media/folder3
volumes:
  - "H:\\Anime Girls:/media/folder1:ro"   # quoted: host path has a space
  - ./media/folder2:/media/folder2:ro
  - "D:\\More Art:/media/folder3:ro"
```

> Paths containing spaces **must** be written as quoted strings in `docker-compose.yml`.

### Vite dev proxy

`vite.config.ts` proxies `/api/*` and `/media/*` to the backend so the frontend can use relative URLs with no CORS issues:

```ts
proxy: {
  '/api':   { target: backendUrl, changeOrigin: true },
  '/media': { target: backendUrl, changeOrigin: true },
}
```

`backendUrl` is read from `process.env.BACKEND_URL` (set to `http://backend:8000` in the Docker compose environment) and falls back to `http://localhost:8000` for local development.

---

## Known design decisions and trade-offs

| Decision | Rationale |
|---|---|
| In-memory index (no database) | Simple; sufficient for a single-user local tool. Add SQLite via `databases` + `aiosqlite` for persistence across restarts. |
| MD5 for `prompt_id` | Collision probability is negligible for thousands of prompts. Not used for security, only routing. |
| Periodic polling instead of `watchdog` | Simpler async integration; `watchdog` requires threads and a separate event loop bridge. Acceptable for a 10-second scan interval. |
| `python:3.12-slim` base | Minimises image size while keeping CPython 3.12 for `datetime | None` union syntax. |
| Vite dev server in production container | Acceptable for a local/personal tool. For internet-facing deployment, replace with `vite build` + nginx. |
