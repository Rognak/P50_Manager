/**
 * Семантический баннер ошибки для вкладок, которые ходят в CodeBuddy.
 *
 * Если backend вернул ошибку с префиксом "CodeBuddy:" (см.
 * `_codebuddy_error_to_http` в `app/api/dev_metrics.py`) — показываем
 * специальный текст с подсказкой администратору. Иначе — общий вид ошибки.
 */
export function CodeBuddyErrorBanner({ error }: { error: string }) {
  const isCodeBuddy = error.startsWith('CodeBuddy')
  const isRateLimit =
    isCodeBuddy && /429|rate ?limit|too many/i.test(error)

  return (
    <div className="rounded-2xl bg-danger-soft px-5 py-4 text-sm text-danger ring-1 ring-danger/30" role="alert">
      <div className="font-medium">
        {isRateLimit
          ? 'CodeBuddy временно ограничил частоту запросов'
          : isCodeBuddy
            ? 'Не удалось получить данные из CodeBuddy'
            : 'Ошибка загрузки данных'}
      </div>
      <div className="mt-1 text-xs opacity-80">{error}</div>
      {isCodeBuddy && (
        <div className="mt-2 text-xs opacity-70">
          {isRateLimit
            ? 'Подождите минуту и обновите страницу.'
            : 'Попросите администратора проверить связь во вкладке «Интеграции» админ-панели или временно отключите live-режим CodeBuddy.'}
        </div>
      )}
    </div>
  )
}
