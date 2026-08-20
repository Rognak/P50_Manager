import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  TechnologyCreatePayload,
  TechnologyCatalogEntry,
  TechnologyListItem,
  TechnologyMeta,
  TechnologyProposal,
  TechnologyStatus,
  api,
} from '../api/client'
import { TechnologyRadarChart } from '../components/technology/TechnologyRadarChart'
import { TechnologyIcon, TechnologyIconPicker, suggestTechnologyIconSlug } from '../components/technology/TechnologyIcon'
import { useAuth } from '../lib/auth-context'
import { TECHNOLOGY_STATUS_VARIANTS, buttonClass, statusClass } from '../lib/ui-variants'

const STATUS_LABEL: Record<TechnologyStatus, string> = {
  adopt: 'Adopt', trial: 'Trial', assess: 'Assess', hold: 'Hold',
}

function CreateModal({ meta, onClose, onCreated }: {
  meta: TechnologyMeta
  onClose: () => void
  onCreated: (item: TechnologyListItem) => void
}) {
  const [form, setForm] = useState<TechnologyCreatePayload>({
    name: '', category_id: meta.categories[0]?.id || 0, status: 'assess',
    description_md: '', status_reason_md: '', next_review_at: null, icon_slug: null,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setError(null)
    try { onCreated(await api.technologies.create(form)) }
    catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="w-full max-w-xl space-y-4 rounded-2xl bg-bg-elevated p-6 ring-1 ring-white/10">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Новая технология</h2><button type="button" onClick={onClose}>✕</button></div>
        <input required placeholder="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg bg-surface-subtle px-3 py-2 ring-1 ring-outline outline-none focus:ring-2 focus:ring-primary" />
        <TechnologyIconPicker name={form.name} value={form.icon_slug} onChange={(icon_slug) => setForm({ ...form, icon_slug })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: Number(e.target.value) })} className="rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5">
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TechnologyStatus })} className="rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5">
            {meta.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <textarea placeholder="Описание (Markdown)" value={form.description_md || ''} onChange={(e) => setForm({ ...form, description_md: e.target.value })} className="h-24 w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5" />
        <textarea placeholder="Почему выбран этот статус" value={form.status_reason_md || ''} onChange={(e) => setForm({ ...form, status_reason_md: e.target.value })} className="h-20 w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5" />
        <label className="block text-xs text-slate-400">Следующий review<input type="date" value={form.next_review_at || ''} onChange={(e) => setForm({ ...form, next_review_at: e.target.value || null })} className="mt-1 block w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" /></label>
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={buttonClass('ghost')}>Отмена</button><button disabled={saving} className={buttonClass('primary')}>{saving ? 'Сохранение…' : 'Добавить'}</button></div>
      </form>
    </div>
  )
}

