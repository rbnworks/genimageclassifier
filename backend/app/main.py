import asyncio
import io
import json
import mimetypes
import os
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path
from typing import AsyncGenerator, List

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from PIL import Image as PillowImage
from pydantic import BaseModel

from app import repository
from app.config import settings
from app.models import ImageItem, PromptGroup, PromptGroupSummary
from app.scanner.watcher import start_periodic_scanner


class WebSocketHub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, payload: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


hub = WebSocketHub()


async def publish_scan_updated() -> None:
    stats = repository.get_stats()
    await hub.broadcast(
        {
            "type": "scan_updated",
            "stats": {
                "totalImages": stats["totalImages"],
                "imagesWithMetadata": stats["imagesWithMetadata"],
                "imagesWithoutMetadata": stats["imagesWithoutMetadata"],
                "uniquePrompts": stats["uniquePrompts"],
            },
        }
    )


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    task = asyncio.create_task(start_periodic_scanner(on_changed=publish_scan_updated))
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="GenImageClassifier", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "HEAD", "DELETE", "POST"],
    allow_headers=["*"],
)


@app.websocket("/ws/events")
async def websocket_events(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        await ws.send_json({"type": "hello"})
        while True:
            # Keep the connection open; clients do not need to send messages.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)


@app.get("/api/prompts")
async def list_prompts(request: Request) -> Response:
    last_scan = repository.get_last_scan_time()
    if last_scan:
        last_modified_str = formatdate(last_scan.timestamp(), usegmt=True)
        if_modified_since = request.headers.get("If-Modified-Since")
        if if_modified_since == last_modified_str:
            return Response(status_code=304)
        data = [s.model_dump(mode='json') for s in repository.get_prompt_summaries()]
        return JSONResponse(
            content=data,
            headers={"Last-Modified": last_modified_str},
        )
    return JSONResponse(content=[s.model_dump(mode='json') for s in repository.get_prompt_summaries()])


@app.get("/api/images", response_model=List[ImageItem])
async def list_all_images() -> List[ImageItem]:
    return repository.get_all_images()


@app.get("/api/stats")
async def get_stats() -> dict:
    return repository.get_stats()


@app.get("/api/prompts/{prompt_id}/images", response_model=List[ImageItem])
async def get_prompt_images(prompt_id: str) -> List[ImageItem]:
    items = repository.get_images_for_prompt_id(prompt_id)
    if not items:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return items


@app.delete("/api/images/{image_id}", status_code=204)
async def delete_image(image_id: str) -> Response:
    item = repository.get_image_by_id(image_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Image not found")

    file_path = Path(item.path)

    # Security: only delete files inside configured watched directories.
    allowed = any(
        str(file_path).startswith(watch_dir)
        for watch_dir in settings.watch_dirs_list
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Path not in a watched directory")

    if file_path.exists():
        file_path.unlink()

    repository.remove_image(image_id)
    await publish_scan_updated()
    return Response(status_code=204)


@app.delete("/api/prompts/{prompt_id}", status_code=204)
async def delete_album(prompt_id: str) -> Response:
    paths = repository.get_images_for_prompt_id(prompt_id)
    if not paths:
        raise HTTPException(status_code=404, detail="Prompt not found")

    for item in paths:
        file_path = Path(item.path)
        allowed = any(
            str(file_path).startswith(watch_dir)
            for watch_dir in settings.watch_dirs_list
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=f"Path not in a watched directory: {item.path}")

    # All paths validated — now delete from disk and store.
    for item in paths:
        file_path = Path(item.path)
        if file_path.exists():
            file_path.unlink()

    repository.remove_images_for_prompt_id(prompt_id)
    await publish_scan_updated()
    return Response(status_code=204)


# ── Export jobs ────────────────────────────────────────────────────────

@dataclass
class _ExportJob:
    total: int
    done: int = 0
    status: str = "building"  # "building" | "ready" | "error"
    tmp_path: str | None = None
    error: str | None = None


_jobs: dict[str, _ExportJob] = {}


class ExportRequest(BaseModel):
    resolution: str = "original"  # "original" | "720p" | "480p"


def _resize_bytes(file_path: Path, target_height: int) -> bytes:
    """Return image bytes scaled so height == target_height (aspect preserved)."""
    with PillowImage.open(str(file_path)) as img:
        w, h = img.size
        if h <= target_height:
            return file_path.read_bytes()
        new_w = max(1, int(w * (target_height / h)))
        resized = img.resize((new_w, target_height), PillowImage.LANCZOS)
        buf = io.BytesIO()
        if file_path.suffix.lower() in (".jpg", ".jpeg"):
            resized.save(buf, format="JPEG", quality=85)
        else:
            resized.save(buf, format="PNG")
        return buf.getvalue()


def _build_zip(job_id: str, groups: list, resolution: str) -> None:
    """Synchronous ZIP builder — runs in a thread pool via BackgroundTasks."""
    job = _jobs[job_id]
    target_height: int | None = {"720p": 720, "480p": 480}.get(resolution)
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_path = tmp.name
        tmp.close()

        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            manifest: list[dict] = []
            for group in groups:
                file_path = Path(group.sample_image.path)
                allowed = any(
                    str(file_path).startswith(d) for d in settings.watch_dirs_list
                )
                image_rel: str | None = None
                if allowed and file_path.exists():
                    ext = file_path.suffix or ".png"
                    image_rel = f"images/{group.prompt_id}{ext}"
                    if target_height:
                        zf.writestr(image_rel, _resize_bytes(file_path, target_height))
                    else:
                        zf.write(str(file_path), arcname=image_rel)

                manifest.append({
                    "prompt_id": group.prompt_id,
                    "prompt": group.prompt,
                    "image_count": group.count,
                    "latest_updated_at": group.sample_image.created_at.isoformat(),
                    "sample_image": {"url": image_rel},
                })
                job.done += 1

            zf.writestr("prompts.json", json.dumps(manifest, indent=2))

        job.tmp_path = tmp_path
        job.status = "ready"
    except Exception as exc:
        job.status = "error"
        job.error = str(exc)


@app.post("/api/export/prompts")
async def start_export(req: ExportRequest, bg: BackgroundTasks) -> dict:
    """Start an async ZIP-export job. Returns the job_id immediately."""
    groups = repository.get_prompt_groups()
    job_id = str(uuid.uuid4())
    _jobs[job_id] = _ExportJob(total=len(groups))
    bg.add_task(_build_zip, job_id, groups, req.resolution)
    return {"job_id": job_id, "total": len(groups)}


@app.get("/api/export/prompts/{job_id}/events")
async def export_events(job_id: str) -> StreamingResponse:
    """SSE stream that emits progress events until the job completes or fails."""
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    async def _stream():
        while True:
            job = _jobs.get(job_id)
            if job is None:
                break
            yield (
                f"data: {json.dumps({'done': job.done, 'total': job.total, 'status': job.status, 'error': job.error})}\n\n"
            )
            if job.status in ("ready", "error"):
                break
            await asyncio.sleep(0.4)

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/export/prompts/{job_id}/download")
async def download_export(job_id: str, bg: BackgroundTasks) -> FileResponse:
    """Download the completed ZIP. Deletes temp file and job entry after send."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "ready":
        raise HTTPException(status_code=409, detail="Job not ready yet")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"prompts-export-{today}.zip"
    tmp_path = job.tmp_path
    del _jobs[job_id]
    bg.add_task(os.unlink, tmp_path)
    return FileResponse(path=tmp_path, media_type="application/zip", filename=filename)


@app.get("/media/{file_path:path}")
async def serve_media(file_path: str) -> FileResponse:
    full_path = Path("/") / file_path

    # Security: only serve from configured watched directories.
    allowed = any(
        str(full_path).startswith(watch_dir)
        for watch_dir in settings.watch_dirs_list
    )
    if not allowed or not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Images are content-addressed by filename (timestamp + index) and never mutate,
    # so we can cache them aggressively in the browser.
    return FileResponse(
        str(full_path),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
