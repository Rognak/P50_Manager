import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, EmployeeProjectHistoryItem } from '../../api/client'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function durationMonths(from: string | null, to: string | null): string | null {
  if (!from) return null
  const start = new Date(from).getTime()
  const end = to ? new Date(to).getTime() : Date.now()
  const months = Math.max(
    0,
    Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44)),
  )
  if (months < 1) return '< 1 мес'
  if (months < 12) return `${months} мес`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem === 0 ? `${years} год${years === 1 ? '' : years < 5 ? 'а' : ''}` : `${years}г ${rem}м`
}

export function ProjectsTab({ employeeId }: { employeeId: number }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<EmployeeProjectHistoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.employees
      .projects(employeeId)
      .then(setItems)
      .catch((e) => setError((e as Error).message))
  }, [employeeId])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (items === null) return <div className="text-slate-500">Загрузка…</div>

  const current = items.filter((i) => i.is_current)
  const past = items.filter((i) => !i.is_current)

  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
        Сотрудник не привязан ни к одному продукту. Добавьте его в команду
        продукта в разделе «Продукты».
      </div>
    )
  }

  const Card = ({ i }: { i: EmployeeProjectHistoryItem }) => (
    <div
      onClick={() => navigate(`/products/${i.product_id}`)}
      className="cursor-pointer rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5 hover:bg-bg-panel/40"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            {i.product_name}
          </h3>
          {i.gitlab_group && (
            <div className="mt-0.5 text-[11px] font-mono text-slate-500">
              📁 {i.gitlab_group}
            </div>
          )}
          <div className="mt-1 text-sm text-slate-400">
            {i.role_in_project || (
              <span className="text-slate-600">роль не указана</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={
              'rounded px-2 py-0.5 text-xs ' +
              (i.is_current
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-500/15 text-slate-400')
            }
          >
            {i.is_current ? 'в продукте' : 'завершён'}
          </span>
          {i.rotation_locked && (
            <div className="mt-1 text-[10px] text-amber-300">🔒 заморожен</div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <span>с {formatDate(i.joined_at)}</span>
        {!i.is_current && <span>по {formatDate(i.left_at)}</span>}
        {durationMonths(i.joined_at, i.left_at) && (
          <span className="text-slate-400">
            · {durationMonths(i.joined_at, i.left_at)}
          </span>
        )}
        <span className="ml-auto text-slate-600">статус: {i.product_status}</span>
      </div>
      {i.rotation_lock_note && (
        <div className="mt-2 rounded bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
          {i.rotation_lock_note}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Текущие продукты ({current.length})
        </h2>
        {current.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Сотрудник сейчас не в продукте.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {current.map((i) => (
              <Card key={i.product_id} i={i} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            История ({past.length})
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {past.map((i) => (
              <Card key={i.product_id} i={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
