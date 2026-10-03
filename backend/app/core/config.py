import tempfile
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://shop:shop@localhost:5432/shop"
    db_pool_size: int = 20
    db_max_overflow: int = 10

    currency: str = "USD"
    low_stock_threshold: int = 5
    reservation_ttl_seconds: int = 600
    reconcile_after_seconds: int = 5
    payment_timeout_seconds: float = 3.0
    fake_payment_slow_seconds: float = 6.0

    dispatcher_poll_interval_seconds: float = 1.0
    dispatcher_batch_size: int = 50
    dispatcher_workers: int = 4
    outbox_max_attempts: int = 5
    outbox_backoff_base_seconds: float = 2.0
    sweeper_interval_seconds: float = 5.0

    import_max_bytes: int = 200 * 1024 * 1024
    import_max_rows: int = 1_000_000
    import_batch_size: int = 500
    import_price_change_warning_ratio: float = 0.5
    import_preview_issues: int = 1000
    import_storage_dir: Path = Path(tempfile.gettempdir()) / "shop-imports"
    import_upload_retention_hours: int = 24

    seed_on_startup: bool = False
    seed_file: Path = Path("data/products.csv")

    static_dir: Path | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
