import { useState } from 'react'

import { SelfReviewListItem } from '../../api/client'

/**
 * Динамика самооценок project/company по годам.
 * Интерактив: hover-зоны, вертикальный курсор, тултип со значениями и Δ.
 */
export function SelfReviewSparkline({
  reviews,
  width = 720,
  height = 220,
}: {
  reviews: SelfReviewListItem[]
  width?: number
  height?: number
}) {
  const sorted = [...reviews].sort((a, b) => a.year - b.year)
  const haveData = sorted.filter(
    (r) => r.project_score !== null || r.company_score !== null,
  )
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (haveData.length < 2) return null

  const years = haveData.map((r) => r.year)
  const minY = Math.min(...years)
  const maxY = Math.max(...years)
  const xRange = Math.max(1, maxY - minY)

  const SCORE_MIN = 1
  const SCORE_MAX = 10
  const PAD_L = 32
  const PAD_R = 24
  const PAD_T = 16
  const PAD_B = 28
  const innerW = width - PAD_L - PAD_R
  const innerH = height - PAD_T - PAD_B

  const xOf = (year: number) =>
    PAD_L + ((year - minY) / xRange) * innerW
  const yOf = (score: number) =>
    PAD_T + innerH - ((score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * innerH

  const buildPath = (key: 'project_score' | 'company_score') => {
    const pts = haveData
      .filter((r) => r[key] !== null)
      .map((r) => ({
        x: xOf(r.year),
        y: yOf(r[key] as number),
        score: r[key] as number,
        year: r.year,
      }))
    const path =
      pts.length >= 2
        ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        : null
    return { path, points: pts }
  }

  const projLine = buildPath('project_score')
  const compLine = buildPath('company_score')

  const hov = hoverIdx !== null ? haveData[hoverIdx] : null
  const prev =
    hoverIdx !== null && hoverIdx > 0 ? haveData[hoverIdx - 1] : null
  const hovX = hov ? xOf(hov.year) : 0
  const tipLeft = hov && hovX > width / 2

  const fmtDelta = (cur: number | null, prv: number | null) => {
    if (cur === null || prv === null) return null
    const d = cur - prv
    return {
      sign: d > 0 ? '+' : d < 0 ? '' : '±',
      value: d.toFixed(0),
      cls:
        d > 0
          ? 'text-emerald-400'
          : d < 0
            ? 'text-rose-400'
            : 'text-slate-500',
    }
  }

  return (
    <div className="rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-300">
          Динамика самооценок (1–10)
        </span>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded bg-accent" /> проект
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded bg-amber-400" />{' '}
            компания
          </span>
        </div>
      </div>
      <div className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* направляющие 1 / 5 / 10 */}
          {[1, 5, 10].map((s) => (
            <g key={s}>
              <line
                x1={PAD_L}
                y1={yOf(s)}
                x2={width - PAD_R}
                y2={yOf(s)}
                stroke="var(--chart-grid)"
                strokeWidth="1"
                strokeDasharray={s === 1 || s === 10 ? '0' : '2 3'}
              />
              <text
                x={PAD_L - 6}
                y={yOf(s) + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--chart-muted)"
              >
                {s}
              </text>
            </g>
          ))}

          {/* вертикальный курсор */}
          {hoverIdx !== null && (
            <line
              x1={hovX}
              y1={PAD_T}
              x2={hovX}
              y2={PAD_T + innerH}
              stroke="var(--chart-cursor)"
              strokeDasharray="3 3"
            />
          )}

          {/* линия + точки project */}
          {projLine.path && (
            <path
              d={projLine.path}
              stroke="var(--chart-primary)"
              strokeWidth="2"
              fill="none"
            />
          )}
          {projLine.points.map((p, i) => {
            const idx = haveData.findIndex((r) => r.year === p.year)
            const isHov = hoverIdx === idx
            return (
              <g key={`p-${i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHov ? 5 : 4}
                  fill="var(--chart-primary)"
                  stroke={isHov ? 'var(--chart-point-outline)' : 'none'}
                  strokeWidth={isHov ? 1.5 : 0}
                />
                <text
                  x={p.x}
                  y={p.y - 9}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--chart-primary)"
                >
                  {p.score}
                </text>
              </g>
            )
          })}

          {/* линия + точки company */}
          {compLine.path && (
            <path
              d={compLine.path}
              stroke="rgb(var(--color-warning))"
              strokeWidth="2"
              fill="none"
              strokeDasharray="4 3"
            />
          )}
          {compLine.points.map((p, i) => {
            const idx = haveData.findIndex((r) => r.year === p.year)
            const isHov = hoverIdx === idx
            return (
              <g key={`c-${i}`}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHov ? 5 : 4}
                  fill="rgb(var(--color-warning))"
                  stroke={isHov ? 'var(--chart-point-outline)' : 'none'}
                  strokeWidth={isHov ? 1.5 : 0}
                />
                <text
                  x={p.x}
                  y={p.y + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="rgb(var(--color-warning))"
                >
                  {p.score}
                </text>
              </g>
            )
          })}

          {/* подписи годов */}
          {haveData.map((r, i) => (
            <text
              key={`y-${r.year}`}
              x={xOf(r.year)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight={hoverIdx === i ? 700 : 400}
              fill={hoverIdx === i ? 'var(--chart-text)' : 'var(--chart-muted)'}
            >
              {r.year}
            </text>
          ))}

          {/* hover-зоны для надёжного попадания на точки */}
          {haveData.map((_, i) => {
            const x = xOf(haveData[i].year)
            const left =
              i === 0
                ? 0
                : (x + xOf(haveData[i - 1].year)) / 2
            const right =
              i === haveData.length - 1
                ? width
                : (x + xOf(haveData[i + 1].year)) / 2
            return (
              <rect
                key={`zone-${i}`}
                x={left}
                y={0}
                width={right - left}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            )
          })}
        </svg>
        {hov && hoverIdx !== null && (() => {
          const dProj = fmtDelta(hov.project_score, prev?.project_score ?? null)
          const dComp = fmtDelta(hov.company_score, prev?.company_score ?? null)
          return (
            <div
              className="pointer-events-none absolute z-10 rounded-lg bg-bg-elevated/95 p-3 text-xs shadow-lg ring-1 ring-white/10"
              style={{
                top: 8,
                left: tipLeft
                  ? undefined
                  : `calc(${(hovX / width) * 100}% + 12px)`,
                right: tipLeft
                  ? `calc(${((width - hovX) / width) * 100}% + 12px)`
                  : undefined,
                minWidth: 180,
              }}
            >
              <div className="mb-1 font-semibold text-slate-200">
                {hov.year}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="inline-block h-1.5 w-3 rounded bg-accent" />
                  проект
                </span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="font-semibold text-accent">
                    {hov.project_score ?? '—'}
                  </span>
                  {dProj && (
                    <span className={dProj.cls}>
                      ({dProj.sign}
                      {dProj.value})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-400">
                  <span className="inline-block h-1.5 w-3 rounded bg-amber-400" />
                  компания
                </span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="font-semibold text-amber-300">
                    {hov.company_score ?? '—'}
                  </span>
                  {dComp && (
                    <span className={dComp.cls}>
                      ({dComp.sign}
                      {dComp.value})
                    </span>
                  )}
                </span>
              </div>
              {prev && (
                <div className="mt-1 border-t border-white/10 pt-1 text-[10px] text-slate-500">
                  Δ к {prev.year}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
