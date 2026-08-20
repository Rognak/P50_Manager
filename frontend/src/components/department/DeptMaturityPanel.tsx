import { useEffect, useMemo, useState } from 'react'

import {
  DeptMaturityCellValue,
  DeptMaturityStatus,
  DeptMaturitySurvey,
  DeptMaturitySurveyListItem,
  DeptMaturityTemplate,
  api,
} from '../../api/client'

const STATUS_LABEL: Record<DeptMaturityStatus, string> = {
  draft: 'черновик',
  done: 'завершён',
}
const STATUS_CLR: Record<DeptMaturityStatus, string> = {
  draft: 'text-warning',
  done: 'text-success',
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

function ratingTone(r: number): string {
  if (r >= 70) return 'text-emerald-400'
  if (r >= 40) return 'text-accent'
  if (r >= 20) return 'text-amber-400'
  return 'text-rose-400'
}

// ---------- 3-state cell ----------

const CELL_BG: Record<DeptMaturityCellValue, string> = {
  yes: 'bg-emerald-500/25 text-emerald-200 ring-emerald-500/40',
  no: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
  na: 'bg-slate-500/10 text-slate-500 ring-white/5',
}

const CELL_LABEL: Record<DeptMaturityCellValue, string> = {
  yes: 'выполняет',
  no: 'не выполняет',
  na: 'не применимо',
}

function CriteriaCell({
  value,
  disabled,
  onChange,
}: {
  value: DeptMaturityCellValue
  disabled: boolean
  onChange: (v: DeptMaturityCellValue) => void
}) {
  const order: DeptMaturityCellValue[] = ['no', 'yes', 'na']
  const idx = order.indexOf(value)
  const next = order[(idx + 1) % order.length]
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(next)}
      title={
        disabled
          ? CELL_LABEL[value]
          : `${CELL_LABEL[value]} → клик: ${CELL_LABEL[next]}`
      }
      className={
        'inline-flex h-6 w-6 items-center justify-center rounded ring-1 transition ' +
        CELL_BG[value] +
        (disabled ? ' cursor-default opacity-70' : ' hover:scale-105')
      }
    >
      {value === 'yes' ? '✓' : value === 'no' ? '·' : '—'}
    </button>
  )
}

// ---------- Total rating chart ----------

