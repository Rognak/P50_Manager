import { useMemo, useState } from 'react'

import { MpkHistory } from '../../api/client'

const PALETTE = [
  'var(--chart-primary)',
  'var(--data-1)',
  'var(--data-2)',
  'var(--data-3)',
  'var(--data-4)',
  'var(--data-5)',
  'var(--data-6)',
]

const W = 820
const H = 280
const PAD_L = 32
const PAD_R = 16
const PAD_T = 16
const PAD_B = 28

function buildSeries(history: MpkHistory) {
  // общий отсортированный список дат, по которым есть хотя бы одна оценка
  const allDates = new Set<string>()
  for (const c of history.competencies) {
    for (const p of c.points) allDates.add(p.assessed_at)
  }
  const dates = Array.from(allDates).sort()
  return { dates }
}

function pickInitial(history: MpkHistory): number[] {
  // дефолт: топ-5 по изменчивости (max - min) среди тех, у кого >= 2 точек
  const candidates = history.competencies
    .filter((c) => c.points.length >= 2)
    .map((c) => {
      const levels = c.points.map((p) => p.level)
      const spread = Math.max(...levels) - Math.min(...levels)
      return { id: c.competency_id, spread }
    })
  candidates.sort((a, b) => b.spread - a.spread)
  if (candidates.length === 0) {
    return history.competencies.slice(0, 5).map((c) => c.competency_id)
  }
  return candidates.slice(0, 5).map((c) => c.id)
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' })
}

export function DynamicsChart({ history }: { history: MpkHistory }) {
  const { dates } = useMemo(() => buildSeries(history), [history])
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(pickInitial(history)),
  )
  const [hover, setHover] = useState<{ x: number; y: number; label: string } | null>(
    null,
  )

  const competenciesWithHistory = history.competencies.filter(
    (c) => c.points.length > 0,
  )

  if (dates.length < 2) {
    return (
      <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-sm text-slate-500">
        Для построения динамики нужно минимум 2 оценки. Сейчас: {dates.length}.
      </div>
    )
  }

  const colorById = new Map<number, string>()
  competenciesWithHistory.forEach((c, i) => {
    colorById.set(c.competency_id, PALETTE[i % PALETTE.length])
  })

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const xStep = dates.length > 1 ? innerW / (dates.length - 1) : 0
  const yForLevel = (lvl: number) => PAD_T + innerH - (lvl / 5) * innerH
  const xForDateIdx = (i: number) => PAD_L + i * xStep

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () =>
    setSelected(new Set(competenciesWithHistory.map((c) => c.competency_id)))
  const clearAll = () => setSelected(new Set())

  return (
    <div className="rounded-2xl bg-bg-elevated p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">
          Динамика уровней по компетенциям
        </h3>
        <div className="flex gap-3 text-xs">
          <button onClick={selectAll} className="text-slate-400 hover:text-slate-200">
            все
          </button>
          <button onClick={clearAll} className="text-slate-400 hover:text-slate-200">
            сбросить
          </button>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: H, maxHeight: H }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Горизонтальная сетка по уровням 0..5 */}
          {[0, 1, 2, 3, 4, 5].map((lvl) => (
            <g key={lvl}>
              <line
                x1={PAD_L}
                y1={yForLevel(lvl)}
                x2={W - PAD_R}
                y2={yForLevel(lvl)}
                stroke="var(--chart-grid)"
                strokeOpacity="0.45"
                strokeDasharray={lvl === 0 ? undefined : '2,2'}
              />
              <text
                x={PAD_L - 6}
                y={yForLevel(lvl) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--chart-muted)"
              >
                {lvl}
              </text>
            </g>
          ))}
          {/* X-axis labels */}
          {dates.map((d, i) => (
            <text
              key={d}
              x={xForDateIdx(i)}
              y={H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="var(--chart-muted)"
            >
              {formatDateShort(d)}
            </text>
          ))}
          {/* Линии выбранных компетенций */}
          {competenciesWithHistory
            .filter((c) => selected.has(c.competency_id))
            .map((c) => {
              const color = colorById.get(c.competency_id) || 'var(--chart-primary)'
              const pointsByDate = new Map(
                c.points.map((p) => [p.assessed_at, p.level]),
              )
              const coords: Array<{ x: number; y: number; lvl: number; date: string }> = []
              dates.forEach((d, i) => {
                const lvl = pointsByDate.get(d)
                if (lvl !== undefined) {
                  coords.push({ x: xForDateIdx(i), y: yForLevel(lvl), lvl, date: d })
                }
              })
              const path = coords
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                .join(' ')
              return (
                <g key={c.competency_id}>
                  <path d={path} fill="none" stroke={color} strokeWidth={2} />
                  {coords.map((p) => (
                    <circle
                      key={`${p.date}-${c.competency_id}`}
                      cx={p.x}
                      cy={p.y}
                      r={4}
                      fill={color}
                      onMouseEnter={() =>
                        setHover({
                          x: p.x,
                          y: p.y,
                          label: `${c.name.slice(0, 40)} · ${formatDateShort(
                            p.date,
                          )} · ${p.lvl}`,
                        })
                      }
                    />
                  ))}
                </g>
              )
            })}
          {/* Hover tooltip (native svg) */}
          {hover && (
            <g>
              <rect
                x={Math.min(hover.x + 8, W - 220)}
                y={Math.max(hover.y - 28, 4)}
                width={210}
                height={24}
                fill="var(--chart-tooltip)"
                stroke="var(--chart-border)"
                rx={4}
              />
              <text
                x={Math.min(hover.x + 14, W - 214)}
                y={Math.max(hover.y - 11, 20)}
                fontSize="11"
                fill="var(--chart-tooltip-text)"
              >
                {hover.label}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Легенда-чипы */}
      <div className="mt-4 flex flex-wrap gap-2">
        {competenciesWithHistory.map((c) => {
          const color = colorById.get(c.competency_id)!
          const isOn = selected.has(c.competency_id)
          return (
            <button
              key={c.competency_id}
              onClick={() => toggle(c.competency_id)}
              className={`flex items-center gap-2 rounded px-2 py-1 text-xs ring-1 transition ${
                isOn
                  ? 'bg-bg-panel text-slate-200 ring-white/10'
                  : 'text-slate-500 ring-white/5 hover:text-slate-300'
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  background: isOn ? color : 'transparent',
                  border: isOn ? 'none' : `1px solid ${color}`,
                }}
              />
              {c.name.slice(0, 35)}
              {c.name.length > 35 && '…'}
              <span className="text-slate-500">({c.points.length})</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
