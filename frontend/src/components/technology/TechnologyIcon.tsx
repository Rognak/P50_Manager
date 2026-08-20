import { TECHNOLOGY_ICON_ALIASES, TECHNOLOGY_ICON_OPTIONS, TECHNOLOGY_ICONS } from '../../lib/technology-icons.generated'

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function suggestTechnologyIconSlug(name: string): string | null {
  return TECHNOLOGY_ICON_ALIASES[normalize(name)] || null
}

export function TechnologyIcon({ slug, name, size = 32, className = '' }: {
  slug: string | null | undefined
  name: string
  size?: number
  className?: string
}) {
  const icon = slug ? TECHNOLOGY_ICONS.get(slug) : undefined
  if (!icon) {
    return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-surface-subtle font-semibold text-ink-muted ring-1 ring-outline-subtle ${className}`} style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}>{name.trim().charAt(0).toUpperCase() || '?'}</span>
  }
  return <span role="img" aria-label={icon.title} title={icon.title} className={`inline-block shrink-0 ${className}`} style={{ width: size, height: size, backgroundColor: icon.hex, WebkitMaskImage: `url(${icon.url})`, maskImage: `url(${icon.url})`, WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskSize: 'contain', maskSize: 'contain' }} />
}

export function TechnologyIconPicker({ value, name, onChange }: {
  value: string | null | undefined
  name: string
  onChange: (slug: string | null) => void
}) {
  const suggested = suggestTechnologyIconSlug(name)
  return <label className="block text-xs text-ink-secondary">Официальная иконка
    <div className="mt-1 flex items-center gap-2">
      <TechnologyIcon slug={value} name={name} size={32} />
      <select value={value || ''} onChange={(event) => onChange(event.target.value || null)} className="min-w-0 flex-1 rounded-lg border border-outline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary">
        <option value="">Без иконки</option>
        {TECHNOLOGY_ICON_OPTIONS.map((icon) => <option key={icon.slug} value={icon.slug}>{icon.title}</option>)}
      </select>
      {suggested && suggested !== value && <button type="button" onClick={() => onChange(suggested)} className="rounded-lg px-3 py-2 text-xs text-primary hover:bg-primary-soft">Подобрать</button>}
    </div>
  </label>
}
