import { useEffect, useState } from 'react'

import {
  CompetencyTopSignal,
  CompetencyTopicCoverage,
  ExtractedCompetencyItem,
  ExtractedCompetencyPRExample,
  PullRequestPublic,
  api,
} from '../../api/client'
import { CodeBuddyErrorBanner } from '../CodeBuddyErrorBanner'
import {
  PeriodPreset,
  PeriodSelector,
  presetToQuery,
} from '../PeriodSelector'

function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return 'нет данных по периоду'
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  return `${fmt(start)} — ${fmt(end)}`
}

type Group = 'aligned' | 'gap_unproven' | 'bonus' | 'unverified'

function groupOf(it: ExtractedCompetencyItem): Group {
  const req = it.required_level
  const freq = it.frequency
  if ((req === null || req === 0) && freq > 0) return 'bonus'
  if (req !== null && req > 0 && freq === 0) return 'gap_unproven'
  if (req !== null && req > 0 && freq > 0) return 'aligned'
  return 'unverified'
}

const GROUPS: {
  key: Group
  title: string
  hint: string
  tone: string
  icon: string
}[] = [
  {
    key: 'aligned',
    title: 'Заявлено и подтверждается',
    hint: 'Требуется по МПК — видно в PR-ах',
    tone: 'border-emerald-500/40',
    icon: '✓',
  },
  {
    key: 'gap_unproven',
    title: 'Заявлено, но не видно в PR-ах',
    hint: 'Указано в МПК, но в PR-ах не проявляется',
    tone: 'border-rose-500/40',
    icon: '!',
  },
  {
    key: 'bonus',
    title: 'Не заявлено, но проявляется',
    hint: 'Демонстрирует компетенцию шире своего профиля',
    tone: 'border-amber-500/40',
    icon: '+',
  },
]

const GROUP_BG: Record<Group, string> = {
  aligned: 'bg-emerald-500/5',
  gap_unproven: 'bg-rose-500/5',
  bonus: 'bg-amber-500/5',
  unverified: 'bg-slate-500/5',
}

