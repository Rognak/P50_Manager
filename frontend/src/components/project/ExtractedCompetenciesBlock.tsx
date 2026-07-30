import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  CompetencyTopSignal,
  ExtractedCompetencyPRExample,
  ProjectCompetencyEmployeeContrib,
  ProjectExtractedCompetenciesResponse,
  ProjectExtractedCompetencyItem,
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

type Group = 'aligned' | 'gap' | 'bonus' | 'unused'

function groupOf(it: ProjectExtractedCompetencyItem): Group {
  const isStack = it.project_target_level !== null
  const isShowing = it.employees_with > 0
  if (isStack && isShowing) return 'aligned'
  if (isStack && !isShowing) return 'gap'
  if (!isStack && isShowing) return 'bonus'
  return 'unused'
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
    title: 'В стеке и применяется',
    hint: 'Заявлено в проекте, проявляется в PR-ах',
    tone: 'border-emerald-500/40',
    icon: '✓',
  },
  {
    key: 'gap',
    title: 'В стеке, но никто не проявляет',
    hint: 'Целевой уровень есть, но команда её не использует',
    tone: 'border-rose-500/40',
    icon: '!',
  },
  {
    key: 'bonus',
    title: 'Бонус: не заявлено, но команда применяет',
    hint: 'Не в стеке проекта, но активно используется',
    tone: 'border-amber-500/40',
    icon: '+',
  },
]

const GROUP_BG: Record<Group, string> = {
  aligned: 'bg-emerald-500/5',
  gap: 'bg-rose-500/5',
  bonus: 'bg-amber-500/5',
  unused: 'bg-slate-500/5',
}

function EmployeeRow({
  c,
  onEmployee,
}: {
  c: ProjectCompetencyEmployeeContrib
  onEmployee: (id: number) => void
}) {
  return (
    <li className="rounded-lg bg-bg-panel/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <button
          onClick={() => onEmployee(c.employee_id)}
          className="truncate text-sm font-medium text-slate-200 hover:text-accent"
        >
          {c.full_name}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-slate-500">
          {c.frequency} PR
        </span>
      </div>
      {c.pr_examples.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px]">
          {c.pr_examples.map((ex) => (
            <PRRow key={ex.pr_id} ex={ex} />
          ))}
        </ul>
      )}
    </li>
  )
}

function PRRow({ ex }: { ex: ExtractedCompetencyPRExample }) {
  return (
    <li className="flex items-baseline gap-2 text-slate-400">
      <span className="font-mono text-[10px] text-slate-600">
        {ex.pr_external_id}
      </span>
      {ex.url ? (
        <a
          href={ex.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate hover:text-accent"
          title={ex.title}
        >
          {ex.title}
        </a>
      ) : (
        <span className="truncate" title={ex.title}>
          {ex.title}
        </span>
      )}
    </li>
  )
}

function ProjectTopSignalChips({
  signals,
}: {
  signals: CompetencyTopSignal[]
}) {
  if (signals.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 border-t border-white/5 px-3 py-2">
      {signals.map((s) => (
        <span
          key={s.signal}
          title={`${s.signal_type} · вклад ${s.contribution.toFixed(1)}`}
          className="rounded bg-bg-panel/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 ring-1 ring-white/5"
        >
          {s.signal}
          <span className="ml-1 text-slate-500">×{s.occurrences}</span>
        </span>
      ))}
    </div>
  )
}

function CompetencyCard({
  it,
  expanded,
  onToggle,
  onEmployee,
}: {
  it: ProjectExtractedCompetencyItem
  expanded: boolean
  onToggle: () => void
  onEmployee: (id: number) => void
}) {
  const g = groupOf(it)
  const hasEmployees = it.employees.length > 0
  const hasSignals = it.top_signals && it.top_signals.length > 0

  return (
    <div className={`rounded-xl ring-1 ring-white/5 ${GROUP_BG[g]}`}>
      <button
        onClick={hasEmployees ? onToggle : undefined}
        disabled={!hasEmployees}
        className={
          'flex w-full items-baseline gap-3 px-3 py-2.5 text-left transition ' +
          (hasEmployees ? 'hover:bg-white/[0.02]' : 'cursor-default')
        }
      >
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">
          {it.competency_name}
        </div>
        {it.total_frequency > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-slate-400">
            {it.total_frequency} PR
          </span>
        )}
        {it.project_target_level !== null ? (
          <span
            className="shrink-0 rounded bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent"
            title="Целевой уровень проекта"
          >
            L{it.project_target_level}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-slate-600">
            не в стеке
          </span>
        )}
        {hasEmployees && (
          <span className="shrink-0 text-[11px] text-slate-500">
            {expanded ? '▴' : '▾'}
          </span>
        )}
      </button>

      {hasSignals && <ProjectTopSignalChips signals={it.top_signals} />}

      {expanded && hasEmployees && (
        <ul className="space-y-1.5 border-t border-white/5 px-3 py-2.5">
          {it.employees.map((c) => (
            <EmployeeRow
              key={c.employee_id}
              c={c}
              onEmployee={onEmployee}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function ProjectExtractedCompetenciesBlock({
  projectId,
}: {
  projectId: number
}) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState<PeriodPreset>('90d')
  const [data, setData] = useState<ProjectExtractedCompetenciesResponse | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.projects
      .extractedCompetencies(projectId, presetToQuery(period))
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
  }, [projectId, period])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (error) return <CodeBuddyErrorBanner error={error} />

  const groups: Record<Group, ProjectExtractedCompetencyItem[]> = {
    aligned: [],
    gap: [],
    bonus: [],
    unused: [],
  }
  if (data) {
    for (const it of data.items) groups[groupOf(it)].push(it)
    for (const k of Object.keys(groups) as Group[]) {
      groups[k].sort(
        (a, b) =>
          b.employees_with - a.employees_with || a.sort_order - b.sort_order,
      )
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        {data && (
          <span className="text-xs text-slate-500">
            {formatPeriod(data.period_start, data.period_end)} ·{' '}
            активных участников:{' '}
            <span className="text-slate-300">{data.total_team}</span>
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-600">
          источник: AI-разбор PR-ов команды
        </span>
      </div>

      {loading && !data && (
        <div className="text-slate-500">Загрузка…</div>
      )}

      {data && data.items.length === 0 && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          В этом периоде нет ни одной компетенции с проявлениями.
        </div>
      )}

      {data &&
        GROUPS.map(({ key, title, hint, tone, icon }) => {
          const items = groups[key]
          if (items.length === 0) return null
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
                      : key === 'gap'
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-amber-500/20 text-amber-300')
                  }
                >
                  {icon}
                </span>
                <h3 className="text-sm font-semibold text-slate-200">
                  {title}
                </h3>
                <span className="text-xs text-slate-500">· {items.length}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {hint}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {items.map((it) => (
                  <CompetencyCard
                    key={it.competency_id}
                    it={it}
                    expanded={expanded.has(it.competency_id)}
                    onToggle={() => toggle(it.competency_id)}
                    onEmployee={(eid) => navigate(`/employees/${eid}`)}
                  />
                ))}
              </div>
            </section>
          )
        })}
    </div>
  )
}
