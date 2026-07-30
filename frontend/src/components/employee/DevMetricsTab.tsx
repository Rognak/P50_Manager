import { useEffect, useState } from 'react'

import {
  DevMetricsSnapshotPublic,
  PullRequestPublic,
  QualityBreakdownComponents,
  WipMrItem,
  api,
} from '../../api/client'
import { CodeBuddyErrorBanner } from '../CodeBuddyErrorBanner'
import { InfoHint } from '../InfoHint'
import {
  PeriodPreset,
  PeriodSelector,
  presetToQuery,
} from '../PeriodSelector'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function Tile({
  label,
  value,
  hint,
  tooltip,
}: {
  label: string
  value: string | number
  hint?: string
  tooltip?: string
}) {
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="text-xs text-slate-500">
        {label}
        {tooltip && (
          <>
            {' '}
            <InfoHint text={tooltip} />
          </>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold text-accent">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

function pct(n: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((n * 100) / total)}%`
}

function QualityBreakdownBar({
  breakdown,
}: {
  breakdown: QualityBreakdownComponents
}) {
  // Каждый компонент уже 0..100. Бар показывает вклад в общий quality
  // с учётом весов: вклад = component_pct × weight.
  const w = breakdown.weights || {}
  const wConv = w.convCommits ?? 0
  const wDesc = w.description ?? 0
  const wSize = w.size ?? 0
  const parts = [
    {
      label: 'conv. commits',
      pct: breakdown.conventional_commits_pct,
      weight: wConv,
      color: 'bg-sky-500/60',
    },
    {
      label: 'описание',
      pct: breakdown.description_pct,
      weight: wDesc,
      color: 'bg-amber-500/60',
    },
    {
      label: 'размер PR',
      pct: breakdown.size_pct,
      weight: wSize,
      color: 'bg-emerald-500/60',
    },
  ]
  // Шкала бара: каждый сегмент занимает (weight×100) ширины, заполнен на pct.
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Из чего складывается quality
      </div>
      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="mb-1 flex items-baseline justify-between text-[11px] text-slate-400">
              <span>{p.label}</span>
              <span className="font-mono">
                {Math.round(p.pct)}%
                <span className="ml-1 text-slate-600">
                  · вес {Math.round(p.weight * 100)}%
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-panel">
              <div
                className={p.color}
                style={{ width: `${Math.min(100, Math.max(0, p.pct))}%`, height: '100%' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WipMrsList({
  items,
  threshold,
}: {
  items: WipMrItem[]
  threshold: number | null
}) {
  if (items.length === 0) return null
  const stale = items.filter((x) => x.is_stale)
  const fresh = items.filter((x) => !x.is_stale)
  const sorted = [...stale, ...fresh].sort((a, b) => b.age_days - a.age_days)
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Открытые PR-ы
        </div>
        {threshold !== null && (
          <div className="text-[10px] text-slate-600">
            «зависший» = больше {threshold} дн.
          </div>
        )}
      </div>
      <ul className="space-y-1.5">
        {sorted.map((w) => (
          <li
            key={w.mr_iid}
            className={
              'flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-[12px] ring-1 ' +
              (w.is_stale
                ? 'bg-rose-500/5 ring-rose-500/30'
                : 'bg-bg-panel/40 ring-white/5')
            }
          >
            <span
              className={
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono ' +
                (w.is_stale
                  ? 'bg-rose-500/20 text-rose-200'
                  : 'bg-amber-500/15 text-amber-200')
              }
            >
              {w.age_days}д
            </span>
            <div className="min-w-0 flex-1">
              {w.url ? (
                <a
                  href={w.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-slate-200 hover:text-accent"
                >
                  {w.title || `MR !${w.mr_iid}`}
                </a>
              ) : (
                <span className="truncate text-slate-200">
                  {w.title || `MR !${w.mr_iid}`}
                </span>
              )}
              <div className="text-[10px] text-slate-500">
                {w.project_name || '—'} · !{w.mr_iid}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SizeBar({ snap }: { snap: DevMetricsSnapshotPublic }) {
  const total =
    snap.mr_size_xs + snap.mr_size_s + snap.mr_size_m + snap.mr_size_l + snap.mr_size_xl
  if (!total) return null
  const items = [
    { label: 'XS', n: snap.mr_size_xs, color: 'bg-emerald-500/60' },
    { label: 'S', n: snap.mr_size_s, color: 'bg-emerald-500/40' },
    { label: 'M', n: snap.mr_size_m, color: 'bg-amber-500/50' },
    { label: 'L', n: snap.mr_size_l, color: 'bg-orange-500/60' },
    { label: 'XL', n: snap.mr_size_xl, color: 'bg-rose-500/60' },
  ]
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Распределение по размеру
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-bg-panel">
        {items.map((i) => (
          <div
            key={i.label}
            className={i.color}
            style={{ width: `${(i.n / total) * 100}%` }}
            title={`${i.label}: ${i.n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
        {items.map((i) => (
          <span key={i.label}>
            <span className="font-mono text-slate-300">{i.label}</span>{' '}
            {i.n} ({pct(i.n, total)})
          </span>
        ))}
      </div>
    </div>
  )
}

const STATE_TONE: Record<string, string> = {
  merged: 'bg-emerald-500/15 text-emerald-300',
  open: 'bg-amber-500/15 text-amber-300',
  closed: 'bg-slate-500/15 text-slate-400',
  wip: 'bg-amber-500/15 text-amber-300',
}

export function DevMetricsTab({ employeeId }: { employeeId: number }) {
  const [period, setPeriod] = useState<PeriodPreset>('90d')
  const [snap, setSnap] = useState<DevMetricsSnapshotPublic | null | undefined>(
    undefined,
  )
  const [prs, setPrs] = useState<PullRequestPublic[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const q = presetToQuery(period)
    setSnap(undefined)
    setPrs(null)
    Promise.all([
      api.employees.devMetrics(employeeId, q),
      api.employees.pullRequests(employeeId, { ...q, limit: 50 }),
    ])
      .then(([s, p]) => {
        if (!cancelled) {
          setSnap(s)
          setPrs(p)
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, period])

  if (error) return <CodeBuddyErrorBanner error={error} />

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <PeriodSelector value={period} onChange={setPeriod} />
      {snap && (
        <span className="text-xs text-slate-500">
          {formatDate(snap.period_start)} — {formatDate(snap.period_end)}
        </span>
      )}
      <span className="ml-auto text-[11px] text-slate-600">
        данные из внешней системы аналитики
      </span>
    </div>
  )

  if (snap === undefined) {
    return (
      <div className="space-y-4">
        {header}
        <div className="text-slate-500">Загрузка…</div>
      </div>
    )
  }
  if (snap === null) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          В выбранном периоде нет PR-ов. Поменяйте период или загрузите данные:{' '}
          <code className="text-slate-300">make seed-dev-metrics</code>.
        </div>
      </div>
    )
  }

  const qrColor =
    snap.avg_quality_ratio >= 0.7
      ? 'text-emerald-400'
      : snap.avg_quality_ratio >= 0.5
        ? 'text-amber-400'
        : 'text-rose-400'

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Pull-requests"
          value={snap.total_mrs}
          hint={`${snap.wip_count} в работе · ${snap.stale_count} зависших`}
          tooltip="Число PR, созданных сотрудником за период (mrCount из CodeBuddy). Снизу: «в работе» — открытые сейчас, «зависших» — открытые дольше порога staleThresholdDays."
        />
        <Tile
          label="Коммитов"
          value={snap.total_commits}
          tooltip="CodeBuddy не отдаёт число коммитов на сводном уровне, поэтому здесь всегда 0."
        />
        <Tile
          label="Строк добавлено / удалено"
          value={`+${snap.lines_added.toLocaleString('ru-RU')}`}
          hint={`−${snap.lines_removed.toLocaleString('ru-RU')}`}
          tooltip="Сумма добавленных и удалённых строк по всем PR за период (linesAdded / linesRemoved из CodeBuddy)."
        />
        <Tile
          label="Средний quality ratio"
          value={
            <span className={qrColor}>
              {(snap.avg_quality_ratio * 100).toFixed(0)}%
            </span> as unknown as string
          }
          hint="среднее по PR за период"
          tooltip="Композитная оценка качества PR от CodeBuddy (prQualityScore, 0–100%), усреднённая по PR. Складывается с весами из: соблюдения conventional commits, наличия описания PR и размера PR (мелкие проще ревьюить → выше). Детали — в блоке «Из чего складывается quality» ниже."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile
          label="С тестами"
          value={`${snap.mr_with_tests} / ${snap.total_mrs}`}
          hint={pct(snap.mr_with_tests, snap.total_mrs)}
          tooltip="Сколько PR за период затронули тестовые файлы (prsWithTests из CodeBuddy), от общего числа PR."
        />
        <Tile
          label="С описанием"
          value={`${snap.mr_with_description} / ${snap.total_mrs}`}
          hint={pct(snap.mr_with_description, snap.total_mrs)}
          tooltip="Оценочное значение: CodeBuddy не отдаёт точное число PR с описанием, оно выводится из доли компонента «описание» в quality-breakdown."
        />
        <Tile
          label="С review-обсуждением"
          value={`${snap.mr_with_review_discussion} / ${snap.total_mrs}`}
          hint={pct(snap.mr_with_review_discussion, snap.total_mrs)}
          tooltip="Грубый proxy: CodeBuddy не даёт признак обсуждения по каждому PR. Если за период получен хотя бы один комментарий от коллег — засчитываются все PR, иначе 0."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Tile
          label="Среднее число итераций"
          value={snap.avg_iterations.toFixed(2)}
          hint="меньше = лучше"
          tooltip="Приближение: считается как 1 + reworkRate (доля PR с переделками). Средние итерации напрямую CodeBuddy не отдаёт."
        />
        <Tile
          label="Среднее time-to-merge"
          value={
            snap.avg_time_to_merge_hours !== null
              ? `${snap.avg_time_to_merge_hours.toFixed(1)} ч`
              : '—'
          }
          tooltip="Среднее время от создания PR до merge, в часах (avgTimeToMergeHours из CodeBuddy). Считается только по смёрженным PR."
        />
        <Tile
          label="Комментариев дал"
          value={snap.comments_given}
          tooltip="Сколько review-комментариев сотрудник написал к чужим PR за период (commentsWritten из CodeBuddy)."
        />
        <Tile
          label="Комментариев получил"
          value={snap.comments_received}
          hint={
            snap.ai_comments_received > 0
              ? `из них ${snap.ai_comments_received} от AI`
              : undefined
          }
          tooltip="Комментарии к PR сотрудника: от коллег (commentsReceivedFromPeers) плюс от AI-ревьюера (aiCommentsReceived)."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SizeBar snap={snap} />
        {snap.quality_breakdown && (
          <QualityBreakdownBar breakdown={snap.quality_breakdown} />
        )}
      </div>

      {snap.wip_mrs && snap.wip_mrs.length > 0 && (
        <WipMrsList
          items={snap.wip_mrs}
          threshold={snap.stale_threshold_days}
        />
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Последние PR-ы
        </h3>
        {!prs || prs.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Нет данных.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">Проект</th>
                  <th className="px-3 py-2 text-center">Размер</th>
                  <th className="px-3 py-2 text-center">+ / −</th>
                  <th className="px-3 py-2 text-center">Итераций</th>
                  <th className="px-3 py-2 text-center">Quality</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Создан</th>
                </tr>
              </thead>
              <tbody>
                {prs.map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-1 max-w-xs hover:text-accent"
                          title={p.title}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.title}
                        </a>
                      ) : (
                        <div
                          className="line-clamp-1 max-w-xs"
                          title={p.title}
                        >
                          {p.title}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-500">
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent"
                            onClick={(e) => e.stopPropagation()}
                          >
                            !{p.external_id}
                          </a>
                        ) : (
                          <>!{p.external_id}</>
                        )}
                      </div>
                      {p.feature_keys && p.feature_keys.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.feature_keys.slice(0, 5).map((fk) => (
                            <span
                              key={fk}
                              className="rounded bg-bg-panel/60 px-1 py-0.5 text-[9px] font-mono text-slate-400 ring-1 ring-white/5"
                            >
                              {fk}
                            </span>
                          ))}
                          {p.feature_keys.length > 5 && (
                            <span className="text-[9px] text-slate-600">
                              +{p.feature_keys.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {p.project_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {p.size_bucket}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-400">
                      <span className="text-emerald-400">+{p.additions}</span>
                      {' / '}
                      <span className="text-rose-400">−{p.deletions}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{p.iterations}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={
                          p.quality_ratio >= 0.7
                            ? 'text-emerald-400'
                            : p.quality_ratio >= 0.5
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }
                      >
                        {Math.round(p.quality_ratio * 100)}%
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          'rounded px-2 py-0.5 ' +
                          (STATE_TONE[p.state] ||
                            'bg-slate-500/15 text-slate-400')
                        }
                      >
                        {p.state}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(p.created_at_ext)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
