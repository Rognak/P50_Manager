import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  Department,
  DeptMaturityOverviewItem,
  DeptMaturityTemplate,
  api,
} from '../api/client'
import { useReadOnly } from '../lib/auth-context'

function ratingTone(r: number): string {
  if (r >= 70) return 'text-emerald-400'
  if (r >= 40) return 'text-accent'
  if (r >= 20) return 'text-amber-400'
  return 'text-rose-400'
}

function ratingBg(r: number): string {
  if (r <= 0) return 'rgba(148, 163, 184, 0.06)'
  if (r < 20) return 'rgba(244, 63, 94, 0.32)'
  if (r < 40) return 'rgba(244, 63, 94, 0.18)'
  if (r < 70) return 'rgba(251, 191, 36, 0.32)'
  return 'rgba(52, 212, 200, 0.42)'
}

export function DepartmentList() {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [items, setItems] = useState<Department[]>([])
  const [overview, setOverview] = useState<DeptMaturityOverviewItem[]>([])
  const [template, setTemplate] = useState<DeptMaturityTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const [list, ov] = await Promise.all([
        api.departments.list(),
        api.departments.overview(),
      ])
      setItems(list)
      setOverview(ov)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // template — для подписи направлений в heatmap (берём первый отдел из списка)
  useEffect(() => {
    if (template || items.length === 0) return
    api.departments.maturity
      .template(items[0].id)
      .then(setTemplate)
      .catch(() => undefined)
  }, [items, template])

  const ovById = useMemo(() => {
    const m = new Map<number, DeptMaturityOverviewItem>()
    for (const it of overview) m.set(it.department_id, it)
    return m
  }, [overview])

  const dirCodes = useMemo(() => {
    if (!template) return [] as string[]
    return template.directions.map((d) => d.code)
  }, [template])
  const dirNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const d of template?.directions || []) m[d.code] = d.name
    return m
  }, [template])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const d = await api.departments.create({
        name: name.trim(),
        description: description.trim() || null,
      })
      setCreating(false)
      setName('')
      setDescription('')
      navigate(`/departments/${d.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Тех. зрелость практик</h1>
          <p className="mt-1 text-sm text-slate-500">
            Практики/направления подразделения. По каждой ведём опросник
            технологической зрелости (по 7 направлениям × 5 уровней) с историей
            и динамикой.
          </p>
        </div>
        {!creating && !readOnly && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
          >
            + Создать отдел
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={create}
          className="space-y-3 rounded-2xl bg-bg-elevated p-4"
        >
          <div className="text-sm font-semibold text-slate-200">Новый отдел</div>
          <input
            required
            autoFocus
            placeholder="Название отдела *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <textarea
            rows={2}
            placeholder="Описание (опц.)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              {busy ? '…' : 'Создать'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setName('')
                setDescription('')
              }}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Пока нет отделов. Создайте первый, чтобы начать заполнять опросник
          техзрелости.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">Отдел</th>
                <th className="px-4 py-3">Руководитель</th>
                <th className="px-4 py-3">Период</th>
                <th className="px-4 py-3 text-center">Уровень</th>
                <th className="px-4 py-3 text-right">Рейтинг</th>
                {dirCodes.map((dc) => (
                  <th
                    key={dc}
                    className="px-2 py-3 text-center text-[10px] font-mono"
                    title={dirNames[dc] || dc}
                  >
                    {dc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((d) => {
                const ov = ovById.get(d.id)
                return (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/departments/${d.id}`)}
                    className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                  >
                    <td className="px-4 py-3 font-medium">{d.name}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {d.owner_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {ov?.period || '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {ov ? `L${ov.overall_level}` : '—'}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${
                        ov ? ratingTone(ov.total_rating) : 'text-slate-500'
                      }`}
                    >
                      {ov ? ov.total_rating.toFixed(1) : '—'}
                    </td>
                    {dirCodes.map((dc) => {
                      const r = ov?.rating_by_direction?.[dc] ?? null
                      return (
                        <td
                          key={dc}
                          className="px-2 py-3 text-center text-[11px]"
                          style={{
                            background:
                              r === null ? undefined : ratingBg(r),
                          }}
                        >
                          {r === null ? '—' : r.toFixed(1)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {overview.length >= 1 && (
        <p className="text-xs text-slate-500">
          В таблице — последний опросник каждого отдела. Цвет ячейки в колонках
          {' '}{dirCodes.join(' / ')} — рейтинг этого направления (зелёное —
          высокий, красное — низкий). Наведение на код направления в шапке
          показывает полное название.
        </p>
      )}
    </div>
  )
}