function TotalChart({ surveys }: { surveys: DeptMaturitySurveyListItem[] }) {
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
  const xStep = innerW / (sorted.length - 1)
  const yOf = (r: number) => PAD_T + innerH - (r / 100) * innerH
  const path = sorted
    .map(
      (s, i) =>
        `${i === 0 ? 'M' : 'L'} ${PAD_L + i * xStep} ${yOf(s.total_rating)}`,
    )
    .join(' ')
  const hov = hoverIdx !== null ? sorted[hoverIdx] : null
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
          {sorted.map((_, i) => {
            const x = PAD_L + i * xStep
            const left = i === 0 ? 0 : x - xStep / 2
            const right = i === sorted.length - 1 ? W : x + xStep / 2
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
        {hov && hoverIdx !== null && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-bg-elevated/95 p-3 text-xs shadow-lg ring-1 ring-white/10"
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
            <div className="mb-1 font-semibold text-slate-200">{hov.period}</div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Рейтинг</span>
              <span className="font-mono font-semibold text-accent">
                {hov.total_rating.toFixed(1)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Уровень</span>
              <span className="font-mono font-semibold text-accent">
                L{hov.overall_level}
              </span>
            </div>
            {prev && (
              <div className="mt-1 border-t border-white/10 pt-1 text-slate-500">
                Δ к {prev.period}:{' '}
                <span
                  className={
                    hov.total_rating - prev.total_rating > 0
                      ? 'text-emerald-400'
                      : hov.total_rating - prev.total_rating < 0
                        ? 'text-rose-400'
                        : 'text-slate-500'
                  }
                >
                  {hov.total_rating - prev.total_rating > 0 ? '+' : ''}
                  {(hov.total_rating - prev.total_rating).toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Per-direction lines chart ----------

function DirectionsChart({
  surveys,
  template,
}: {
  surveys: DeptMaturitySurveyListItem[]
  template: DeptMaturityTemplate
}) {
  const [highlight, setHighlight] = useState<string | null>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  if (surveys.length < 2) return null
  const sorted = [...surveys].sort((a, b) => a.period.localeCompare(b.period))
  const codes = template.directions.map((d) => d.code)
  const nameByCode = Object.fromEntries(
    template.directions.map((d) => [d.code, d.name]),
  )
  const maxPerDir = 100 / codes.length

  const W = 720
  const H = 320
  const PAD_L = 40
  const PAD_R = 80
  const PAD_T = 16
  const PAD_B = 28
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B
  const xStep = innerW / (sorted.length - 1)
  const yOf = (r: number) => PAD_T + innerH - (r / maxPerDir) * innerH

  const lastValues = codes
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

  const tooltip =
    hoverIdx !== null
      ? (() => {
          const s = sorted[hoverIdx]
          const items = codes
            .map((dc, idx) => ({
              dc,
              name: nameByCode[dc],
              value: s.rating_by_direction[dc] ?? 0,
              color: DIR_COLORS[idx % DIR_COLORS.length],
            }))
            .sort((a, b) => b.value - a.value)
          const xPx = PAD_L + hoverIdx * xStep
          return { s, items, xPx, tipLeft: xPx > W / 2 }
        })()
      : null

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
          {hoverIdx !== null && (
            <line
              x1={PAD_L + hoverIdx * xStep}
              y1={PAD_T}
              x2={PAD_L + hoverIdx * xStep}
              y2={PAD_T + innerH}
              stroke="var(--chart-cursor)"
              strokeDasharray="3 3"
            />
          )}
          {codes.map((dc, idx) => {
            const color = DIR_COLORS[idx % DIR_COLORS.length]
            const faded = highlight !== null && highlight !== dc
            const dash = idx % 3 === 1 ? '5 3' : idx % 3 === 2 ? '2 3' : '0'
            const path = sorted
              .map(
                (s, i) =>
                  `${i === 0 ? 'M' : 'L'} ${PAD_L + i * xStep} ${yOf(s.rating_by_direction[dc] ?? 0)}`,
              )
              .join(' ')
            const lastV = sorted[sorted.length - 1].rating_by_direction[dc] ?? 0
            return (
              <g key={dc} opacity={faded ? 0.18 : 1}>
                <path
                  d={path}
                  stroke={color}
                  strokeWidth={highlight === dc ? 2.6 : 1.6}
                  strokeDasharray={dash}
                  fill="none"
                />
                {sorted.map((s, i) => {
                  const isHov = hoverIdx === i
                  return (
                    <circle
                      key={i}
                      cx={PAD_L + i * xStep}
                      cy={yOf(s.rating_by_direction[dc] ?? 0)}
                      r={isHov || highlight === dc ? 4 : 2.5}
                      fill={color}
                      stroke={isHov ? 'var(--chart-point-outline)' : 'none'}
                      strokeWidth={isHov ? 1.5 : 0}
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
                  {dc}
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
          {sorted.map((_, i) => {
            const x = PAD_L + i * xStep
            const left = i === 0 ? 0 : x - xStep / 2
            const right = i === sorted.length - 1 ? W : x + xStep / 2
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
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg bg-bg-elevated/95 p-3 text-xs shadow-lg ring-1 ring-white/10"
            style={{
              top: 8,
              left: tooltip.tipLeft
                ? undefined
                : `calc(${(tooltip.xPx / W) * 100}% + 12px)`,
              right: tooltip.tipLeft
                ? `calc(${((W - tooltip.xPx) / W) * 100}% + 12px)`
                : undefined,
              minWidth: 240,
            }}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="font-semibold text-slate-200">
                {tooltip.s.period}
              </span>
              <span className="text-slate-400">
                {tooltip.s.total_rating.toFixed(1)} · L
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
                    <span className="text-slate-500">{it.dc}</span>
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
        {codes.map((dc, idx) => {
          const color = DIR_COLORS[idx % DIR_COLORS.length]
          return (
            <button
              key={dc}
              onMouseEnter={() => setHighlight(dc)}
              onMouseLeave={() => setHighlight(null)}
              className={
                'flex items-center gap-1.5 rounded px-2 py-0.5 transition ' +
                (highlight === dc
                  ? 'bg-bg-panel ring-1 ring-white/10'
                  : 'text-slate-400 hover:text-slate-200')
              }
            >
              <span
                className="inline-block h-2 w-4 rounded"
                style={{ background: color }}
              />
              <span className="text-slate-500">{dc}</span>
              <span>{nameByCode[dc]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Radar chart (per-direction level) ----------

function RadarChart({
  perDirection,
  template,
  size = 260,
}: {
  perDirection: Record<string, { level: number; rating: number; name: string }>
  template: DeptMaturityTemplate
  size?: number
}) {
  const codes = template.directions.map((d) => d.code)
  const N = codes.length
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 28
  const maxLevel = 5
  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N
  const point = (i: number, lvl: number) => {
    const a = angleFor(i)
    const r = (Math.max(0, Math.min(maxLevel, lvl)) / maxLevel) * radius
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  }
  const polyPoints = codes
    .map((dc, i) => {
      const lvl = perDirection[dc]?.level ?? 0
      const [x, y] = point(i, lvl)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[1, 2, 3, 4, 5].map((lvl) => {
        const r = (lvl / maxLevel) * radius
        const ringPts = codes
          .map((_, i) => {
            const a = angleFor(i)
            return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
          })
          .join(' ')
        return (
          <g key={lvl}>
            <polygon
              points={ringPts}
              fill="none"
              stroke="var(--chart-grid)"
              strokeWidth={lvl === maxLevel ? 1.2 : 0.8}
            />
            <text x={cx + 3} y={cy - r + 10} fontSize="9" fill="var(--chart-cursor)">
              {lvl}
            </text>
          </g>
        )
      })}
      {codes.map((dc, i) => {
        const [xEnd, yEnd] = point(i, maxLevel)
        const a = angleFor(i)
        const r = radius + 16
        const lx = cx + r * Math.cos(a)
        const ly = cy + r * Math.sin(a)
        const anchor: 'start' | 'middle' | 'end' =
          Math.abs(Math.cos(a)) < 0.2
            ? 'middle'
            : Math.cos(a) > 0
              ? 'start'
              : 'end'
        return (
          <g key={dc}>
            <line
              x1={cx}
              y1={cy}
              x2={xEnd}
              y2={yEnd}
              stroke="var(--chart-grid)"
              strokeWidth="0.8"
            />
            <text
              x={lx}
              y={ly + 3}
              fontSize="11"
              fontWeight="600"
              textAnchor={anchor}
              fill="var(--chart-text)"
            >
              {dc}
            </text>
          </g>
        )
      })}
      <polygon
        points={polyPoints}
        fill="color-mix(in srgb, var(--chart-primary) 18%, transparent)"
        stroke="var(--chart-primary)"
        strokeWidth="1.8"
      />
      {codes.map((dc, i) => {
        const lvl = perDirection[dc]?.level ?? 0
        const [x, y] = point(i, lvl)
        return (
          <circle
            key={dc}
            cx={x}
            cy={y}
            r={3}
            fill="var(--chart-primary)"
            stroke="var(--chart-point-outline)"
            strokeWidth="0.8"
          >
            <title>
              {dc} · {perDirection[dc]?.name || ''} · уровень {lvl}
            </title>
          </circle>
        )
      })}
    </svg>
  )
}

// ---------- Survey editor ----------

function SurveyEditor({
  departmentId,
  surveyId,
  template,
  canEdit,
  onUpdated,
  onDeleted,
}: {
  departmentId: number
  surveyId: number
  template: DeptMaturityTemplate
  canEdit: boolean
  onUpdated: () => void
  onDeleted: () => void
}) {
  const [survey, setSurvey] = useState<DeptMaturitySurvey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openDir, setOpenDir] = useState<string | null>(null)
  const [openProc, setOpenProc] = useState<string | null>(null)

  const load = () => {
    api.departments.maturity
      .get(departmentId, surveyId)
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
  const readOnly = isDone || !canEdit
  const codes = template.directions.map((d) => d.code)
  const maxPerDir = 100 / codes.length

  const setCell = async (key: string, v: DeptMaturityCellValue) => {
    if (readOnly) return
    const next = { ...(survey.answers || {}), [key]: v }
    setSurvey({ ...survey, answers: next })
    try {
      const updated = await api.departments.maturity.update(
        departmentId,
        surveyId,
        { answers: { [key]: v } },
      )
      setSurvey(updated)
    } catch (e) {
      alert((e as Error).message)
      load()
    }
  }

  const setStatus = async (status: DeptMaturityStatus) => {
    setBusy(true)
    try {
      const updated = await api.departments.maturity.update(
        departmentId,
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
    if (!confirm(`Удалить опросник за ${survey.period}?`)) return
    try {
      await api.departments.maturity.delete(departmentId, surveyId)
      onDeleted()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  // прогресс по направлению — сколько критериев заполнено (yes+no+na vs пусто)
  const progressForDirection = (dcode: string) => {
    const dir = template.directions.find((d) => d.code === dcode)!
    let total = 0
    let done = 0
    for (const p of dir.processes) {
      for (const c of template.criteria) {
        total += 1
        const k = `${p.code}-${c.level}-${c.idx}`
        if (survey.answers[k]) done += 1
      }
    }
    return { total, done }
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
          · {formatDate(survey.created_at)}
          {survey.completed_at && (
            <>{' · завершён '}{formatDate(survey.completed_at)}</>
          )}
        </span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
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
          </div>
        )}
        {!canEdit && (
          <span className="ml-auto text-xs text-slate-500">
            только просмотр — вы не руководитель этого отдела
          </span>
        )}
      </div>

      {/* Сводка + лепестковая диаграмма */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
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
            Рейтинг по направлению = доля закрытых критериев × {maxPerDir.toFixed(1)}
            {' '}(каждое из {codes.length} направлений вносит до {maxPerDir.toFixed(1)} баллов).
            Уровень L0..L5 — самый высокий уровень, для которого закрыты все
            критерии направления.
          </div>
          <div className="space-y-1">
            {codes.map((dc) => {
              const m = survey.marks.by_direction[dc]
              if (!m) return null
              const pct = (m.rating / maxPerDir) * 100
              return (
                <div
                  key={dc}
                  className="flex items-center gap-3 text-xs"
                  title={`Рейтинг ${m.rating.toFixed(1)} из ${maxPerDir.toFixed(1)} (${Math.round(pct)}%). Уровень L${m.level} — все критерии этого уровня закрыты.`}
                >
                  <span className="w-44 text-slate-300">
                    <span className="text-slate-500">{dc}</span> {m.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-panel">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="w-20 text-right font-mono text-slate-400">
                    {m.rating.toFixed(1)}{' '}
                    <span className="text-slate-600">/ {maxPerDir.toFixed(1)}</span>
                  </span>
                  <span className="w-12 text-right text-slate-500">L{m.level}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5">
          <div className="mb-1 text-center text-xs font-semibold text-slate-300">
            Профиль зрелости (уровень по направлениям)
          </div>
          <RadarChart
            perDirection={survey.marks.by_direction}
            template={template}
          />
        </div>
      </div>

      {/* Опросник: направления → процессы → 5-уровневая таблица */}
      <div className="space-y-2">
        {template.directions.map((dir) => {
          const open = openDir === dir.code
          const m = survey.marks.by_direction[dir.code]
          const prog = progressForDirection(dir.code)
          return (
            <div
              key={dir.code}
              className="overflow-hidden rounded-lg bg-bg-panel/30 ring-1 ring-white/5"
            >
              <button
                onClick={() => {
                  setOpenDir(open ? null : dir.code)
                  setOpenProc(null)
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-panel/60"
              >
                <span className="text-xs text-slate-500">{open ? '▼' : '▶'}</span>
                <span className="text-sm font-semibold text-slate-200">
                  <span className="text-slate-500">{dir.code}</span>{' '}
                  {dir.name}
                </span>
                <span className="text-xs text-slate-500">
                  · {dir.processes.length} процесс
                  {dir.processes.length === 1
                    ? ''
                    : dir.processes.length < 5
                      ? 'а'
                      : 'ов'}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {prog.done} / {prog.total}
                </span>
                {m && (
                  <span
                    className={'text-xs font-mono ' + ratingTone(m.rating * codes.length)}
                    title={`Рейтинг ${m.rating.toFixed(1)} из ${maxPerDir.toFixed(1)} · уровень L${m.level}`}
                  >
                    {m.rating.toFixed(1)}
                    <span className="text-slate-600"> / {maxPerDir.toFixed(1)}</span>
                    {' · '}L{m.level}
                  </span>
                )}
              </button>
              {open && (
                <div className="border-t border-white/5 bg-bg-elevated">
                  {dir.processes.map((proc) => {
                    const procOpen = openProc === proc.code
                    return (
                      <div
                        key={proc.code}
                        className="border-b border-white/5 last:border-0"
                      >
                        <button
                          onClick={() =>
                            setOpenProc(procOpen ? null : proc.code)
                          }
                          className="flex w-full items-center gap-3 px-6 py-2.5 text-left hover:bg-bg-panel/40"
                        >
                          <span className="text-xs text-slate-500">
                            {procOpen ? '▼' : '▶'}
                          </span>
                          <span className="text-sm text-slate-300">
                            {proc.name}
                          </span>
                          <span className="ml-auto flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((lvl) => {
                              const lvlCriteria = template.criteria.filter(
                                (c) => c.level === lvl,
                              )
                              const allYes = lvlCriteria.every(
                                (c) =>
                                  survey.answers[
                                    `${proc.code}-${lvl}-${c.idx}`
                                  ] === 'yes',
                              )
                              const anyYes = lvlCriteria.some(
                                (c) =>
                                  survey.answers[
                                    `${proc.code}-${lvl}-${c.idx}`
                                  ] === 'yes',
                              )
                              const tone = allYes
                                ? 'bg-emerald-500/40'
                                : anyYes
                                  ? 'bg-amber-500/40'
                                  : 'bg-slate-500/15'
                              return (
                                <span
                                  key={lvl}
                                  className={`inline-block h-2 w-3 rounded ${tone}`}
                                  title={`L${lvl}`}
                                />
                              )
                            })}
                          </span>
                        </button>
                        {procOpen && (
                          <div className="overflow-hidden bg-bg-panel/20">
                            <table className="w-full text-sm">
                              <thead className="text-slate-500">
                                <tr>
                                  <th className="w-14 px-3 py-2 text-center text-xs">
                                    Ур.
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs">
                                    Что оцениваем
                                  </th>
                                  <th className="px-3 py-2 text-left text-xs">
                                    Как проверяем
                                  </th>
                                  <th className="w-24 px-3 py-2 text-center text-xs">
                                    Ответ
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {template.criteria.map((c) => {
                                  const k = `${proc.code}-${c.level}-${c.idx}`
                                  const v = (survey.answers[k] ||
                                    'no') as DeptMaturityCellValue
                                  return (
                                    <tr
                                      key={k}
                                      className="border-t border-white/5"
                                    >
                                      <td className="px-3 py-2 text-center">
                                        <span
                                          className="inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold text-bg"
                                          style={{
                                            background:
                                              c.level === 1
                                                ? 'var(--maturity-level-1)'
                                                : c.level === 2
                                                  ? 'var(--maturity-level-2)'
                                                  : c.level === 3
                                                    ? 'var(--maturity-level-3)'
                                                    : c.level === 4
                                                      ? 'var(--maturity-level-4)'
                                                      : 'var(--maturity-level-5)',
                                          }}
                                        >
                                          {c.level}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-slate-200">
                                        {c.what}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-slate-400">
                                        {c.how || '—'}
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        <CriteriaCell
                                          value={v}
                                          disabled={readOnly}
                                          onChange={(nv) => setCell(k, nv)}
                                        />
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-xs text-slate-500">
        Уровни зрелости: L1 — начальный, L2 — базовый, L3 — развитый, L4 —
        системный, L5 — активный. По каждому процессу заполняются 6 критериев
        в 5 уровнях. Клик по ячейке циклически переключает «не выполняет → выполняет
        → не применимо». Рейтинг направления = сумма долей «выполняет» по уровням
        до первого ≤ 0.8 включительно × (100/35).
      </div>
    </div>
  )
}

// ---------- Main panel ----------

export function DeptMaturityPanel({
  departmentId,
  canEdit = true,
}: {
  departmentId: number
  canEdit?: boolean
}) {
  const [template, setTemplate] = useState<DeptMaturityTemplate | null>(null)
  const [surveys, setSurveys] = useState<DeptMaturitySurveyListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    try {
      const list = await api.departments.maturity.list(departmentId)
      setSurveys(list)
      if (openId === null && list.length > 0) setOpenId(list[0].id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    api.departments.maturity
      .template(departmentId)
      .then(setTemplate)
      .catch((e) => setError((e as Error).message))
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId])

  const newPeriod = useMemo(() => {
    const cur = currentPeriod()
    const taken = new Set(surveys.map((s) => s.period))
    if (!taken.has(cur)) return cur
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
      const s = await api.departments.maturity.create(departmentId, newPeriod)
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

  const totalProcesses = template.directions.reduce(
    (s, d) => s + d.processes.length,
    0,
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="text-sm text-slate-500">
          Опросник техзрелости отдела: 7 направлений × {totalProcesses} процессов,
          для каждого — 6 критериев в 5 уровнях. Шаблон v{template.version}.
        </div>
        {canEdit ? (
          <button
            onClick={create}
            disabled={creating}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {creating ? '…' : `+ опросник на ${newPeriod}`}
          </button>
        ) : (
          <span className="text-xs text-slate-500">
            режим просмотра — заполнять может только руководитель отдела
          </span>
        )}
      </div>

      {surveys.length >= 2 && (
        <>
          <TotalChart surveys={surveys} />
          <DirectionsChart surveys={surveys} template={template} />
        </>
      )}

      {surveys.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Опросник техзрелости отдела ещё не создан.
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
          departmentId={departmentId}
          surveyId={openId}
          template={template}
          canEdit={canEdit}
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
