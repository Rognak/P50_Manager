import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  ProductStatus,
  ProductTechnology,
  TechnologyListItem,
  TechnologyMeta,
  TechnologyStatus,
  TechnologyUsageType,
  api,
} from '../../api/client'
import { TECHNOLOGY_STATUS_VARIANTS, buttonClass } from '../../lib/ui-variants'
import { TechnologyIcon } from '../technology/TechnologyIcon'

const USAGE_LABEL: Record<TechnologyUsageType, string> = {
  production: 'Production',
  pilot: 'Пилот',
  evaluation: 'Оценка',
  legacy: 'Legacy',
}

export function ProductTechnologiesPanel({
  productId,
  productStatus,
  canManage,
}: {
  productId: number
  productStatus: ProductStatus
  canManage: boolean
}) {
  const [items, setItems] = useState<ProductTechnology[] | null>(null)
  const [meta, setMeta] = useState<TechnologyMeta | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [technologyId, setTechnologyId] = useState('')
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<TechnologyStatus | ''>('')
  const [results, setResults] = useState<TechnologyListItem[]>([])
  const [usageType, setUsageType] = useState<TechnologyUsageType>('production')
  const [notes, setNotes] = useState('')
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setItems(await api.products.technologies(productId))
  }, [productId])

  useEffect(() => {
    setItems(null)
    setError(null)
    void load().catch((err: Error) => setError(err.message))
    if (canManage) {
      void api.technologies.meta().then(setMeta).catch((err: Error) => setError(err.message))
    }
  }, [canManage, load])

  useEffect(() => {
    if (!addOpen) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      setError(null)
      void api.technologies.list({
        q: query.trim() || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        status: status || undefined,
        exclude_product_id: productId,
        limit: 51,
      }).then((page) => {
        if (cancelled) return
        setResults(page.slice(0, 50))
        setHasMore(page.length > 50)
      }).catch((err: Error) => !cancelled && setError(err.message)).finally(() => !cancelled && setSearching(false))
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [addOpen, categoryId, productId, query, status])

  const assignedIds = new Set(items?.map((item) => item.technology_id) || [])
  const available = results.filter((technology) => !assignedIds.has(technology.id))
  const visible = available

  const loadMore = async () => {
    setLoadingMore(true)
    setError(null)
    try {
      const page = await api.technologies.list({
        q: query.trim() || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        status: status || undefined,
        exclude_product_id: productId,
        limit: 51,
        offset: results.length,
      })
      setResults((current) => [...current, ...page.slice(0, 50)])
      setHasMore(page.length > 50)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const openAdd = () => {
    setTechnologyId('')
    setQuery('')
    setCategoryId('')
    setStatus('')
    setResults([])
    setHasMore(false)
    setUsageType('production')
    setNotes('')
    setError(null)
    setAddOpen(true)
  }

  const addTechnology = async (event: FormEvent) => {
    event.preventDefault()
    if (!technologyId) return
    setSaving(true)
    setError(null)
    try {
      await api.technologies.products.add(Number(technologyId), {
        product_id: productId,
        usage_type: usageType,
        notes: notes.trim() || null,
      })
      await load()
      setAddOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const removeTechnology = async (item: ProductTechnology) => {
    if (!confirm(`Удалить технологию «${item.technology_name}» из продукта?`)) return
    setError(null)
    try {
      await api.technologies.products.remove(item.technology_id, productId)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return <section>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Технологии</h2>
      {canManage && items && <button onClick={addOpen ? () => setAddOpen(false) : openAdd} className={buttonClass('secondary', 'px-3 py-1.5 text-xs')}>{addOpen ? 'Отмена' : '+ Добавить технологию'}</button>}
    </div>

    {addOpen && <form onSubmit={addTechnology} className="mb-4 space-y-3 rounded-xl bg-bg-panel/60 p-3 ring-1 ring-outline-subtle">
      <div><h3 className="text-sm font-medium">Выберите технологию</h3><p className="mt-1 text-xs text-slate-500">Поиск по всему реестру радара. Результаты загружаются по 50.</p></div>
      <div className="grid gap-2 md:grid-cols-3">
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setTechnologyId('') }} placeholder="Название технологии" className="rounded-lg border border-outline bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary" />
        <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setTechnologyId('') }} className="rounded-lg border border-outline bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"><option value="">Все направления</option>{meta?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select value={status} onChange={(event) => { setStatus(event.target.value as TechnologyStatus | ''); setTechnologyId('') }} className="rounded-lg border border-outline bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"><option value="">Все статусы</option><option value="adopt">Adopt</option><option value="trial">Trial</option><option value="assess">Assess</option><option value="hold">Hold</option></select>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-xl bg-surface ring-1 ring-outline-subtle">
        {searching ? <div className="p-3 text-sm text-slate-500">Поиск технологий…</div> : visible.length ? visible.map((technology) => {
          const selected = technologyId === String(technology.id)
          return <button key={technology.id} type="button" onClick={() => setTechnologyId(String(technology.id))} className={`flex w-full items-center gap-3 border-b border-outline-subtle px-3 py-2 text-left last:border-0 ${selected ? 'bg-primary-soft ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-subtle'}`}><TechnologyIcon slug={technology.icon_slug} name={technology.name} size={24} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{technology.name}</div><div className="text-xs text-slate-500">{technology.category.name}</div></div><span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${TECHNOLOGY_STATUS_VARIANTS[technology.status]}`}>{technology.status}</span></button>
        }) : <div className="p-3 text-sm text-slate-500">По выбранным фильтрам технологии не найдены.</div>}
      </div>
      {hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={buttonClass('ghost', 'w-full justify-center text-xs')}>{loadingMore ? 'Загрузка…' : 'Показать ещё 50'}</button>}
      <div className="grid gap-3 border-t border-outline-subtle pt-3 md:grid-cols-[minmax(150px,1fr)_minmax(220px,2fr)_auto]">
        <select value={usageType} onChange={(event) => setUsageType(event.target.value as TechnologyUsageType)} className="rounded-lg border border-outline-strong bg-surface px-3 py-2 text-sm outline-none focus:border-primary">{Object.entries(USAGE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Комментарий (необязательно)" className="rounded-lg border border-outline bg-surface px-3 py-2 text-sm outline-none focus:border-primary" />
        <button disabled={saving || !technologyId} className={buttonClass('primary')}>{saving ? 'Добавление…' : 'Добавить выбранную'}</button>
      </div>
    </form>}

    {error && <div className="mb-4 text-sm text-danger">Не удалось выполнить операцию: {error}</div>}
    {items === null ? !error && <div className="text-sm text-slate-500">Загрузка технологий…</div> : items.length === 0 ? <div className="rounded-2xl bg-bg-elevated px-6 py-5 text-sm text-slate-500">Технологии продукта пока не указаны.</div> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {items.map((technology) => {
        const debt = technology.status === 'hold' && productStatus === 'active'
        return <article key={technology.technology_id} className={`rounded-xl p-4 ring-1 ${debt ? 'bg-rose-500/10 ring-rose-500/30' : 'bg-bg-elevated ring-outline-subtle'}`}>
          <div className="flex items-center gap-2"><TechnologyIcon slug={technology.icon_slug} name={technology.technology_name} size={28} /><Link to={`/technology-radar/${technology.technology_id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">{technology.technology_name}</Link><span className="shrink-0 rounded bg-bg-panel px-2 py-0.5 text-xs uppercase text-slate-300">{technology.status} · {USAGE_LABEL[technology.usage_type]}</span></div>
          <div className="mt-1 text-xs text-slate-500">{technology.category.name}</div>
          {technology.notes && <div className="mt-2 text-xs text-slate-400">{technology.notes}</div>}
          {debt && <div className="mt-2 text-xs text-rose-300">Технология находится в Hold и всё ещё используется активным продуктом.</div>}
          {canManage && <div className="mt-3 flex justify-end border-t border-outline-subtle pt-3"><button onClick={() => void removeTechnology(technology)} className="text-xs text-danger hover:text-danger-hover">Удалить из продукта</button></div>}
        </article>
      })}
    </div>}
  </section>
}
