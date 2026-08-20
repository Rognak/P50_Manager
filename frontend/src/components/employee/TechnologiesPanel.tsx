import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  EmployeeTechnology,
  TechnologyListItem,
  TechnologyMemberRole,
  TechnologyMeta,
  TechnologyStatus,
  api,
} from '../../api/client'
import { useAuth } from '../../lib/auth-context'
import { TECHNOLOGY_STATUS_VARIANTS, buttonClass, statusClass } from '../../lib/ui-variants'
import { TechnologyIcon } from '../technology/TechnologyIcon'

const ROLE_LABEL: Record<TechnologyMemberRole, string> = {
  leader: 'Лидер', expert: 'Эксперт', practitioner: 'Носитель',
}
const ROLE_TONE: Record<TechnologyMemberRole, string> = {
  leader: 'bg-surface-subtle text-ink ring-1 ring-outline-subtle',
  expert: 'bg-surface-subtle text-ink ring-1 ring-outline-subtle',
  practitioner: 'bg-surface-subtle text-ink-secondary ring-1 ring-outline-subtle',
}

export function TechnologiesPanel({ employeeId }: { employeeId: number }) {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.is_admin)
  const [items, setItems] = useState<EmployeeTechnology[] | null>(null)
  const [meta, setMeta] = useState<TechnologyMeta | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [technologyId, setTechnologyId] = useState('')
  const [technologyQuery, setTechnologyQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<TechnologyStatus | ''>('')
  const [searchResults, setSearchResults] = useState<TechnologyListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [role, setRole] = useState<TechnologyMemberRole>('practitioner')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    setError(null)
    const requests: [Promise<EmployeeTechnology[]>, Promise<TechnologyMeta | null>] = [
      api.employees.technologies(employeeId),
      isAdmin ? api.technologies.meta() : Promise.resolve(null),
    ]
    Promise.all(requests)
      .then(([employeeTechnologies, technologyMeta]) => {
        setItems(employeeTechnologies)
        setMeta(technologyMeta)
      })
      .catch((err) => setError((err as Error).message))
  }, [employeeId, isAdmin])

  useEffect(() => {
    if (!addOpen) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      setError(null)
      void api.technologies.list({
        q: technologyQuery.trim() || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        status: status || undefined,
        limit: 51,
        exclude_employee_id: employeeId,
      }).then((page) => {
        if (cancelled) return
        setSearchResults(page.slice(0, 50))
        setHasMore(page.length > 50)
      }).catch((err: Error) => !cancelled && setError(err.message)).finally(() => !cancelled && setSearching(false))
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [addOpen, technologyQuery, categoryId, status, employeeId])

  const refresh = async () => setItems(await api.employees.technologies(employeeId))
  const assignedIds = new Set(items?.map((item) => item.technology_id) || [])
  const availableResults = searchResults.filter((technology) => !assignedIds.has(technology.id))
  const visibleResults = availableResults

  const loadMore = async () => {
    setLoadingMore(true)
    setError(null)
    try {
      const page = await api.technologies.list({
        q: technologyQuery.trim() || undefined,
        category_id: categoryId ? Number(categoryId) : undefined,
        status: status || undefined,
        limit: 51,
        offset: searchResults.length,
        exclude_employee_id: employeeId,
      })
      setSearchResults((current) => [...current, ...page.slice(0, 50)])
      setHasMore(page.length > 50)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const openAdd = () => {
    setTechnologyId('')
    setTechnologyQuery('')
    setCategoryId('')
    setStatus('')
    setSearchResults([])
    setHasMore(false)
    setRole('practitioner')
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
      await api.technologies.members.add(Number(technologyId), {
        employee_id: employeeId,
        role,
        notes: notes.trim() || null,
      })
      await refresh()
      setAddOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const updateRole = async (item: EmployeeTechnology, nextRole: TechnologyMemberRole) => {
    setError(null)
    try {
      await api.technologies.members.update(item.technology_id, employeeId, { role: nextRole })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const updateNotes = async (item: EmployeeTechnology) => {
    const value = prompt('Комментарий к технологии', item.notes || '')
    if (value === null) return
    setError(null)
    try {
      await api.technologies.members.update(item.technology_id, employeeId, { notes: value.trim() || null })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const removeTechnology = async (item: EmployeeTechnology) => {
    if (!confirm(`Удалить технологию «${item.technology_name}» у сотрудника?`)) return
    setError(null)
    try {
      await api.technologies.members.remove(item.technology_id, employeeId)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <section className="mb-6 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Технологии</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Подтверждённые роли сотрудника в технологическом ландшафте.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {items && items.length > 0 && (
            <div className="flex gap-2 text-xs text-slate-500">
              <span>лидер: {items.filter((item) => item.member_role === 'leader').length}</span>
              <span>эксперт: {items.filter((item) => item.member_role === 'expert').length}</span>
              <span>носитель: {items.filter((item) => item.member_role === 'practitioner').length}</span>
            </div>
          )}
          {isAdmin && items && <button onClick={addOpen ? () => setAddOpen(false) : openAdd} className={buttonClass('secondary', 'px-3 py-1.5 text-xs')}>{addOpen ? 'Отмена' : '+ Добавить технологию'}</button>}
        </div>
      </div>
      {addOpen && <form onSubmit={addTechnology} className="mb-4 space-y-3 rounded-xl bg-bg-panel/60 p-3 ring-1 ring-white/5">
        <div><h3 className="text-sm font-medium">Выберите технологию</h3><p className="mt-1 text-xs text-slate-500">Поиск выполняется по всему реестру радара. Результаты загружаются по 50.</p></div>
        <div className="grid gap-2 md:grid-cols-3">
          <input autoFocus value={technologyQuery} onChange={(event) => { setTechnologyQuery(event.target.value); setTechnologyId('') }} placeholder="Название технологии" className="rounded-lg bg-bg-elevated px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent" />
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setTechnologyId('') }} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-sm ring-1 ring-white/5"><option value="">Все направления</option>{meta?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select value={status} onChange={(event) => { setStatus(event.target.value as TechnologyStatus | ''); setTechnologyId('') }} className="rounded-lg bg-bg-elevated px-3 py-1.5 text-sm ring-1 ring-white/5"><option value="">Все статусы</option><option value="adopt">Adopt</option><option value="trial">Trial</option><option value="assess">Assess</option><option value="hold">Hold</option></select>
        </div>
        <div className="max-h-56 overflow-y-auto rounded-xl bg-bg-elevated ring-1 ring-white/5">
          {searching ? <div className="p-3 text-sm text-slate-500">Поиск технологий…</div> : visibleResults.length ? visibleResults.map((technology) => {
            const assigned = assignedIds.has(technology.id)
            const selected = technologyId === String(technology.id)
            return <button key={technology.id} type="button" disabled={assigned} onClick={() => setTechnologyId(String(technology.id))} className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left last:border-0 ${selected ? 'bg-primary-soft ring-1 ring-inset ring-primary/30' : 'hover:bg-surface-subtle'} disabled:cursor-not-allowed disabled:opacity-50`}><TechnologyIcon slug={technology.icon_slug} name={technology.name} size={24} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{technology.name}</div><div className="text-xs text-slate-500">{technology.category.name}</div></div><span className={`rounded px-2 py-0.5 text-xs font-medium uppercase ${TECHNOLOGY_STATUS_VARIANTS[technology.status]}`}>{technology.status}</span>{assigned && <span className="text-xs text-slate-500">Уже добавлена</span>}</button>
          }) : <div className="p-3 text-sm text-slate-500">По выбранным фильтрам технологии не найдены.</div>}
        </div>
        {hasMore && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className={buttonClass('ghost', 'w-full justify-center text-xs')}>{loadingMore ? 'Загрузка…' : 'Показать ещё 50'}</button>}
        <div className="grid gap-3 border-t border-white/5 pt-4 md:grid-cols-[minmax(150px,1fr)_minmax(220px,2fr)_auto]">
          <select value={role} onChange={(event) => setRole(event.target.value as TechnologyMemberRole)} className="rounded-lg border border-outline-strong bg-surface px-3 py-2 text-sm outline-none focus:border-primary"><option value="practitioner">Носитель</option><option value="expert">Эксперт</option><option value="leader">Лидер</option></select>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Комментарий (необязательно)" className="rounded-lg bg-bg-elevated px-3 py-2 text-sm ring-1 ring-white/5" />
          <button disabled={saving || !technologyId} className={buttonClass('primary')}>{saving ? 'Добавление…' : 'Добавить выбранную'}</button>
        </div>
      </form>}
      {error && <div className="mb-4 text-sm text-danger">Не удалось выполнить операцию: {error}</div>}
      {items === null ? (
        !error && <div className="text-sm text-slate-500">Загрузка технологий…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500">Подтверждённые технологии пока не указаны.</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.technology_id}
              className="rounded-xl bg-bg-panel/50 p-3 ring-1 ring-white/5"
            >
              <div className="flex items-start justify-between gap-2">
                <TechnologyIcon slug={item.icon_slug} name={item.technology_name} size={28} />
                <div className="min-w-0">
                  <Link to={`/technology-radar/${item.technology_id}`} className="block truncate font-medium text-slate-100 hover:text-accent">{item.technology_name}</Link>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{item.category.name}</div>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${ROLE_TONE[item.member_role]}`}>
                  {ROLE_LABEL[item.member_role]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 font-medium uppercase ${TECHNOLOGY_STATUS_VARIANTS[item.status]}`}>{item.status}</span>
                {item.products.length > 0 && (
                  <span className="text-slate-500">
                    {item.products.length} {item.products.length === 1 ? 'продукт' : 'продукта'}
                  </span>
                )}
                {item.attention.has_attention && <span className={statusClass('warning')}>⚠ требует внимания</span>}
              </div>
              {item.products.length > 0 && (
                <div className="mt-2 text-xs text-slate-400">
                  {item.products.map((product) => `${product.product_name} · ${product.usage_type}`).join(', ')}
                </div>
              )}
              {item.notes && <div className="mt-2 text-xs text-slate-500">{item.notes}</div>}
              {isAdmin && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
                <select value={item.member_role} onChange={(event) => void updateRole(item, event.target.value as TechnologyMemberRole)} aria-label={`Роль в технологии ${item.technology_name}`} className="rounded bg-bg-elevated px-2 py-1 text-xs ring-1 ring-white/5"><option value="practitioner">Носитель</option><option value="expert">Эксперт</option><option value="leader">Лидер</option></select>
                <button onClick={() => void updateNotes(item)} className="text-xs text-slate-400 hover:text-accent">Комментарий</button>
                <button onClick={() => void removeTechnology(item)} className="ml-auto text-xs text-rose-400 hover:text-rose-300">Удалить</button>
              </div>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
