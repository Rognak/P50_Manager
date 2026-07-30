"""ARQ Redis pool — общий между FastAPI (для enqueue) и worker'ом (через тот же Redis-инстанс)."""
from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.config import settings

_pool: ArqRedis | None = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def init_redis() -> None:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings())


async def close_redis() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None


def get_pool() -> ArqRedis:
    if _pool is None:
        raise RuntimeError("Redis pool not initialized. Call init_redis() first.")
    return _pool
