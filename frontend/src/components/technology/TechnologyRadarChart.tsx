import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { TechnologyCategory, TechnologyListItem, TechnologyStatus } from '../../api/client'
import { TechnologyIcon } from './TechnologyIcon'

const STATUS_LABEL: Record<TechnologyStatus, string> = {
  adopt: 'Adopt', trial: 'Trial', assess: 'Assess', hold: 'Hold',
}
const STATUS_COLOR: Record<TechnologyStatus, string> = {
  adopt: 'var(--status-adopt)', trial: 'var(--status-trial)', assess: 'var(--status-assess)', hold: 'var(--status-hold)',
}
const RINGS: TechnologyStatus[] = ['adopt', 'trial', 'assess', 'hold']
const CENTER = 300
const OUTER = 260

function polar(radius: number, angle: number) {
  const radians = (angle - 90) * Math.PI / 180
  return { x: CENTER + radius * Math.cos(radians), y: CENTER + radius * Math.sin(radians) }
}

function sectorPath(start: number, end: number, radius: number) {
  const a = polar(radius, start)
  const b = polar(radius, end)
  return `M ${CENTER} ${CENTER} L ${a.x} ${a.y} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b.x} ${b.y} Z`
}

function positions(items: TechnologyListItem[], categories: TechnologyCategory[]) {
  const output = new Map<number, { x: number; y: number }>()
  const sectorSize = 360 / Math.max(categories.length, 1)
  categories.forEach((category, sectorIndex) => {
    RINGS.forEach((status, ringIndex) => {
      const group = items
        .filter((item) => item.category.id === category.id && item.status === status)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id - b.id)
      const columns = Math.max(1, Math.ceil(Math.sqrt(group.length)))
      const rows = Math.max(1, Math.ceil(group.length / columns))
      group.forEach((item, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const angleStart = sectorIndex * sectorSize + 8
        const angleSpan = Math.max(2, sectorSize - 16)
        const angle = angleStart + angleSpan * ((column + 0.5) / columns)
        const inner = ringIndex * (OUTER / 4) + 13
        const outer = (ringIndex + 1) * (OUTER / 4) - 13
        const radius = inner + (outer - inner) * ((row + 0.5) / rows)
        output.set(item.id, polar(radius, angle))
      })
    })
  })
  return output
}

export function TechnologyRadarChart({
  items,
  categories,
}: {
  items: TechnologyListItem[]
  categories: TechnologyCategory[]
}) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState<number | null>(null)
  const points = positions(items, categories)
  const sectorSize = 360 / Math.max(categories.length, 1)
  const open = (id: number) => navigate(`/technology-radar/${id}`)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <div className="overflow-hidden rounded-2xl bg-bg-elevated p-3 ring-1 ring-white/5">
        <svg viewBox="0 0 600 600" className="mx-auto h-auto w-full max-w-[760px]" role="img" aria-label="Круговой радар технологий">
          {categories.map((category, index) => (
            <path
              key={category.id}
              d={sectorPath(index * sectorSize, (index + 1) * sectorSize, OUTER)}
              fill={index % 2 ? 'var(--chart-surface-alt)' : 'var(--chart-surface)'}
              stroke="var(--chart-border)"
              strokeWidth="1"
            />
          ))}
          {[1, 2, 3, 4].map((ring) => (
            <circle key={ring} cx={CENTER} cy={CENTER} r={ring * OUTER / 4} fill="none" stroke="var(--chart-grid)" strokeWidth="1" />
          ))}
          {RINGS.map((status, index) => (
            <text key={status} x={CENTER + 5} y={CENTER - index * OUTER / 4 - 8} fill="var(--chart-muted)" fontSize="11">
              {STATUS_LABEL[status]}
            </text>
          ))}
          {categories.map((category, index) => {
            const p = polar(OUTER + 24, index * sectorSize + sectorSize / 2)
            return <text key={category.id} x={p.x} y={p.y} textAnchor="middle" fill="var(--chart-text)" fontSize="10">{category.name}</text>
          })}
          {items.map((item) => {
            const p = points.get(item.id)
            if (!p) return null
            const label = `${item.name}. ${STATUS_LABEL[item.status]}, ${item.category.name}. ${item.products_count} продуктов, ${item.leaders_count + item.experts_count} экспертов`
            return (
              <g
                key={item.id}
                transform={`translate(${p.x} ${p.y})`}
                role="link"
                tabIndex={0}
                aria-label={label}
                className="cursor-pointer outline-none"
                onClick={() => open(item.id)}
                onMouseEnter={() => setActiveId(item.id)}
                onMouseLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(item.id)}
                onBlur={() => setActiveId(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    open(item.id)
                  }
                }}
              >
                <title>{label}</title>
                <circle
                  r="12"
                  fill={STATUS_COLOR[item.status]}
                  stroke={activeId === item.id ? 'var(--chart-primary)' : item.attention.has_attention ? 'var(--chart-tooltip-text)' : 'var(--chart-point-outline)'}
                  strokeWidth={activeId === item.id ? 3 : item.attention.has_attention ? 2 : 1}
                />
                <text textAnchor="middle" dominantBaseline="central" fill="var(--chart-point-label)" fontWeight="700" fontSize={item.id > 99 ? 8 : 10}>{item.id}</text>
              </g>
            )
          })}
          {activeId !== null && (() => {
            const item = items.find((technology) => technology.id === activeId)
            const point = points.get(activeId)
            if (!item || !point) return null
            const tooltipX = Math.min(Math.max(point.x + 16, 8), 380)
            const tooltipY = Math.min(Math.max(point.y - 58, 8), 520)
            return (
              <g transform={`translate(${tooltipX} ${tooltipY})`} pointerEvents="none" aria-hidden="true">
                <rect width="212" height="66" rx="8" fill="var(--chart-tooltip)" stroke="var(--chart-border)" />
                <text x="10" y="19" fill="var(--chart-tooltip-text)" fontSize="12" fontWeight="600">{item.name}</text>
                <text x="10" y="38" fill="var(--chart-text)" fontSize="10">{STATUS_LABEL[item.status]} · {item.category.name}</text>
                <text x="10" y="55" fill="var(--chart-muted)" fontSize="10">{item.products_count} продуктов · {item.leaders_count + item.experts_count} экспертов</text>
              </g>
            )
          })()}
        </svg>
      </div>
      <div className="max-h-[680px] space-y-1 overflow-y-auto rounded-2xl bg-bg-elevated p-3 ring-1 ring-white/5">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Легенда</div>
        {items.map((item) => (
          <button key={item.id} onClick={() => open(item.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-bg-panel">
            <span className="w-8 text-right font-mono text-xs" style={{ color: STATUS_COLOR[item.status] }}>{item.id}</span>
            <TechnologyIcon slug={item.icon_slug} name={item.name} size={20} />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{item.name}</span>
            {item.attention.has_attention && <span title="Требует внимания" className="text-amber-400">⚠</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
