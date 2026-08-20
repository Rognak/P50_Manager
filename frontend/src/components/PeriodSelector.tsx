import { useMemo } from 'react'

export type PeriodPreset = '30d' | '90d' | '180d' | '365d' | 'all'

const PRESET_DAYS: Record<Exclude<PeriodPreset, 'all'>, number> = {
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
}

const LABELS: Record<PeriodPreset, string> = {
  '30d': '30 дн',
  '90d': '90 дн',
  '180d': '6 мес',
  '365d': 'Год',
  all: 'Всё',
}

export function presetToQuery(preset: PeriodPreset): {
  from?: string
  to?: string
} {
  if (preset === 'all') return {}
  const days = PRESET_DAYS[preset]
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodPreset
  onChange: (p: PeriodPreset) => void
}) {
  const presets = useMemo<PeriodPreset[]>(
    () => ['30d', '90d', '180d', '365d', 'all'],
    [],
  )
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-surface-subtle p-1 ring-1 ring-outline-subtle">
      {presets.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={
            'rounded-full px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
            (value === p
              ? 'bg-primary text-white font-medium'
              : 'text-ink-secondary hover:bg-surface hover:text-ink')
          }
        >
          {LABELS[p]}
        </button>
      ))}
    </div>
  )
}
