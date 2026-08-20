import { ReactNode } from 'react'

import { DigitalProfileContent } from '../../api/client'

const PRIORITY_TONE: Record<
  'high' | 'medium' | 'low',
  { label: string; cls: string; row: string }
> = {
  high: {
    label: 'критично',
    cls: 'semantic-status-danger',
    row: 'semantic-card-danger',
  },
  medium: {
    label: 'важно',
    cls: 'semantic-status-warning',
    row: 'semantic-card-warning',
  },
  low: {
    label: 'отложено',
    cls: 'semantic-status-neutral',
    row: 'semantic-card-neutral',
  },
}

const SECTION_TONES = {
  success: {
    border: 'border-success/70',
    badge: 'semantic-status-success',
  },
  warning: {
    border: 'border-warning/70',
    badge: 'semantic-status-warning',
  },
  neutral: {
    border: 'border-outline',
    badge: 'bg-surface-subtle text-ink-secondary ring-1 ring-outline-subtle',
  },
  primary: { border: 'border-primary/60', badge: 'semantic-status-primary' },
} as const

type SectionTone = keyof typeof SECTION_TONES

function SectionHeader({
  icon,
  title,
  count,
  tone,
}: {
  icon: string
  title: string
  count?: number
  tone: SectionTone
}) {
  const t = SECTION_TONES[tone]
  return (
    <div
      className={`mb-3 flex items-baseline gap-2 border-l-2 pl-2 ${t.border}`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold ${t.badge}`}
      >
        {icon}
      </span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {count !== undefined && (
        <span className="text-xs text-ink-muted">· {count}</span>
      )}
    </div>
  )
}

function Card({
  title,
  detail,
  source,
  tone = 'neutral',
}: {
  title: string
  detail: string
  source?: string | null
  tone?: 'success' | 'warning' | 'neutral'
}) {
  const accent = {
    success: 'semantic-card-success',
    warning: 'semantic-card-warning',
    neutral: 'semantic-card-neutral',
  }[tone]
  return (
    <div className={`rounded-xl border border-outline-strong border-l-2 p-3 ${accent}`}>
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-ink-secondary">
        {detail}
      </div>
      {source && (
        <div className="mt-2 text-[10px] uppercase tracking-wide text-ink-muted">
          источник: <span className="text-ink-secondary">{source}</span>
        </div>
      )}
    </div>
  )
}

function GapLevelBadge({ level }: { level: string }) {
  const v = (level || '').trim()
  const isLevel = /^L[0-5]$/i.test(v)
  return (
    <span
      className={
        'inline-block min-w-[2.5rem] rounded px-2 py-0.5 text-center font-mono text-[11px] ' +
        (isLevel
          ? 'bg-primary-soft text-primary'
          : 'bg-surface-subtle text-ink-muted ring-1 ring-outline-subtle')
      }
    >
      {v || '—'}
    </span>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 text-xs text-ink-muted ring-1 ring-outline-subtle">
      {children}
    </div>
  )
}

export function DigitalProfileView({
  content,
}: {
  content: DigitalProfileContent
}) {
  return (
    <div className="space-y-6">
      {/* Шапка — headline + summary */}
      <div className="surface-raised-card space-y-3 rounded-2xl border p-5">
        {content.headline && (
          <div className="text-sm font-medium leading-snug text-ink">
            {content.headline}
          </div>
        )}
        {content.summary && (
          <p className="text-sm leading-relaxed text-ink-secondary whitespace-pre-line">
            {content.summary}
          </p>
        )}
      </div>

      {/* Сильные стороны / Слабые места — две колонки */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <section>
          <SectionHeader
            icon="✓"
            title="Сильные стороны"
            count={content.strengths.length}
            tone="success"
          />
          {content.strengths.length === 0 ? (
            <Empty>нет данных</Empty>
          ) : (
            <div className="space-y-2">
              {content.strengths.map((it, i) => (
                <Card
                  key={i}
                  title={it.title}
                  detail={it.detail}
                  source={it.source}
                  tone="success"
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader
            icon="!"
            title="Слабые места / точки роста"
            count={content.weaknesses.length}
            tone="warning"
          />
          {content.weaknesses.length === 0 ? (
            <Empty>не выявлены</Empty>
          ) : (
            <div className="space-y-2">
              {content.weaknesses.map((it, i) => (
                <Card
                  key={i}
                  title={it.title}
                  detail={it.detail}
                  source={it.source}
                  tone="warning"
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Разрыв «заявлено vs факт» */}
      {content.gaps.length > 0 && (
        <section>
          <SectionHeader
            icon="≠"
            title="Разрыв «заявлено vs факт»"
            count={content.gaps.length}
            tone="warning"
          />
          <div className="overflow-hidden rounded-2xl bg-bg-elevated ring-1 ring-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-xs text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Компетенция</th>
                  <th className="px-4 py-2.5 text-center">МПК</th>
                  <th className="px-4 py-2.5">В PR (факт)</th>
                  <th className="px-4 py-2.5">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {content.gaps.map((g, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-4 py-2.5 text-sm text-slate-200">
                      {g.competency}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <GapLevelBadge level={g.mpk_level} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-300">
                      {g.fact_summary}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400">
                      {g.comment}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Проекты */}
      {content.projects.length > 0 && (
        <section>
          <SectionHeader
            icon="P"
            title="Сводка по проектам"
            count={content.projects.length}
            tone="neutral"
          />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {content.projects.map((p, i) => (
              <div
                key={i}
                className="rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-slate-200">
                    {p.name}
                  </div>
                  {p.role && (
                    <span className="text-[11px] text-slate-500">{p.role}</span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {p.summary}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Рекомендуемые действия */}
      {content.actions.length > 0 && (
        <section>
          <SectionHeader
            icon="→"
            title="Рекомендуемые действия"
            count={content.actions.length}
            tone="primary"
          />
          <div className="space-y-2">
            {content.actions.map((a, i) => {
              const t = PRIORITY_TONE[a.priority] || PRIORITY_TONE.medium
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-xl border border-outline-strong border-l-2 p-3 ${t.row}`}
                >
                  <span
                    className={
                      'mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ' +
                      t.cls
                    }
                  >
                    {t.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-200">
                      {a.title}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-400">
                      {a.detail}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