function ProposalModal({ meta, existing, proposals, canUseCatalog, onClose, onCreated }: {
  meta: TechnologyMeta
  existing: TechnologyListItem[]
  proposals: TechnologyProposal[]
  canUseCatalog: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [catalog, setCatalog] = useState<TechnologyCatalogEntry[]>([])
  const [catalogLoading, setCatalogLoading] = useState(canUseCatalog)
  const [mode, setMode] = useState<'catalog' | 'manual'>(canUseCatalog ? 'catalog' : 'manual')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TechnologyCatalogEntry | null>(null)
  const [manualName, setManualName] = useState('')
  const [categoryId, setCategoryId] = useState(meta.categories[0]?.id || 0)
  const [rationale, setRationale] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canUseCatalog) return
    api.admin.technologyCatalog()
      .then(setCatalog)
      .catch((err) => setError((err as Error).message))
      .finally(() => setCatalogLoading(false))
  }, [canUseCatalog])

  const unavailableNames = useMemo(() => new Set([
    ...existing.map((item) => item.name.trim().toLocaleLowerCase()),
    ...proposals.filter((item) => !['rejected', 'approved'].includes(item.status)).map((item) => item.name.trim().toLocaleLowerCase()),
  ]), [existing, proposals])
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return catalog.filter((entry) => {
      if (unavailableNames.has(entry.name.trim().toLocaleLowerCase())) return false
      if (!needle) return true
      return [entry.technology_id, entry.name, entry.aliases, entry.type, entry.ecosystem]
        .some((value) => value?.toLocaleLowerCase().includes(needle))
    }).slice(0, 100)
  }, [catalog, query, unavailableNames])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = mode === 'catalog' ? selected?.name : manualName.trim()
    if (!name) { setError('Выберите технологию'); return }
    setSaving(true); setError(null)
    try {
      await api.technologyProposals.create({ name, category_id: categoryId, rationale_md: rationale.trim() })
      onCreated()
    } catch (err) { setError((err as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="w-full max-w-2xl space-y-4 rounded-2xl bg-bg-elevated p-6 ring-1 ring-white/10">
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Предложить технологию</h2><p className="mt-1 text-xs text-slate-500">После одобрения технология появится в радаре со статусом Assess.</p></div><button type="button" onClick={onClose}>✕</button></div>
        {canUseCatalog && <div className="flex gap-1 rounded-lg bg-surface-subtle p-1"><button type="button" onClick={() => { setMode('catalog'); setError(null) }} className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === 'catalog' ? 'bg-primary-soft text-primary' : 'text-ink-secondary'}`}>Из справочника</button><button type="button" onClick={() => { setMode('manual'); setError(null) }} className={`flex-1 rounded-md px-3 py-2 text-sm ${mode === 'manual' ? 'bg-primary-soft text-primary' : 'text-ink-secondary'}`}>Вручную</button></div>}
        {mode === 'catalog' ? <div className="space-y-2">
          <input autoFocus placeholder="Поиск по названию, ID, алиасу, типу или экосистеме" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-outline outline-none focus:ring-2 focus:ring-primary" />
          <div className="max-h-64 overflow-y-auto rounded-xl bg-bg-panel ring-1 ring-outline-subtle">
            {catalogLoading ? <div className="p-4 text-sm text-slate-500">Загрузка справочника…</div> : results.length === 0 ? <div className="p-4 text-sm text-slate-500">Подходящих технологий не найдено. Уже добавленные и предложенные технологии скрыты.</div> : results.map((entry) => <button key={entry.technology_id} type="button" onClick={() => setSelected(entry)} className={`flex w-full items-center gap-3 border-b border-outline-subtle px-3 py-2 text-left last:border-0 ${selected?.technology_id === entry.technology_id ? 'bg-primary-soft' : 'hover:bg-surface-subtle'}`}><TechnologyIcon slug={suggestTechnologyIconSlug(entry.name)} name={entry.name} size={28} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span className="block truncate text-xs text-slate-500">{[entry.technology_id, entry.type, entry.ecosystem, entry.aliases].filter(Boolean).join(' · ')}</span></span></button>)}
          </div>
          {selected && <div className="flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-2 text-sm"><TechnologyIcon slug={suggestTechnologyIconSlug(selected.name)} name={selected.name} size={24} /><span>Выбрано: <strong>{selected.name}</strong></span><button type="button" onClick={() => setSelected(null)} className="ml-auto text-ink-muted hover:text-ink">Сбросить</button></div>}
        </div> : <input autoFocus required placeholder="Название технологии" value={manualName} onChange={(e) => setManualName(e.target.value)} className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-outline outline-none focus:ring-2 focus:ring-primary" />}
        <select value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))} className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-outline-subtle"><option value="" disabled>Выберите направление радара</option>{meta.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <textarea required placeholder="Зачем оценивать технологию и какую проблему она решает?" value={rationale} onChange={(e) => setRationale(e.target.value)} className="h-24 w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-outline-subtle outline-none focus:ring-2 focus:ring-primary" />
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={buttonClass('ghost')}>Отмена</button><button disabled={saving || !rationale.trim() || (mode === 'catalog' ? !selected : !manualName.trim())} className={buttonClass('primary')}>{saving ? 'Отправка…' : 'Предложить'}</button></div>
      </form>
    </div>
  )
}

export function TechnologyRadar() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [items, setItems] = useState<TechnologyListItem[]>([])
  const [meta, setMeta] = useState<TechnologyMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [attention, setAttention] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [view, setView] = useState<'radar' | 'table'>('radar')
  const [createOpen, setCreateOpen] = useState(false)
  const [proposalOpen, setProposalOpen] = useState(false)
  const [proposals, setProposals] = useState<TechnologyProposal[]>([])

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [technologies, metadata, proposalItems] = await Promise.all([
        api.technologies.list({ include_archived: includeArchived }),
        api.technologies.meta(),
        api.technologyProposals.list(),
      ])
      setItems(technologies); setMeta(metadata); setProposals(proposalItems)
    } catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [includeArchived])
  const filtered = useMemo(() => items.filter((item) =>
    (!query || item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
    (!category || item.category.id === Number(category)) &&
    (!status || item.status === status) && (!attention || item.attention.has_attention)
  ), [items, query, category, status, attention])
  const activeItems = items.filter((item) => item.is_active)
  const count = (value: TechnologyStatus) => activeItems.filter((item) => item.status === value).length
  const summaryCards = [
    { label: 'Всего', value: activeItems.length, tone: 'text-ink' },
    { label: 'Adopt', value: count('adopt'), tone: 'text-success' },
    { label: 'Trial', value: count('trial'), tone: 'text-primary' },
    { label: 'Assess', value: count('assess'), tone: 'text-warning' },
    { label: 'Hold', value: count('hold'), tone: 'text-danger' },
    { label: 'Требуют внимания', value: activeItems.filter((item) => item.attention.has_attention).length, tone: 'text-warning' },
  ]

  if (loading) return <div className="text-slate-500">Загрузка радара…</div>
  if (error) return <div className="rounded-xl bg-danger-soft p-4 text-danger ring-1 ring-danger/30" role="alert">Не удалось загрузить радар: {error}<button onClick={load} className="ml-3 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Повторить</button></div>
  if (!meta) return null
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Радар технологий</h1><p className="mt-1 text-sm text-slate-500">Adopt — используем, Trial — апробируем, Assess — изучаем, Hold — выводим из применения.</p></div>
        {user?.is_admin && <button onClick={() => setCreateOpen(true)} className={buttonClass('primary')}>+ Добавить технологию</button>}
      </header>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {summaryCards.map(({ label, value, tone }) => (
          <div key={label} className="rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5"><div className={`text-xl font-semibold ${tone}`}>{value}</div><div className="text-xs text-slate-500">{label}</div></div>
        ))}
      </section>
      <section className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5">
        <input placeholder="Поиск технологии" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-[220px] flex-1 rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все направления</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все статусы</option>{meta.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <label className="flex items-center gap-2 px-2 text-sm text-slate-300"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Только требующие внимания</label>
        {user?.is_admin && <label className="flex items-center gap-2 px-2 text-sm text-slate-300"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Показать архив</label>}
        <button onClick={() => { setQuery(''); setCategory(''); setStatus(''); setAttention(false) }} className="text-sm text-slate-500 hover:text-slate-200">Сбросить</button>
        <div className="ml-auto flex rounded-lg bg-surface-subtle p-1 ring-1 ring-outline-subtle"><button onClick={() => setView('radar')} className={`rounded px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${view === 'radar' ? 'bg-primary-soft text-primary' : 'text-ink-secondary hover:text-ink'}`}>Радар</button><button onClick={() => setView('table')} className={`rounded px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${view === 'table' ? 'bg-primary-soft text-primary' : 'text-ink-secondary hover:text-ink'}`}>Таблица</button></div>
      </section>
      {filtered.length === 0 ? <div className="rounded-2xl bg-bg-elevated p-10 text-center text-slate-500">В радаре пока нет технологий.{user?.is_admin && <div className="mt-2">Добавьте первую технологию.</div>}</div> : view === 'radar' ? (
        <TechnologyRadarChart items={filtered.filter((item) => item.is_active)} categories={meta.categories} />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-outline-subtle"><table className="w-full text-sm"><thead className="bg-surface-subtle text-left text-xs uppercase text-ink-muted"><tr>{['Технология', 'Направление', 'Статус', 'Лидеры / эксперты', 'Носители', 'Продукты', 'Следующий review', 'Сигналы'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onClick={() => navigate(`/technology-radar/${item.id}`)} className={`cursor-pointer border-t border-outline-subtle hover:bg-surface-subtle ${item.is_active ? '' : 'opacity-60'}`}><td className="px-4 py-3 font-medium"><span className="flex items-center gap-2"><TechnologyIcon slug={item.icon_slug} name={item.name} size={24} />{item.name}{!item.is_active && <span className={statusClass('neutral')}>архив</span>}</span></td><td className="px-4 py-3 text-ink-secondary">{item.category.name}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs font-medium ${TECHNOLOGY_STATUS_VARIANTS[item.status]}`}>{STATUS_LABEL[item.status]}</span></td><td className="px-4 py-3">{item.leaders_count} / {item.experts_count}</td><td className="px-4 py-3">{item.practitioners_count}</td><td className="px-4 py-3">{item.products_count}</td><td className="px-4 py-3">{item.next_review_at ? new Date(item.next_review_at).toLocaleDateString('ru-RU') : '—'}</td><td className={`px-4 py-3 ${item.attention.has_attention ? 'text-warning' : 'text-ink-muted'}`}>{item.attention.has_attention ? '⚠ Требует внимания' : '—'}</td></tr>)}</tbody></table></div>
      )}
      <section className="rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Предложения и Assess workflow</h2><p className="mt-1 text-xs text-slate-500">Инициатива → оценка → эксперимент → Trial → решение.</p></div><button onClick={() => setProposalOpen(true)} className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent">+ Предложить технологию</button></div>
        {proposals.length === 0 ? <div className="text-sm text-slate-500">Предложений пока нет.</div> : <div className="space-y-2">{proposals.slice(0, 10).map((proposal) => <div key={proposal.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-panel p-3"><span className="font-medium">{proposal.name}</span><span className="rounded bg-slate-500/15 px-2 py-1 text-xs text-slate-400">{proposal.status}</span><span className="min-w-0 flex-1 truncate text-xs text-slate-500">{proposal.rationale_md}</span>{user?.is_admin && proposal.status !== 'approved' && proposal.status !== 'rejected' && <><button onClick={async () => { await api.technologyProposals.decide(proposal.id, { status: 'approved', decision_md: prompt('Решение об одобрении') || 'Одобрено для эксперимента' }); await load() }} className="text-xs text-emerald-300">Одобрить</button><button onClick={async () => { const reason = prompt('Причина отклонения'); if (reason) { await api.technologyProposals.decide(proposal.id, { status: 'rejected', decision_md: reason }); await load() } }} className="text-xs text-rose-300">Отклонить</button></>}</div>)}</div>}
      </section>
      {createOpen && <CreateModal meta={meta} onClose={() => setCreateOpen(false)} onCreated={(item) => { setCreateOpen(false); navigate(`/technology-radar/${item.id}`) }} />}
      {proposalOpen && <ProposalModal meta={meta} existing={items} proposals={proposals} canUseCatalog={Boolean(user?.is_admin)} onClose={() => setProposalOpen(false)} onCreated={() => { setProposalOpen(false); void load() }} />}
    </div>
  )
}
