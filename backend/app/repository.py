import hashlib
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.models import ImageItem, PromptGroup, PromptGroupSummary
from app.scanner.metadata import extract_metadata

# In-memory store: file path → ImageItem
_store: Dict[str, ImageItem] = {}
# Total paths passed to index_media (including files with no extractable prompt)
_total_scanned: int = 0
# Timestamp of the last completed scan
_last_scan_time: Optional[datetime] = None


def _make_id(path: str) -> str:
    return hashlib.md5(path.encode()).hexdigest()


def _prompt_id(prompt: str) -> str:
    """Stable short ID for a prompt string (used in URLs)."""
    return hashlib.md5(prompt.encode()).hexdigest()


def _make_url(path: str) -> str:
    # Strip the leading slash so the /media/{file_path:path} route receives
    # the bare path (e.g. "media/folder1/image.png"), then prepends "/" internally.
    return "/media/" + path.lstrip("/")


def index_media(path_list: List[str]) -> bool:
    """Re-index all given paths, dropping stale entries.

    Returns True when the index content changed.
    """
    global _store, _total_scanned, _last_scan_time
    _total_scanned = len(path_list)
    new_store: Dict[str, ImageItem] = {}

    for path in path_list:
        # Re-use cached entry when the file hasn't changed.
        if path in _store:
            new_store[path] = _store[path]
            continue

        meta = extract_metadata(path)
        if meta is None:
            continue

        item = ImageItem(
            id=_make_id(path),
            path=path,
            url=_make_url(path),
            prompt=meta["prompt"],
            created_at=meta["created_at"],
        )
        new_store[path] = item

    changed = _store != new_store
    _store = new_store
    if changed:
        _last_scan_time = datetime.now(timezone.utc)
    return changed


def get_prompt_groups() -> List[PromptGroup]:
    groups: Dict[str, List[ImageItem]] = {}
    for item in _store.values():
        groups.setdefault(item.prompt, []).append(item)

    result: List[PromptGroup] = []
    for prompt, items in groups.items():
        latest = max(items, key=lambda x: x.created_at)
        result.append(
            PromptGroup(
                prompt_id=_prompt_id(prompt),
                prompt=prompt,
                sample_image=latest,
                count=len(items),
            )
        )

    result.sort(key=lambda g: g.sample_image.created_at, reverse=True)
    return result


def get_prompt_summaries() -> List[PromptGroupSummary]:
    groups: Dict[str, List[ImageItem]] = {}
    for item in _store.values():
        groups.setdefault(item.prompt, []).append(item)

    result: List[PromptGroupSummary] = []
    for prompt, items in groups.items():
        latest = max(items, key=lambda x: x.created_at)
        result.append(
            PromptGroupSummary(
                prompt_id=_prompt_id(prompt),
                prompt=prompt,
                sample_image_url=latest.url,
                count=len(items),
                latest_updated_at=latest.created_at,
            )
        )

    result.sort(key=lambda g: g.latest_updated_at, reverse=True)
    return result


def get_images_for_prompt(prompt: str) -> List[ImageItem]:
    items = [item for item in _store.values() if item.prompt == prompt]
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def get_images_for_prompt_id(prompt_id: str) -> List[ImageItem]:
    """Look up images by the MD5 hash of their prompt string."""
    for item in _store.values():
        if _prompt_id(item.prompt) == prompt_id:
            return get_images_for_prompt(item.prompt)
    return []


def get_all_images() -> List[ImageItem]:
    items = list(_store.values())
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


def get_image_by_id(image_id: str) -> Optional[ImageItem]:
    for item in _store.values():
        if item.id == image_id:
            return item
    return None


def remove_image(image_id: str) -> Optional[str]:
    """Remove an image from the in-memory store by ID.

    Returns the filesystem path that was removed, or None if not found.
    Does NOT touch the filesystem — the caller is responsible for deletion.
    """
    global _store, _total_scanned, _last_scan_time
    for path, item in list(_store.items()):
        if item.id == image_id:
            del _store[path]
            _total_scanned = max(0, _total_scanned - 1)
            _last_scan_time = datetime.now(timezone.utc)
            return path
    return None


def remove_images_for_prompt_id(prompt_id: str) -> List[str]:
    """Remove all images belonging to a prompt from the store.

    Returns the list of filesystem paths removed.
    Does NOT touch the filesystem — caller is responsible for deletion.
    """
    global _store, _total_scanned, _last_scan_time
    to_remove = [
        (path, item)
        for path, item in list(_store.items())
        if _prompt_id(item.prompt) == prompt_id
    ]
    for path, _ in to_remove:
        del _store[path]
    _total_scanned = max(0, _total_scanned - len(to_remove))
    if to_remove:
        _last_scan_time = datetime.now(timezone.utc)
    return [path for path, _ in to_remove]


def get_last_scan_time() -> Optional[datetime]:
    return _last_scan_time


def get_stats() -> dict:
    images_with_metadata = len(_store)
    unique_prompts = len(set(item.prompt for item in _store.values()))
    return {
        "totalImages": _total_scanned,
        "imagesWithMetadata": images_with_metadata,
        "imagesWithoutMetadata": max(0, _total_scanned - images_with_metadata),
        "uniquePrompts": unique_prompts,
        "lastScanTime": _last_scan_time.isoformat() if _last_scan_time else None,
    }


def last_indexed_at() -> datetime | None:
    if not _store:
        return None
    return max(item.created_at for item in _store.values())
