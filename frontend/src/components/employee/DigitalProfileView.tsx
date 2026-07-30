import { ReactNode } from 'react'

import { DigitalProfileContent } from '../../api/client'

const PRIORITY_TONE: Record<
  'high' | 'medium' | 'low',
  { label: string; cls: string }
> = {
  high: {
    label: 'критично',
    cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  },
  medium: {
    label: 'важно',
    cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  },
  low: {
    label: 'отложено',
    cls: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  },
}

const SECTION_TONES = {
  emerald: {
    border: 'border-emerald-500/40',
    badge: 'bg-emerald-500/20 text-emerald-300',
  },
  rose: { border: 'border-rose-500/40', badge: 'bg-rose-500/20 text-rose-300' },
  amber: {
    border: 'border-amber-500/40',
    badge: 'bg-amber-500/20 text-amber-300',
  },
  violet: {
    border: 'border-violet-500/40',
    badge: 'bg-violet-500/20 text-violet-300',
  },
  sky: { border: 'border-sky-500/40', badge: 'bg-sky-500/20 text-sky-300' },
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
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {count !== undefined && (
        <span className="text-xs text-slate-500">· {count}</span>
      )}
    </div>
  )
}

function Card({
  title,
  detail,
  source,
}: {
  title: string
  detail: string
  source?: string | null
}) {
  return (
    <div className="rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5">
      <div className="text-sm font-medium text-slate-200">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-slate-400">
        {detail}
      </div>
      {source && (
        <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
          источник: <span className="text-slate-400">{source}</span>
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
          ? 'bg-accent/15 text-accent'
          : 'bg-slate-500/15 text-slate-500')
      }
    >
      {v || '—'}
    </span>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-bg-elevated px-4 py-3 text-xs text-slate-500 ring-1 ring-white/5">
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
      <div className="space-y-3 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
        {content.headline && (
          <div className="text-sm font-medium leading-snug text-accent">
            {content.headline}
          </div>
        )}
        {content.summary && (
          <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">
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
            tone="emerald"
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
            tone="rose"
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
            tone="amber"
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
            tone="violet"
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
            tone="sky"
          />
          <div className="space-y-2">
            {content.actions.map((a, i) => {
              const t = PRIORITY_TONE[a.priority] || PRIORITY_TONE.medium
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5"
                >
                  <span
                    className={
                      'mt-0.5 shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ring-1 ' +
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
