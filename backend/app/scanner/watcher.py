import asyncio
import logging
import os
from pathlib import Path
from typing import Awaitable, Callable

from app import repository
from app.config import settings
from app.scanner.metadata import SUPPORTED_EXTENSIONS

logger = logging.getLogger(__name__)


async def scan_directories() -> bool:
    """Walk all watched directories and refresh the in-memory index."""
    files: list[str] = []

    for watch_dir in settings.watch_dirs_list:
        if not os.path.isdir(watch_dir):
            logger.warning("Watch directory not found: %s", watch_dir)
            continue
        for root, _dirs, filenames in os.walk(watch_dir):
            for filename in filenames:
                if Path(filename).suffix.lower() in SUPPORTED_EXTENSIONS:
                    files.append(os.path.join(root, filename))

    changed = repository.index_media(files)
    groups = repository.get_prompt_groups()
    logger.info(
        "Scan complete: %d media files → %d prompt groups", len(files), len(groups)
    )
    return changed


async def start_periodic_scanner(
    on_changed: Callable[[], Awaitable[None]] | None = None,
) -> None:
    """Run :func:`scan_directories` on startup, then repeat every N seconds."""
    while True:
        try:
            changed = await scan_directories()
            if changed and on_changed:
                await on_changed()
        except Exception:
            logger.exception("Unhandled error during directory scan")
        await asyncio.sleep(settings.scan_interval_seconds)
