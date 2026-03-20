from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Comma-separated list of directories to scan for media files.
    watch_dirs: str = "/media/folder1,/media/folder2"
    # How often (in seconds) to rescan the watched directories.
    scan_interval_seconds: int = 10

    @property
    def watch_dirs_list(self) -> list[str]:
        return [d.strip() for d in self.watch_dirs.split(",") if d.strip()]

    model_config = {"env_file": ".env"}


settings = Settings()
