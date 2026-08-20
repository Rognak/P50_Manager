import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DevActivitySummary, DevLeaderboardEmployee, api } from '../api/client'

type LeaderboardMetric = 'mrs' | 'quality' | 'reviews' | 'speed' | 'tests'

const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  mrs: 'Количество PR',
  quality: 'Качество PR',
  reviews: 'Участие в ревью',
  speed: 'Скорость merge',
  tests: 'PR с тестами',
}

function metricValue(row: DevLeaderboardEmployee, metric: LeaderboardMetric): number {
  if (metric === 'quality') return row.avg_quality_ratio
  if (metric === 'reviews') return row.comments_given
  if (metric === 'speed') return row.avg_time_to_merge_hours ?? Number.POSITIVE_INFINITY
  if (metric === 'tests') return row.tests_ratio
  return row.total_mrs
}

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
  const [periodDays, setPeriodDays] = useState(90)
  const [metric, setMetric] = useState<LeaderboardMetric>('mrs')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.dashboard
      .devActivity(managerId, periodDays)
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
  }, [managerId, periodDays])

  const leaders = useMemo(() => [...(data?.leaderboard || [])].sort((a, b) => {
    if (metric === 'quality') {
      const aEligible = a.total_mrs >= 3
      const bEligible = b.total_mrs >= 3
      if (aEligible !== bEligible) return aEligible ? -1 : 1
    }
    const aValue = metricValue(a, metric)
    const bValue = metricValue(b, metric)
    const difference = metric === 'speed' ? aValue - bValue : bValue - aValue
    return difference || b.total_mrs - a.total_mrs || a.full_name.localeCompare(b.full_name, 'ru')
  }), [data, metric])

  if (loading) return <div className="text-slate-500">Загрузка…</div>

  if (error) {
    return (
      <div className="rounded-2xl bg-danger-soft px-5 py-4 text-sm text-danger ring-1 ring-danger/30" role="alert">
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {fmtDate(data.period_from)} — {fmtDate(data.period_to)} ·{' '}
          анализировано <span className="text-slate-300">{data.with_metrics}</span>{' '}
          из {data.team_size} активных
        </div>
        <div className="flex rounded-lg bg-surface-subtle p-1 ring-1 ring-outline-subtle" aria-label="Период аналитики">
          {[30, 90, 180, 365].map((days) => <button key={days} type="button" onClick={() => setPeriodDays(days)} className={`rounded px-2.5 py-1 text-xs ${periodDays === days ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:text-ink'}`}>{days === 365 ? '1 год' : `${days} дн.`}</button>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">PR-ов за период</div>
          <div className="metric-primary mt-1 text-2xl font-semibold">
            {data.total_mrs}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">Средний quality</div>
          <div
            className={
              'mt-1 text-2xl font-semibold ' +
              (data.avg_quality_ratio === null
                ? 'metric-default'
                : data.avg_quality_ratio >= 0.7
                  ? 'metric-good'
                  : data.avg_quality_ratio >= 0.5
                    ? 'metric-warn'
                    : 'metric-bad')
            }
          >
            {data.avg_quality_ratio === null
              ? '—'
              : `${Math.round(data.avg_quality_ratio * 100)}%`}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">WIP сейчас</div>
          <div className="metric-default mt-1 text-2xl font-semibold">
            {data.wip_total}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
          <div className="text-xs text-slate-500">Зависших PR</div>
          <div
            className={
              'mt-1 text-2xl font-semibold ' +
              (data.stale_total > 0 ? 'metric-warn' : 'metric-good')
            }
          >
            {data.stale_total}
          </div>
        </div>
      </div>

      {leaders.length > 0 && (
        <section className="pt-2">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div><h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Leaderboard команды</h3><p className="mt-1 text-xs text-slate-500">Отдельные рейтинги без общего балла. Качество ранжируется при наличии минимум 3 PR.</p></div>
            <label className="text-xs text-slate-500">Рейтинг по<select value={metric} onChange={(event) => setMetric(event.target.value as LeaderboardMetric)} className="ml-2 rounded-lg bg-bg-panel px-3 py-2 text-sm text-ink ring-1 ring-outline-subtle">{(Object.keys(METRIC_LABELS) as LeaderboardMetric[]).map((key) => <option key={key} value={key}>{METRIC_LABELS[key]}</option>)}</select></label>
          </div>
          <div className="overflow-x-auto rounded-xl bg-bg-elevated ring-1 ring-outline-subtle">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-surface-subtle text-left text-xs text-ink-muted"><tr><th className="w-12 px-3 py-2 text-center">Место</th><th className="px-3 py-2">Сотрудник</th><th className="px-3 py-2 text-right">PR</th><th className="px-3 py-2 text-right">Quality</th><th className="px-3 py-2 text-right" title="Комментарии, оставленные сотрудником в ревью чужих PR">Review-комм.</th><th className="px-3 py-2 text-right">До merge</th><th className="px-3 py-2 text-right">С тестами</th><th className="px-3 py-2 text-right">Зависло</th></tr></thead>
              <tbody>{leaders.map((row, index) => {
                const qualityEligible = row.total_mrs >= 3
                return <tr key={row.employee_id} className="border-t border-outline-subtle hover:bg-surface-subtle"><td className={`px-3 py-2 text-center font-mono ${index < 3 ? 'font-semibold text-primary' : 'text-ink-muted'}`}>{index + 1}</td><td className="px-3 py-2"><button type="button" onClick={() => navigate(`/employees/${row.employee_id}`)} className="font-medium text-ink hover:text-primary">{row.full_name}</button></td><td className={`px-3 py-2 text-right font-mono ${metric === 'mrs' ? 'text-primary' : ''}`}>{row.total_mrs}</td><td className={`px-3 py-2 text-right font-mono ${metric === 'quality' ? 'text-primary' : ''}`} title={qualityEligible ? undefined : 'Недостаточно данных для рейтинга: нужно минимум 3 PR'}>{Math.round(row.avg_quality_ratio * 100)}%{!qualityEligible && <sup className="ml-0.5 text-ink-muted">*</sup>}</td><td className={`px-3 py-2 text-right font-mono ${metric === 'reviews' ? 'text-primary' : ''}`}>{row.comments_given}</td><td className={`px-3 py-2 text-right font-mono ${metric === 'speed' ? 'text-primary' : ''}`}>{row.avg_time_to_merge_hours === null ? '—' : `${Math.round(row.avg_time_to_merge_hours)} ч`}</td><td className={`px-3 py-2 text-right font-mono ${metric === 'tests' ? 'text-primary' : ''}`}>{Math.round(row.tests_ratio * 100)}%</td><td className={`px-3 py-2 text-right font-mono ${row.stale_count > 0 ? 'text-warning' : 'text-ink-muted'}`}>{row.stale_count}</td></tr>
              })}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">* Метрика показана для информации, но сотрудник расположен ниже участников с достаточной выборкой.</p>
        </section>
      )}

      {data.stale_alerts.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Кому надо помочь сдвинуть PR
          </h3>
          <ul className="space-y-1.5">
            {data.stale_alerts.map((a) => (
              <li
                key={a.employee_id}
                className="semantic-row-warning flex items-baseline gap-3 rounded-lg border border-l-2 px-3 py-2"
              >
                <span className="semantic-status-warning shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono">
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
