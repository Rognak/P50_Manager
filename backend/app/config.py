from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://p50:p50@localhost:5432/p50"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24
    cors_origins: list[str] = ["http://localhost:5173"]

    ai_base_url: str = "https://api.deepseek.com/v1"
    ai_api_key: str = ""
    ai_model_chat: str = "deepseek-chat"
    ai_request_timeout: float = 120.0
    # У LLM-эндпоинта может быть self-signed сертификат — по умолчанию
    # верификацию SSL не делаем. В production стоит выставить True.
    ai_verify_ssl: bool = False

    redis_url: str = "redis://localhost:6379/0"

    # ---- CodeBuddy External API ----
    codebuddy_base_url: str = "https://codebuddy.example.com"
    codebuddy_keycloak_url: str = "https://auth.example.com/realms/example"
    # Если оба пусты — клиент работает в режиме «AI не настроен» и кидает 502
    # при первом запросе. Никаких mock-fallback'ов.
    codebuddy_client_id: str = ""
    codebuddy_client_secret: str = ""
    # У dev-сервера может быть self-signed сертификат — выключаем верификацию.
    # В production обязательно True.
    codebuddy_verify_ssl: bool = False
    codebuddy_request_timeout: float = 30.0


settings = Settings()
