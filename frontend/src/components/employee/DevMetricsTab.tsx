import { useEffect, useMemo, useRef, useState } from 'react'

import {
  DevMetricsSnapshotPublic,
  PullRequestPublic,
  PullRequestStatusAccess,
  PullRequestStatusSync,
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
      <div className="mt-1 text-2xl font-semibold text-slate-200">{value}</div>
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
      color: 'bg-data-1',
    },
    {
      label: 'описание',
      pct: breakdown.description_pct,
      weight: wDesc,
      color: 'bg-data-2',
    },
    {
      label: 'размер PR',
      pct: breakdown.size_pct,
      weight: wSize,
      color: 'bg-data-3',
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
  employeeId,
  items,
  prs,
  syncedStatuses,
  onSynced,
  threshold,
}: {
  employeeId: number
  items: WipMrItem[]
  prs: PullRequestPublic[]
  syncedStatuses: Record<string, PullRequestStatusSync>
  onSynced: (key: string, status: PullRequestStatusSync) => void
  threshold: number | null
}) {
  const [access, setAccess] = useState<Record<string, PullRequestStatusAccess>>({})
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const [syncing, setSyncing] = useState<Set<string>>(new Set())
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({})
  const [accessCheckVersion, setAccessCheckVersion] = useState(0)
  const autoAttempted = useRef<Set<string>>(new Set())
  useEffect(() => { autoAttempted.current.clear() }, [employeeId])
  const prByKey = useMemo(() => new Map(prs.map((pr) => [`${pr.project_id ?? 'none'}:${pr.id}`, pr])), [prs])
  const stateOf = (item: WipMrItem) => syncedStatuses[`${item.project_id ?? 'none'}:${item.mr_iid}`]?.state || prByKey.get(`${item.project_id ?? 'none'}:${item.mr_iid}`)?.state || item.state || 'unknown'
  const stateOfPr = (pr: PullRequestPublic) => syncedStatuses[`${pr.project_id ?? 'none'}:${pr.id}`]?.state || pr.state
  const repositoryKey = (url: string) => url.split('/-/merge_requests/', 1)[0]
  const syncCandidates = useMemo(() => {
    const targets = new Map<string, { key: string; url: string }>()
    for (const item of items) {
      const key = `${item.project_id ?? 'none'}:${item.mr_iid}`
      const state = stateOf(item)
      if (item.url && (state === 'unknown' || (state === 'open' && item.is_stale))) {
        targets.set(key, { key, url: item.url })
      }
    }
    for (const pr of prs) {
      const key = `${pr.project_id ?? 'none'}:${pr.id}`
      if (pr.url && stateOfPr(pr) === 'unknown') targets.set(key, { key, url: pr.url })
    }
    return [...targets.values()]
  }, [items, prs, syncedStatuses])

  useEffect(() => {
    let cancelled = false
    const representatives = new Map<string, string>()
    for (const target of syncCandidates) {
      representatives.set(repositoryKey(target.url), target.url)
    }
    const missing = [...representatives].filter(([key]) => access[key] === undefined)
    if (missing.length === 0) return
    setChecking((previous) => new Set([...previous, ...missing.map(([key]) => key)]))
    void Promise.all(missing.map(async ([key, url]) => {
      try {
        const result = await api.employees.pullRequestStatusAccess(employeeId, url)
        if (!cancelled) setAccess((previous) => ({ ...previous, [key]: result }))
      } catch (error) {
        if (!cancelled) setAccess((previous) => ({ ...previous, [key]: { available: false, reason: (error as Error).message, auto_sync_enabled: false } }))
      } finally {
        if (!cancelled) setChecking((previous) => { const next = new Set(previous); next.delete(key); return next })
      }
    }))
    return () => { cancelled = true }
  }, [employeeId, syncCandidates, accessCheckVersion])

  const visible = items.filter((item) => ['open', 'unknown'].includes(stateOf(item)))
  const stale = visible.filter((x) => stateOf(x) === 'open' && x.is_stale)
  const fresh = visible.filter((x) => stateOf(x) !== 'open' || !x.is_stale)
  const sorted = [...stale, ...fresh].sort((a, b) => b.age_days - a.age_days)
  const accessibleCandidates = syncCandidates.filter((target) => access[repositoryKey(target.url)]?.available)
  const accessChecking = syncCandidates.some((target) => checking.has(repositoryKey(target.url)) || access[repositoryKey(target.url)] === undefined)
  const autoSyncEnabled = Object.values(access).some((item) => item.auto_sync_enabled)
  const syncTargets = async (targets: Array<{ key: string; url: string }>) => {
    const keys = targets.map((target) => target.key)
    setSyncing((previous) => new Set([...previous, ...keys]))
    await Promise.all(targets.map(async (target) => {
      try { onSynced(target.key, await api.employees.syncPullRequestStatus(employeeId, target.url)) }
      catch (error) { setSyncErrors((previous) => ({ ...previous, [target.key]: (error as Error).message })) }
      finally { setSyncing((previous) => { const next = new Set(previous); next.delete(target.key); return next }) }
    }))
  }
  const syncAll = async () => {
    setSyncErrors({})
    await syncTargets(accessibleCandidates)
  }
  useEffect(() => {
    if (accessChecking || !autoSyncEnabled) return
    const targets = accessibleCandidates.filter((target) => !autoAttempted.current.has(target.key))
    if (targets.length === 0) return
    targets.forEach((target) => autoAttempted.current.add(target.key))
    void syncTargets(targets)
  }, [accessChecking, accessibleCandidates, autoSyncEnabled])
  if (visible.length === 0 && syncCandidates.length === 0) return null
  const bulkDisabledReason = accessChecking ? 'Проверяем доступ к репозиториям…' : accessibleCandidates.length === 0 ? 'Нет доступа к репозиториям PR, требующих сверки' : null
  const retryAccess = () => {
    autoAttempted.current.clear()
    setAccess({})
    setAccessCheckVersion((value) => value + 1)
  }
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Открытые PR-ы и PR с неизвестным статусом
        </div>
        <div className="flex items-center gap-3">
          {threshold !== null && <div className="text-[10px] text-slate-600">«зависший» = больше {threshold} дн.</div>}
          {!accessChecking && !autoSyncEnabled && syncCandidates.length > 0 && <div className="text-[10px] text-slate-500">автосинхронизация отключена</div>}
          {syncCandidates.length > 0 && <button type="button" disabled={Boolean(bulkDisabledReason) || syncing.size > 0} title={bulkDisabledReason || `Повторно получить статусы ${accessibleCandidates.length} PR напрямую из GitLab`} onClick={() => void syncAll()} className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40">{syncing.size > 0 ? `Синхронизация: ${syncing.size}` : `Синхронизировать статусы (${accessibleCandidates.length === syncCandidates.length ? syncCandidates.length : `${accessibleCandidates.length} из ${syncCandidates.length}`})`}</button>}
          {syncCandidates.length > 0 && !accessChecking && accessibleCandidates.length < syncCandidates.length && <button type="button" onClick={retryAccess} className="rounded-lg px-2 py-1.5 text-[11px] text-ink-muted ring-1 ring-outline-subtle hover:text-ink">Проверить доступ ещё раз</button>}
        </div>
      </div>
      <ul className="space-y-1.5">
        {sorted.map((w) => {
          const key = `${w.project_id ?? 'none'}:${w.mr_iid}`
          const state = stateOf(w)
          const confirmedStale = state === 'open' && w.is_stale
          return (
          <li
            key={key}
            className={
              'flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] ' +
              (confirmedStale
                ? 'semantic-row-warning border-l-2'
                : 'border-outline-strong bg-surface')
            }
          >
            <span
              className={
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono ' +
                (confirmedStale
                  ? 'semantic-status-warning'
                  : 'semantic-status-neutral')
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
              {syncErrors[key] && <div className="mt-1 text-[10px] text-danger">{syncErrors[key]}</div>}
            </div>
            <span className={state === 'unknown' ? 'rounded bg-slate-500/15 px-2 py-1 text-[10px] uppercase text-slate-400' : 'rounded bg-amber-500/15 px-2 py-1 text-[10px] uppercase text-amber-400'}>{state === 'unknown' ? 'Unknown' : 'Open'}</span>
            {syncing.has(key) && <span className="text-[10px] text-primary">синхронизация…</span>}
          </li>
          )
        })}
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
    { label: 'L', n: snap.mr_size_l, color: 'bg-data-4' },
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
  const [syncedStatuses, setSyncedStatuses] = useState<Record<string, PullRequestStatusSync>>({})

  useEffect(() => {
    let cancelled = false
    const q = presetToQuery(period)
    setSnap(undefined)
    setPrs(null)
    setSyncedStatuses({})
    Promise.all([
      api.employees.devMetrics(employeeId, q),
      api.employees.pullRequests(employeeId, { ...q, limit: 200 }),
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
  const prByKey = new Map((prs || []).map((pr) => [`${pr.project_id ?? 'none'}:${pr.id}`, pr]))
  const wipState = (item: WipMrItem) => syncedStatuses[`${item.project_id ?? 'none'}:${item.mr_iid}`]?.state || prByKey.get(`${item.project_id ?? 'none'}:${item.mr_iid}`)?.state || item.state || 'unknown'
  const confirmedWip = snap.wip_mrs.filter((item) => wipState(item) === 'open')
  const unknownWip = snap.wip_mrs.filter((item) => wipState(item) === 'unknown')
  const confirmedStale = confirmedWip.filter((item) => item.is_stale)

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Pull-requests"
          value={snap.total_mrs}
          hint={`${confirmedWip.length} в работе · ${confirmedStale.length} зависших · ${unknownWip.length} Unknown`}
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
          employeeId={employeeId}
          items={snap.wip_mrs}
          prs={prs || []}
          syncedStatuses={syncedStatuses}
          onSynced={(key, status) => setSyncedStatuses((previous) => ({ ...previous, [key]: status }))}
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
                {prs.map((p) => {
                  const displayedState = syncedStatuses[`${p.project_id ?? 'none'}:${p.id}`]?.state || p.state
                  return <tr key={`${p.project_id ?? 'none'}:${p.id}`} className="border-t border-white/5">
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
                          (STATE_TONE[displayedState] ||
                            'bg-slate-500/15 text-slate-400')
                        }
                      >
                        {displayedState}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(p.created_at_ext)}
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