function PRRow({ ex }: { ex: ExtractedCompetencyPRExample }) {
  return (
    <li className="rounded-lg bg-bg-panel/40 px-3 py-1.5">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="font-mono text-[10px] text-slate-600">
          {ex.pr_external_id}
        </span>
        {ex.url ? (
          <a
            href={ex.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-slate-200 hover:text-accent"
          >
            {ex.title}
          </a>
        ) : (
          <span className="truncate text-slate-200">{ex.title}</span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">{ex.evidence}</div>
    </li>
  )
}

function TopSignalChips({ signals }: { signals: CompetencyTopSignal[] }) {
  if (signals.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {signals.slice(0, 8).map((s) => (
        <span
          key={s.signal}
          title={`${s.signal_type} · weight ${s.weight} · contribution ${s.contribution.toFixed(1)}`}
          className="rounded-md bg-bg-panel/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 ring-1 ring-white/5"
        >
          {s.signal}
          <span className="ml-1 text-[10px] text-slate-500">×{s.occurrences}</span>
        </span>
      ))}
    </div>
  )
}

function TopicCoverageList({ topics }: { topics: CompetencyTopicCoverage[] }) {
  if (topics.length === 0) return null
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        Покрытие тем ИПР
      </div>
      {topics.slice(0, 6).map((t) => (
        <div
          key={t.topic_id}
          className="flex items-baseline gap-2 text-[11px] text-slate-300"
        >
          {t.section && (
            <span className="text-slate-500">{t.section} ·</span>
          )}
          <span className="flex-1 truncate">{t.topic}</span>
          {t.recommended_level !== null && (
            <span className="font-mono text-slate-500">
              ИПР L{t.recommended_level}
            </span>
          )}
          <span
            className={
              'font-mono ' +
              (t.score >= 70
                ? 'text-emerald-400'
                : t.score >= 30
                  ? 'text-amber-400'
                  : 'text-slate-400')
            }
          >
            {Math.round(t.score)}
          </span>
        </div>
      ))}
    </div>
  )
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function CompetencyCard({
  it,
  employeeId,
  periodQuery,
  expanded,
  onToggle,
}: {
  it: ExtractedCompetencyItem
  employeeId: number
  periodQuery: { from?: string; to?: string }
  expanded: boolean
  onToggle: () => void
}) {
  const g = groupOf(it)
  const hasExamples = it.pr_examples.length > 0
  const hasSignals = it.top_signals.length > 0
  const hasTopics = it.topic_coverage.length > 0
  const hasAnswer = !!it.mptk_answer
  const hasDrilldown = hasExamples || hasSignals || hasTopics || hasAnswer

  // Лениво подгружаем PR-ы по этой компетенции при первом expand.
  const [prs, setPrs] = useState<
    PullRequestPublic[] | 'loading' | 'error' | null
  >(null)
  useEffect(() => {
    if (!expanded || prs !== null) return
    setPrs('loading')
    api.employees
      .competencyPrs(employeeId, it.competency_id, periodQuery)
      .then((list) => setPrs(list))
      .catch(() => setPrs('error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])
  const prsList = Array.isArray(prs) ? prs : []
  const prsLoading = prs === 'loading'
  const prsError = prs === 'error'
  const reqLabel =
    it.required_level !== null && it.required_level > 0
      ? `L${it.required_level}`
      : '—'
  const curLabel = it.current_level !== null ? `L${it.current_level}` : '—'

  return (
    <div className={`rounded-xl ring-1 ring-white/5 ${GROUP_BG[g]}`}>
      <button
        onClick={hasDrilldown ? onToggle : undefined}
        disabled={!hasDrilldown}
        className={
          'flex w-full items-baseline gap-3 px-3 py-2.5 text-left transition ' +
          (hasDrilldown ? 'hover:bg-white/[0.02]' : 'cursor-default')
        }
      >
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
          {it.competency_name}
        </div>
        {it.frequency_score !== null && it.frequency_score !== undefined && (
          <span
            title="frequencyScore — оценка частоты проявления (0..100)"
            className={
              'shrink-0 font-mono text-[11px] ' +
              (it.frequency_score >= 70
                ? 'text-emerald-400'
                : it.frequency_score >= 30
                  ? 'text-amber-400'
                  : 'text-slate-400')
            }
          >
            {Math.round(it.frequency_score)}
          </span>
        )}
        <span className="shrink-0 font-mono text-[11px] text-slate-400">
          {it.frequency > 0 ? `${it.frequency} PR` : '0 PR'}
        </span>
        <span className="shrink-0 text-[11px] text-slate-500">
          <span>МПК:</span>{' '}
          <span className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-slate-300">
            {reqLabel}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-slate-500">
          <span>факт:</span>{' '}
          <span className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-slate-300">
            {curLabel}
          </span>
        </span>
        {hasDrilldown && (
          <span className="shrink-0 text-[11px] text-slate-500">
            {expanded ? '▴' : '▾'}
          </span>
        )}
      </button>

      {/* Чипсы топ-сигналов всегда видны (если есть) — это «почему такая оценка». */}
      {hasSignals && (
        <div className="border-t border-white/5 px-3 py-2">
          <TopSignalChips signals={it.top_signals} />
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-white/5 px-3 py-2.5">
          {hasTopics && <TopicCoverageList topics={it.topic_coverage} />}
          {hasAnswer && it.mptk_answer && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Рекомендация по развитию (МПК)
              </div>
              <div className="whitespace-pre-line rounded-lg bg-bg-panel/40 px-3 py-2 text-[12px] leading-relaxed text-slate-300">
                {it.mptk_answer}
              </div>
            </div>
          )}
          {/* PR-ы по компетенции — лениво подгружаются */}
          {prsLoading ? (
            <div className="text-[11px] text-slate-500">
              Загружаем PR-ы по компетенции…
            </div>
          ) : prsError ? (
            <div className="text-[11px] text-rose-400">
              Не удалось загрузить PR-ы.
            </div>
          ) : prsList.length > 0 ? (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                PR-ы по этой компетенции ({prsList.length})
              </div>
              <div className="overflow-hidden rounded bg-bg-panel/20">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5">PR</th>
                      <th className="px-2 py-1.5">Репо</th>
                      <th className="px-2 py-1.5 text-center">Размер</th>
                      <th className="px-2 py-1.5 text-center">Quality</th>
                      <th className="px-2 py-1.5 text-right">Создан</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prsList.slice(0, 30).map((p) => (
                      <tr key={p.id} className="border-t border-white/5">
                        <td className="px-2 py-1.5">
                          {p.url ? (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="line-clamp-1 max-w-xs hover:text-accent"
                              title={p.title}
                            >
                              {p.title}
                            </a>
                          ) : (
                            <span
                              className="line-clamp-1 max-w-xs"
                              title={p.title}
                            >
                              {p.title}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">
                          {p.project_name || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono">
                          {p.size_bucket}
                        </td>
                        <td className="px-2 py-1.5 text-center">
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
                        <td className="px-2 py-1.5 text-right text-slate-500">
                          {fmtDateShort(p.created_at_ext)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : hasExamples ? (
            <ul className="space-y-1">
              {it.pr_examples.map((ex) => (
                <PRRow key={ex.pr_id} ex={ex} />
              ))}
            </ul>
          ) : (
            hasSignals && (
              <div className="text-[11px] text-slate-500">
                PR-ы не сматчены (сигналы про комментарии или нет пересечения
                с feature_keys этого PR-окна).
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

export function ExtractedCompetenciesTab({
  employeeId,
}: {
  employeeId: number
}) {
  const [period, setPeriod] = useState<PeriodPreset>('90d')
  const [items, setItems] = useState<ExtractedCompetencyItem[] | null>(null)
  const [periodInfo, setPeriodInfo] = useState<{
    start: string | null
    end: string | null
  }>({ start: null, end: null })
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [withAnswers, setWithAnswers] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.employees
      .extractedCompetencies(employeeId, {
        ...presetToQuery(period),
        include_answers: withAnswers,
      })
      .then((r) => {
        if (cancelled) return
        setItems(r.items)
        setPeriodInfo({ start: r.period_start, end: r.period_end })
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
  }, [employeeId, period, withAnswers])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (error) return <CodeBuddyErrorBanner error={error} />

  const groups: Record<Group, ExtractedCompetencyItem[]> = {
    aligned: [],
    gap_unproven: [],
    bonus: [],
    unverified: [],
  }
  if (items) {
    for (const it of items) groups[groupOf(it)].push(it)
    for (const k of Object.keys(groups) as Group[]) {
      groups[k].sort(
        (a, b) => b.frequency - a.frequency || a.sort_order - b.sort_order,
      )
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <span className="text-xs text-slate-500">
          {formatPeriod(periodInfo.start, periodInfo.end)}
        </span>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200">
          <input
            type="checkbox"
            checked={withAnswers}
            onChange={(e) => setWithAnswers(e.target.checked)}
            className="accent-accent h-3 w-3"
          />
          Развёрнутые рекомендации МПК
        </label>
        <span className="ml-auto text-[11px] text-slate-600">
          AI-разбор PR-ов сотрудника
        </span>
      </div>

      {loading && !items && <div className="text-slate-500">Загрузка…</div>}

      {items && items.length === 0 && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          В этом периоде у сотрудника нет ни одного релевантного PR-а.
        </div>
      )}

      {items &&
        GROUPS.map(({ key, title, hint, tone, icon }) => {
          const arr = groups[key]
          if (arr.length === 0) return null
          return (
            <section key={key}>
              <div
                className={`mb-2 flex items-baseline gap-2 border-l-2 pl-2 ${tone}`}
              >
                <span
                  className={
                    'inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ' +
                    (key === 'aligned'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : key === 'gap_unproven'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-amber-500/20 text-amber-300')
                  }
                >
                  {icon}
                </span>
                <h3 className="text-sm font-semibold text-slate-200">
                  {title}
                </h3>
                <span className="text-xs text-slate-500">· {arr.length}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {hint}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {arr.map((it) => (
                  <CompetencyCard
                    key={it.competency_id}
                    it={it}
                    employeeId={employeeId}
                    periodQuery={presetToQuery(period)}
                    expanded={expanded.has(it.competency_id)}
                    onToggle={() => toggle(it.competency_id)}
                  />
                ))}
              </div>
            </section>
          )
        })}
    </div>
  )
}
