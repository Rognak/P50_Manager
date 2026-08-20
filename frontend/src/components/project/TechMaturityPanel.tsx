import { useEffect, useMemo, useState } from 'react'

import {
  TechMaturityStatus,
  TechMaturitySurvey,
  TechMaturitySurveyListItem,
  TechMaturityTemplate,
  api,
} from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'

const STATUS_LABEL: Record<TechMaturityStatus, string> = {
  draft: 'черновик',
  done: 'завершён',
}

const STATUS_CLR: Record<TechMaturityStatus, string> = {
  draft: 'text-amber-400',
  done: 'text-emerald-400',
}

function currentPeriod(): string {
  const d = new Date()
  const q = Math.floor(d.getMonth() / 3) + 1
  return `${d.getFullYear()}-Q${q}`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function ratingTone(rating: number): string {
  // total_rating ∈ [0..100]
  if (rating >= 70) return 'text-success'
  if (rating >= 40) return 'text-ink'
  if (rating >= 20) return 'text-warning'
  return 'text-danger'
}

const DIR_COLORS = [
  'var(--chart-primary)',
  'var(--data-1)',
  'var(--data-2)',
  'var(--data-3)',
  'var(--data-4)',
  'var(--data-5)',
  'var(--data-6)',
]

// Динамика общего рейтинга по периодам с hover-tooltip
function TotalRatingChart({
  surveys,
}: {
  surveys: TechMaturitySurveyListItem[]
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  if (surveys.length < 2) return null
  const sorted = [...surveys].sort((a, b) => a.period.localeCompare(b.period))
  const W = 720
  const H = 200
  const PAD_L = 40
  const PAD_R = 20
  const PAD_T = 16
  const PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const xStep = sorted.length > 1 ? innerW / (sorted.length - 1) : 0
  const yOf = (r: number) => PAD_T + innerH - (r / 100) * innerH
  const path = sorted
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${PAD_L + i * xStep} ${yOf(s.total_rating)}`)
    .join(' ')

  const hovered = hoverIdx !== null ? sorted[hoverIdx] : null
  const prev = hoverIdx !== null && hoverIdx > 0 ? sorted[hoverIdx - 1] : null
  const tipLeft = hoverIdx !== null && PAD_L + hoverIdx * xStep > W / 2

  return (
    <div className="rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="mb-2 text-xs font-semibold text-slate-300">
        Динамика общего рейтинга (0–100)
      </div>
      <div className="relative">
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {[0, 25, 50, 75, 100].map((y) => (
            <g key={y}>
              <line
                x1={PAD_L}
                y1={yOf(y)}
                x2={W - PAD_R}
                y2={yOf(y)}
                stroke="var(--chart-grid)"
                strokeDasharray={y === 0 || y === 100 ? '0' : '2 3'}
                strokeWidth="1"
              />
              <text
                x={PAD_L - 6}
                y={yOf(y) + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--chart-muted)"
              >
                {y}
              </text>
            </g>
          ))}
          {hoverIdx !== null && (
            <line
              x1={PAD_L + hoverIdx * xStep}
              y1={PAD_T}
              x2={PAD_L + hoverIdx * xStep}
              y2={PAD_T + innerH}
              stroke="var(--chart-cursor)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          <path d={path} stroke="var(--chart-primary)" strokeWidth="2.5" fill="none" />
          {sorted.map((s, i) => {
            const x = PAD_L + i * xStep
            const isHov = hoverIdx === i
            return (
              <g key={s.id}>
                <circle
                  cx={x}
                  cy={yOf(s.total_rating)}
                  r={isHov ? 5 : 4}
                  fill="var(--chart-primary)"
                  stroke={isHov ? 'var(--chart-point-outline)' : 'none'}
                  strokeWidth={isHov ? 1.5 : 0}
                />
                <text
                  x={x}
                  y={yOf(s.total_rating) - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="var(--chart-primary)"
                >
                  {s.total_rating.toFixed(0)}
                </text>
                <text
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isHov ? 700 : 400}
                  fill={isHov ? 'var(--chart-text)' : 'var(--chart-muted)'}
                >
                  {s.period}
                </text>
              </g>
            )
          })}
          {/* Невидимые hover-зоны: каждая точка владеет колонкой шириной xStep,
              крайние расширены до края SVG. Поверх линий и точек, чтобы ловить hover. */}
          {sorted.map((_, i) => {
            const x = PAD_L + i * xStep
            const left = i === 0 ? 0 : x - xStep / 2
            const right =
              i === sorted.length - 1 ? W : x + xStep / 2
            return (
              <rect
                key={`zone-${i}`}
                x={left}
                y={0}
                width={right - left}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            )
          })}
        </svg>
        {hovered && hoverIdx !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-bg-elevated/95 p-3 text-xs shadow-lg ring-1 ring-white/10 backdrop-blur"
            style={{
              top: 8,
              left: tipLeft
                ? undefined
                : `calc(${((PAD_L + hoverIdx * xStep) / W) * 100}% + 12px)`,
              right: tipLeft
                ? `calc(${((W - PAD_L - hoverIdx * xStep) / W) * 100}% + 12px)`
                : undefined,
              minWidth: 180,
            }}
          >
            <div className="mb-1 font-semibold text-slate-200">
              {hovered.period}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Рейтинг</span>
              <span className="font-mono font-semibold text-accent">
                {hovered.total_rating.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Уровень</span>
              <span className="font-mono font-semibold text-accent">
                L{hovered.overall_level}
              </span>
            </div>
            {prev && (
              <div className="mt-1 border-t border-white/10 pt-1 text-slate-500">
                Δ к {prev.period}:{' '}
                <span
                  className={
                    hovered.total_rating - prev.total_rating > 0
                      ? 'text-emerald-400'
                      : hovered.total_rating - prev.total_rating < 0
                        ? 'text-rose-400'
                        : 'text-slate-500'
                  }
                >
                  {hovered.total_rating - prev.total_rating > 0 ? '+' : ''}
                  {(hovered.total_rating - prev.total_rating).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Multi-line chart рейтингов по направлениям + interactive hover
function DirectionsChart({
  surveys,
  directionNames,
}: {
  surveys: TechMaturitySurveyListItem[]
  directionNames: Record<string, string>
}) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  if (surveys.length < 2) return null
  const sorted = [...surveys].sort((a, b) => a.period.localeCompare(b.period))
  const directionCodes = Object.keys(directionNames)
  const maxPerDir = 100 / directionCodes.length // ≈14.29

  const W = 720
  const H = 320
  const PAD_L = 40
  const PAD_R = 60
  const PAD_T = 16
  const PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const xStep = innerW / (sorted.length - 1)
  const yOf = (r: number) => PAD_T + innerH - (r / maxPerDir) * innerH

  // Лейблы D1..D7 справа без перекрытий
  const lastValues = directionCodes
    .map((dc) => ({
      dc,
      v: sorted[sorted.length - 1].rating_by_direction[dc] ?? 0,
    }))
    .sort((a, b) => b.v - a.v)
  const labelY: Record<string, number> = {}
  let prevY = -Infinity
  for (const { dc, v } of lastValues) {
    let y = yOf(v)
    if (y - prevY < 14) y = prevY + 14
    labelY[dc] = y
    prevY = y
  }

  // Тултип для текущего hover
  const tooltip = hoverIdx !== null ? (() => {
    const s = sorted[hoverIdx]
    const items = directionCodes
      .map((dc, idx) => ({
        dc,
        name: directionNames[dc],
        value: s.rating_by_direction[dc] ?? 0,
        color: DIR_COLORS[idx % DIR_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value)
    const xPx = PAD_L + hoverIdx * xStep
    // позиционируем тултип слева или справа от линии
    const tipLeft = xPx > W / 2
    return { s, items, xPx, tipLeft }
  })() : null

  return (
    <div className="rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="mb-2 text-xs font-semibold text-slate-300">
        Динамика по направлениям (0–{maxPerDir.toFixed(1)} максимум)
      </div>
      <div className="relative">
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Y grid + ticks */}
          {[0, maxPerDir / 2, maxPerDir].map((y) => (
            <g key={y}>
              <line
                x1={PAD_L}
                y1={yOf(y)}
                x2={W - PAD_R}
                y2={yOf(y)}
                stroke="var(--chart-grid)"
                strokeDasharray={y === 0 || y === maxPerDir ? '0' : '2 3'}
              />
              <text
                x={PAD_L - 6}
                y={yOf(y) + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--chart-muted)"
              >
                {y.toFixed(1)}
              </text>
            </g>
          ))}

          {/* Hover guide line */}
          {hoverIdx !== null && (
            <line
              x1={PAD_L + hoverIdx * xStep}
              y1={PAD_T}
              x2={PAD_L + hoverIdx * xStep}
              y2={PAD_T + innerH}
              stroke="var(--chart-cursor)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {directionCodes.map((dc, idx) => {
            const color = DIR_COLORS[idx % DIR_COLORS.length]
            const isFaded = highlight !== null && highlight !== dc
            const dash = idx % 3 === 1 ? '5 3' : idx % 3 === 2 ? '2 3' : '0'
            const path = sorted
              .map((s, i) => {
                const r = s.rating_by_direction[dc] ?? 0
                return `${i === 0 ? 'M' : 'L'} ${PAD_L + i * xStep} ${yOf(r)}`
              })
              .join(' ')
            const lastV = sorted[sorted.length - 1].rating_by_direction[dc] ?? 0
            return (
              <g
                key={dc}
                opacity={isFaded ? 0.18 : 1}
                style={{ transition: 'opacity 0.15s' }}
              >
                <path
                  d={path}
                  stroke={color}
                  strokeWidth={highlight === dc ? 2.6 : 1.6}
                  strokeDasharray={dash}
                  fill="none"
                />
                {sorted.map((s, i) => {
                  const isHovered = hoverIdx === i
                  return (
                    <circle
                      key={i}
                      cx={PAD_L + i * xStep}
                      cy={yOf(s.rating_by_direction[dc] ?? 0)}
                      r={isHovered || highlight === dc ? 4 : 2.5}
                      fill={color}
                      stroke={isHovered ? 'var(--chart-point-outline)' : 'none'}
                      strokeWidth={isHovered ? 1.5 : 0}
                    />
                  )
                })}
                <line
                  x1={PAD_L + (sorted.length - 1) * xStep + 2}
                  y1={yOf(lastV)}
                  x2={W - PAD_R + 2}
                  y2={labelY[dc]}
                  stroke={color}
                  strokeWidth="1"
                  opacity="0.5"
                />
                <text
                  x={W - PAD_R + 4}
                  y={labelY[dc] + 3}
                  fontSize="11"
                  fontWeight="600"
                  fill={color}
                >
                  D{dc}
                </text>
              </g>
            )
          })}

          {sorted.map((s, i) => (
            <text
              key={i}
              x={PAD_L + i * xStep}
              y={H - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight={hoverIdx === i ? 700 : 400}
              fill={hoverIdx === i ? 'var(--chart-text)' : 'var(--chart-muted)'}
            >
              {s.period}
            </text>
          ))}

          {/* Hover-зоны поверх всего */}
          {sorted.map((_, i) => {
            const x = PAD_L + i * xStep
            const left = i === 0 ? 0 : x - xStep / 2
            const right =
              i === sorted.length - 1 ? W : x + xStep / 2
            return (
              <rect
                key={`zone-${i}`}
                x={left}
                y={0}
                width={right - left}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            )
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-bg-elevated/95 p-3 text-xs shadow-lg ring-1 ring-white/10 backdrop-blur"
            style={{
              top: 8,
              left: tooltip.tipLeft
                ? undefined
                : `calc(${(tooltip.xPx / W) * 100}% + 12px)`,
              right: tooltip.tipLeft
                ? `calc(${((W - tooltip.xPx) / W) * 100}% + 12px)`
                : undefined,
              minWidth: 220,
            }}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="font-semibold text-slate-200">
                {tooltip.s.period}
              </span>
              <span className="text-slate-400">
                итого {tooltip.s.total_rating.toFixed(1)} · L
                {tooltip.s.overall_level}
              </span>
            </div>
            <div className="space-y-0.5">
              {tooltip.items.map((it) => (
                <div
                  key={it.dc}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span
                      className="inline-block h-2 w-3 rounded"
                      style={{ background: it.color }}
                    />
                    <span className="text-slate-500">D{it.dc}</span>
                    <span>{it.name}</span>
                  </span>
                  <span
                    className="font-mono font-semibold"
                    style={{ color: it.color }}
                  >
                    {it.value.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
        {directionCodes.map((dc, idx) => {
          const color = DIR_COLORS[idx % DIR_COLORS.length]
          const isActive = highlight === dc
          return (
            <button
              key={dc}
              onMouseEnter={() => setHighlight(dc)}
              onMouseLeave={() => setHighlight(null)}
              className={
                'flex items-center gap-1.5 rounded px-2 py-0.5 transition ' +
                (isActive
                  ? 'bg-bg-panel ring-1 ring-white/10'
                  : 'text-slate-400 hover:text-slate-200')
              }
            >
              <span
                className="inline-block h-2 w-4 rounded"
                style={{ background: color }}
              />
              <span className="text-slate-500">D{dc}</span>
              <span>{directionNames[dc]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Сводка с дельтой от прошлого периода
function DynamicsSummary({
  surveys,
}: {
  surveys: TechMaturitySurveyListItem[]
}) {
  if (surveys.length < 2) return null
  // sorted descending by period, latest first
  const sorted = [...surveys].sort((a, b) => b.period.localeCompare(a.period))
  const cur = sorted[0]
  const prev = sorted[1]
  const dRating = cur.total_rating - prev.total_rating
  const dLevel = cur.overall_level - prev.overall_level

  const renderDelta = (d: number, decimals = 1) => {
    if (Math.abs(d) < 0.05) {
      return <span className="text-slate-500">±0</span>
    }
    const sign = d > 0 ? '+' : ''
    const cls = d > 0 ? 'text-emerald-400' : 'text-rose-400'
    return (
      <span className={cls}>
        {sign}
        {decimals > 0 ? d.toFixed(decimals) : d.toFixed(0)}
      </span>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className="rounded-2xl bg-bg-elevated p-4">
        <div className="text-xs text-slate-400">Текущий рейтинг ({cur.period})</div>
        <div className={`mt-1 text-2xl font-semibold ${ratingTone(cur.total_rating)}`}>
          {cur.total_rating.toFixed(1)}
        </div>
      </div>
      <div className="rounded-2xl bg-bg-elevated p-4">
        <div className="text-xs text-slate-400">Δ к {prev.period}</div>
        <div className="mt-1 text-2xl font-semibold">
          {renderDelta(dRating, 1)}
        </div>
      </div>
      <div className="rounded-2xl bg-bg-elevated p-4">
        <div className="text-xs text-slate-400">Уровень</div>
        <div className="mt-1 text-2xl font-semibold text-accent">
          L{cur.overall_level}
        </div>
        <div className="text-xs text-slate-500">
          было L{prev.overall_level} {renderDelta(dLevel, 0)}
        </div>
      </div>
      <div className="rounded-2xl bg-bg-elevated p-4">
        <div className="text-xs text-slate-400">Замеров в истории</div>
        <div className="mt-1 text-2xl font-semibold text-slate-300">
          {surveys.length}
        </div>
      </div>
    </div>
  )
}

function ParamRow({
  paramCode,
  paramName,
  criteria,
  value,
  disabled,
  onToggle,
}: {
  paramCode: string
  paramName: string
  criteria: string
  value: boolean
  disabled: boolean
  onToggle: (v: boolean) => void
}) {
  return (
    <label
      className={
        'flex items-start gap-3 rounded px-3 py-2 text-sm hover:bg-bg-panel/60 ' +
        (disabled ? 'cursor-default opacity-70' : 'cursor-pointer')
      }
    >
      <input
        type="checkbox"
        disabled={disabled}
        checked={value}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 accent-accent"
      />
      <div className="flex-1">
        <div className="text-slate-200">{paramName}</div>
        <div className="text-[11px] text-slate-500">
          <span className="text-slate-600">{paramCode} · </span>
          {criteria}
        </div>
      </div>
    </label>
  )
}

function SurveyEditor({
  productId,
  surveyId,
  template,
  onUpdated,
  onDeleted,
}: {
  productId: number
  surveyId: number
  template: TechMaturityTemplate
  onUpdated: () => void
  onDeleted: () => void
}) {
  const readOnly = useReadOnly()
  const [survey, setSurvey] = useState<TechMaturitySurvey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.products.techMaturity
      .get(productId, surveyId)
      .then(setSurvey)
      .catch((e) => setError((e as Error).message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyId])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!survey) return <div className="text-slate-500">Загрузка…</div>

  const isDone = survey.status === 'done'
  const formDisabled = isDone || readOnly
  const totalParams = template.data.length
  const filled = Object.values(survey.answers || {}).filter((v) => {
    if (typeof v === 'boolean') return v
    return Number(v) > 0
  }).length

  // group: directionCode -> processCode -> level -> items
  const tree: Record<
    string,
    Record<string, Record<string, typeof template.data>>
  > = {}
  for (const item of template.data) {
    const dt = (tree[item.directionCode] ??= {})
    const pt = (dt[item.processCode] ??= {})
    const lt = (pt[item.level] ??= [] as typeof template.data)
    lt.push(item)
  }

  const toggleParam = async (paramCode: string, v: boolean) => {
    if (formDisabled) return
    const next = { ...(survey.answers || {}), [paramCode]: v ? 1 : 0 }
    setSurvey({ ...survey, answers: next })
    try {
      const updated = await api.products.techMaturity.update(
        productId,
        surveyId,
        { answers: { [paramCode]: v ? 1 : 0 } },
      )
      setSurvey(updated)
    } catch (e) {
      alert((e as Error).message)
      load()
    }
  }

  const setStatus = async (status: TechMaturityStatus) => {
    setBusy(true)
    try {
      const updated = await api.products.techMaturity.update(
        productId,
        surveyId,
        { status },
      )
      setSurvey(updated)
      onUpdated()
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Удалить опросник за ${survey.period}? Ответы пропадут.`)) return
    try {
      await api.products.techMaturity.delete(productId, surveyId)
      onDeleted()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const toggleDir = (dc: string) => {
    setOpenDirs((s) => {
      const next = new Set(s)
      if (next.has(dc)) next.delete(dc)
      else next.add(dc)
      return next
    })
  }

  return (
    <div className="space-y-4 rounded-2xl bg-bg-elevated p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-lg font-semibold">{survey.period}</div>
        <span className={`text-xs ${STATUS_CLR[survey.status]}`}>
          {STATUS_LABEL[survey.status]}
        </span>
        <span className="text-xs text-slate-500">
          заполнил{' '}
          <span className="text-slate-300">
            {survey.created_by_name || '—'}
          </span>{' '}
          ·{' '}
          {new Date(survey.created_at).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })}
          {survey.completed_at && (
            <>
              {' · завершён '}
              {new Date(survey.completed_at).toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </>
          )}
        </span>
        <div className="ml-auto text-xs text-slate-500">
          заполнено: {filled} / {totalParams}
        </div>
        {!readOnly && (
          <>
            {isDone ? (
              <button
                disabled={busy}
                onClick={() => setStatus('draft')}
                className="rounded px-3 py-1 text-xs text-slate-500 hover:text-amber-400"
              >
                переоткрыть
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => setStatus('done')}
                className="rounded bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
              >
                Завершить
              </button>
            )}
            <button
              onClick={remove}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              удалить
            </button>
          </>
        )}
      </div>

      {/* Сводка рейтинга */}
      <div className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5">
        <div className="mb-2 flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Рейтинг
          </span>
          <span
            className={`text-2xl font-semibold ${ratingTone(survey.marks.total_rating)}`}
          >
            {survey.marks.total_rating}
          </span>
          <span className="text-xs text-slate-400">из 100</span>
          <span className="ml-auto text-xs text-slate-400">
            уровень зрелости:{' '}
            <span className="text-accent">{survey.marks.overall_level}</span> / 5
          </span>
        </div>
        <div className="mb-2 text-[11px] leading-snug text-slate-500">
          Рейтинг по направлению = доля закрытых критериев × {(100 / 7).toFixed(1)}
          {' '}(каждое из 7 направлений вносит до {(100 / 7).toFixed(1)} баллов).
          Уровень L0..L5 — самый высокий уровень, для которого закрыты все
          критерии направления.
        </div>
        <div className="space-y-1">
          {Object.entries(survey.marks.by_direction).map(([dc, d]) => {
            const maxPer = 100 / 7
            const pctOfMax = (d.rating / maxPer) * 100
            return (
              <div
                key={dc}
                className="flex items-center gap-3 text-xs"
                title={`Рейтинг ${d.rating.toFixed(1)} из ${maxPer.toFixed(1)} (${Math.round(pctOfMax)}%). Уровень L${d.level} — все критерии этого уровня закрыты.`}
              >
                <span className="w-44 text-slate-300">{d.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-panel">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${Math.min(100, pctOfMax)}%` }}
                  />
                </div>
                <span className="w-20 text-right font-mono text-slate-400">
                  {d.rating.toFixed(1)}{' '}
                  <span className="text-slate-600">/ {maxPer.toFixed(1)}</span>
                </span>
                <span className="w-12 text-right text-slate-500">L{d.level}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Опросник по направлениям */}
      <div className="space-y-2">
        {Object.entries(template.direction).map(([dcode, dname]) => {
          const isOpen = openDirs.has(dcode)
          const m = survey.marks.by_direction[dcode]
          const dProcesses = tree[dcode] || {}
          return (
            <div
              key={dcode}
              className="rounded-lg bg-bg-panel/30 ring-1 ring-white/5"
            >
              <button
                onClick={() => toggleDir(dcode)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-bg-panel/40"
              >
                <span className="text-xs text-slate-500">
                  {isOpen ? '▼' : '▶'}
                </span>
                <span className="font-medium text-slate-200">{dname}</span>
                {m && (
                  <span
                    className="ml-auto text-xs text-slate-400 font-mono"
                    title={`Рейтинг ${m.rating.toFixed(1)} из ${(100 / 7).toFixed(1)} · уровень L${m.level}`}
                  >
                    L{m.level} · {m.rating.toFixed(1)}
                    <span className="text-slate-600"> / {(100 / 7).toFixed(1)}</span>
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="border-t border-white/5 px-4 py-3 space-y-4">
                  {Object.entries(dProcesses).map(([pcode, levels]) => {
                    const proc = template.process[pcode]
                    return (
                      <div key={pcode}>
                        <div className="mb-1 text-sm font-semibold text-slate-300">
                          [{pcode}] {proc?.title}
                        </div>
                        {template.levels.map((lvlLabel) => {
                          const items = levels[lvlLabel] || []
                          if (items.length === 0) return null
                          return (
                            <div key={lvlLabel} className="mt-1">
                              <div className="my-1 text-[11px] uppercase tracking-wide text-slate-500">
                                {lvlLabel}
                              </div>
                              <div className="space-y-0.5">
                                {items.map((it) => (
                                  <ParamRow
                                    key={it.paramCode}
                                    paramCode={it.paramCode}
                                    paramName={it.paramName}
                                    criteria={it.criteria}
                                    value={
                                      Number(survey.answers?.[it.paramCode] || 0) >
                                      0
                                    }
                                    disabled={formDisabled}
                                    onToggle={(v) => toggleParam(it.paramCode, v)}
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TechMaturityPanel({ productId }: { productId: number }) {
  const readOnly = useReadOnly()
  const [template, setTemplate] = useState<TechMaturityTemplate | null>(null)
  const [surveys, setSurveys] = useState<TechMaturitySurveyListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    try {
      const list = await api.products.techMaturity.list(productId)
      setSurveys(list)
      if (openId === null && list.length > 0) setOpenId(list[0].id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    api.products.techMaturity
      .template(productId)
      .then(setTemplate)
      .catch((e) => setError((e as Error).message))
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  const newPeriod = useMemo(() => {
    const cur = currentPeriod()
    const taken = new Set(surveys.map((s) => s.period))
    if (!taken.has(cur)) return cur
    // если текущий уже есть — следующий квартал
    const m = cur.match(/^(\d+)-Q(\d)$/)
    if (m) {
      let y = Number(m[1])
      let q = Number(m[2]) + 1
      if (q > 4) {
        q = 1
        y += 1
      }
      return `${y}-Q${q}`
    }
    return cur
  }, [surveys])

  const create = async () => {
    setCreating(true)
    try {
      const s = await api.products.techMaturity.create(productId, newPeriod)
      await refresh()
      setOpenId(s.id)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!template) return <div className="text-slate-500">Загрузка шаблона…</div>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-sm text-slate-500">
          Квартальный опросник: 25 процессов в 7 направлениях, ~324 пункта.
          Чем больше выполненных пунктов в нижних уровнях — тем выше рейтинг.
          Шаблон v{template.version}.
        </div>
        {!readOnly && (
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {creating ? '…' : `+ опросник на ${newPeriod}`}
          </button>
        )}
      </div>

      {surveys.length >= 2 && (
        <>
          <DynamicsSummary surveys={surveys} />
          <TotalRatingChart surveys={surveys} />
          <DirectionsChart
            surveys={surveys}
            directionNames={template.direction}
          />
        </>
      )}

      {surveys.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Опросник техзрелости ещё не создан. Запланируйте на текущий квартал.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">Период</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Рейтинг</th>
                <th className="px-4 py-3">Уровень</th>
                <th className="px-4 py-3">Заполнил</th>
                <th className="px-4 py-3">Завершён</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {surveys.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                >
                  <td className="px-4 py-3 font-medium">{s.period}</td>
                  <td className={`px-4 py-3 text-xs ${STATUS_CLR[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </td>
                  <td className={`px-4 py-3 ${ratingTone(s.total_rating)}`}>
                    {s.total_rating}
                  </td>
                  <td className="px-4 py-3 text-slate-300">L{s.overall_level}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {s.created_by_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDate(s.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">
                    {openId === s.id ? '▾' : '▸'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId !== null && (
        <SurveyEditor
          productId={productId}
          surveyId={openId}
          template={template}
          onUpdated={refresh}
          onDeleted={() => {
            setOpenId(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
