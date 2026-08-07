import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  TechnologyCreatePayload,
  TechnologyListItem,
  TechnologyMeta,
  TechnologyStatus,
  api,
} from '../api/client'
import { TechnologyRadarChart } from '../components/technology/TechnologyRadarChart'
import { useAuth } from '../lib/auth-context'

const STATUS_LABEL: Record<TechnologyStatus, string> = {
  adopt: 'Adopt', trial: 'Trial', assess: 'Assess', hold: 'Hold',
}
const STATUS_TONE: Record<TechnologyStatus, string> = {
  adopt: 'bg-teal-500/15 text-teal-300', trial: 'bg-amber-500/15 text-amber-300',
  assess: 'bg-sky-500/15 text-sky-300', hold: 'bg-rose-500/15 text-rose-300',
}

function CreateModal({ meta, onClose, onCreated }: {
  meta: TechnologyMeta
  onClose: () => void
  onCreated: (item: TechnologyListItem) => void
}) {
  const [form, setForm] = useState<TechnologyCreatePayload>({
    name: '', category_id: meta.categories[0]?.id || 0, status: 'assess',
    description_md: '', status_reason_md: '', next_review_at: null,
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
        <input required placeholder="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent" />
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
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-400">Отмена</button><button disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50">{saving ? 'Сохранение…' : 'Добавить'}</button></div>
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

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [technologies, metadata] = await Promise.all([
        api.technologies.list({ include_archived: includeArchived }),
        api.technologies.meta(),
      ])
      setItems(technologies); setMeta(metadata)
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

  if (loading) return <div className="text-slate-500">Загрузка радара…</div>
  if (error) return <div className="rounded-xl bg-red-500/10 p-4 text-red-300">Не удалось загрузить радар: {error}<button onClick={load} className="ml-3 underline">Повторить</button></div>
  if (!meta) return null
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">Радар технологий</h1><p className="mt-1 text-sm text-slate-500">Adopt — используем, Trial — апробируем, Assess — изучаем, Hold — выводим из применения.</p></div>
        {user?.is_admin && <button onClick={() => setCreateOpen(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg">+ Добавить технологию</button>}
      </header>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[['Всего', activeItems.length], ['Adopt', count('adopt')], ['Trial', count('trial')], ['Assess', count('assess')], ['Hold', count('hold')], ['Требуют внимания', activeItems.filter((i) => i.attention.has_attention).length]].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5"><div className="text-xl font-semibold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>
        ))}
      </section>
      <section className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-elevated p-3 ring-1 ring-white/5">
        <input placeholder="Поиск технологии" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-[220px] flex-1 rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все направления</option>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все статусы</option>{meta.statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <label className="flex items-center gap-2 px-2 text-sm text-slate-300"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Только требующие внимания</label>
        {user?.is_admin && <label className="flex items-center gap-2 px-2 text-sm text-slate-300"><input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} /> Показать архив</label>}
        <button onClick={() => { setQuery(''); setCategory(''); setStatus(''); setAttention(false) }} className="text-sm text-slate-500 hover:text-slate-200">Сбросить</button>
        <div className="ml-auto flex rounded-lg bg-bg-panel p-1"><button onClick={() => setView('radar')} className={`rounded px-3 py-1 text-xs ${view === 'radar' ? 'bg-accent/20 text-accent' : 'text-slate-400'}`}>Радар</button><button onClick={() => setView('table')} className={`rounded px-3 py-1 text-xs ${view === 'table' ? 'bg-accent/20 text-accent' : 'text-slate-400'}`}>Таблица</button></div>
      </section>
      {filtered.length === 0 ? <div className="rounded-2xl bg-bg-elevated p-10 text-center text-slate-500">В радаре пока нет технологий.{user?.is_admin && <div className="mt-2">Добавьте первую технологию.</div>}</div> : view === 'radar' ? (
        <TechnologyRadarChart items={filtered.filter((item) => item.is_active)} categories={meta.categories} />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-bg-elevated ring-1 ring-white/5"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr>{['Технология', 'Направление', 'Статус', 'Лидеры / эксперты', 'Носители', 'Продукты', 'Следующий review', 'Сигналы'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id} onClick={() => navigate(`/technology-radar/${item.id}`)} className={`cursor-pointer border-t border-white/5 hover:bg-bg-panel/50 ${item.is_active ? '' : 'opacity-50'}`}><td className="px-4 py-3 font-medium">{item.name}{!item.is_active && <span className="ml-2 rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] text-slate-400">архив</span>}</td><td className="px-4 py-3 text-slate-400">{item.category.name}</td><td className="px-4 py-3"><span className={`rounded px-2 py-1 text-xs ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span></td><td className="px-4 py-3">{item.leaders_count} / {item.experts_count}</td><td className="px-4 py-3">{item.practitioners_count}</td><td className="px-4 py-3">{item.products_count}</td><td className="px-4 py-3">{item.next_review_at ? new Date(item.next_review_at).toLocaleDateString('ru-RU') : '—'}</td><td className="px-4 py-3 text-amber-300">{item.attention.has_attention ? '⚠ Требует внимания' : '—'}</td></tr>)}</tbody></table></div>
      )}
      {createOpen && <CreateModal meta={meta} onClose={() => setCreateOpen(false)} onCreated={(item) => { setCreateOpen(false); navigate(`/technology-radar/${item.id}`) }} />}
    </div>
  )
}
