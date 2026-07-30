import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DevActivitySummary, api } from '../api/client'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
  })
}

export function DevActivityWidget({
  managerId,
}: {
  managerId?: number | null
}) {
  const navigate = useNavigate()
  const [data, setData] = useState<DevActivitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.dashboard
      .devActivity(managerId, 90)
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [managerId])

  if (loading) return <div className="text-slate-500">Загрузка…</div>

  if (error) {
    return (
      <div className="rounded-2xl bg-rose-500/10 px-5 py-4 text-sm text-rose-200 ring-1 ring-rose-500/30">
        Не удалось загрузить dev-активность: {error}
      </div>
    )
  }

  if (!data) return null

  if (!data.enabled) {
    return (
      <div className="rounded-2xl bg-bg-elevated px-5 py-4 text-sm text-slate-400">
        Интеграция CodeBuddy выключена. Включите её в админ-панели (раздел
        «Интеграции»), чтобы видеть здесь сводку по PR-ам, зависшим MR и
        компетенциям команды.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">
        {fmtDate(data.period_from)} — {fmtDate(data.period_to)} ·{' '}
        анализировано <span className="text-slate-300">{data.with_metrics}</span>{' '}
        из {data.team_size} активных
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">PR-ов за период</div>
          <div className="mt-1 text-2xl font-semibold text-accent">
            {data.total_mrs}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">Средний quality</div>
          <div
            className={
              'mt-1 text-2xl font-semibold ' +
              (data.avg_quality_ratio === null
                ? 'text-slate-500'
                : data.avg_quality_ratio >= 0.7
                  ? 'text-emerald-400'
                  : data.avg_quality_ratio >= 0.5
                    ? 'text-amber-400'
                    : 'text-rose-400')
            }
          >
            {data.avg_quality_ratio === null
              ? '—'
              : `${Math.round(data.avg_quality_ratio * 100)}%`}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">WIP сейчас</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">
            {data.wip_total}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">Зависших PR</div>
          <div
            className={
              'mt-1 text-2xl font-semibold ' +
              (data.stale_total > 0 ? 'text-rose-400' : 'text-emerald-400')
            }
          >
            {data.stale_total}
          </div>
        </div>
      </div>

      {data.stale_alerts.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Кому надо помочь сдвинуть PR
          </h3>
          <ul className="space-y-1.5">
            {data.stale_alerts.map((a) => (
              <li
                key={a.employee_id}
                className="flex items-baseline gap-3 rounded-lg bg-rose-500/5 px-3 py-2 ring-1 ring-rose-500/20"
              >
                <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-mono text-rose-200">
                  {a.oldest_age_days}д
                </span>
                <button
                  onClick={() => navigate(`/employees/${a.employee_id}`)}
                  className="text-sm font-medium text-slate-200 hover:text-accent"
                >
                  {a.full_name}
                </button>
                <span className="text-xs text-slate-500">
                  {a.stale_count} зависш{a.stale_count === 1 ? 'ий' : 'их'}
                </span>
                {a.sample_title && (
                  <span className="ml-auto min-w-0 truncate text-right text-[11px] text-slate-500">
                    {a.sample_url ? (
                      <a
                        href={a.sample_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent"
                        title={a.sample_title}
                      >
                        {a.sample_title}
                      </a>
                    ) : (
                      <span title={a.sample_title}>{a.sample_title}</span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.top_competencies.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Топ-компетенции, реально проявляющиеся в команде
          </h3>
          <div className="space-y-1.5">
            {data.top_competencies.map((c) => (
              <div
                key={c.competency_id}
                className="flex items-baseline gap-3 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-white/5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                  {c.competency_name}
                </span>
                <span className="text-[11px] text-slate-500">
                  у {c.employees_with} сотр.
                </span>
                <span className="font-mono text-xs text-slate-300">
                  {c.total_signal_count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
