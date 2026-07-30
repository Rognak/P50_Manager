import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ProductListItem, ProductStatus, api } from '../api/client'
import { useReadOnly } from '../lib/auth-context'

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Активен',
  on_hold: 'На паузе',
  completed: 'Завершён',
}

const STATUS_STYLE: Record<ProductStatus, string> = {
  active: 'bg-accent/15 text-accent',
  on_hold: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-slate-500/15 text-slate-400',
}

export function Products() {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [items, setItems] = useState<ProductListItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')

  const refresh = () =>
    api.products
      .list()
      .then(setItems)
      .catch((e) => setError((e as Error).message))

  useEffect(() => {
    refresh()
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const p = await api.products.create({
        name: name.trim(),
        gitlab_group: group.trim() || null,
      })
      navigate(`/products/${p.id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Продукты</h1>
        {!creating && !readOnly && (
          <button
            onClick={() => setCreating(true)}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90"
          >
            + Создать
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={create}
          className="mb-6 flex flex-wrap gap-2 rounded-2xl bg-bg-elevated p-4"
        >
          <input
            required
            placeholder="Название продукта"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-[260px] rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <input
            placeholder="GitLab-группа (опц.)"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="w-64 rounded-lg bg-bg-panel px-3 py-2 font-mono text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <button className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90">
            Создать
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false)
              setName('')
              setGroup('')
            }}
            className="rounded-lg px-4 py-2 text-slate-400 hover:text-slate-200"
          >
            Отмена
          </button>
        </form>
      )}

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-4 py-3">Название</th>
              <th className="px-4 py-3">GitLab-группа</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3 text-center">Репо</th>
              <th className="px-4 py-3 text-center">Участников</th>
              <th className="px-4 py-3 text-center">В стеке</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Пока нет продуктов
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr
                key={p.id}
                onClick={() => navigate(`/products/${p.id}`)}
                className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
              >
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-slate-400">
                  {p.gitlab_group ? (
                    <span className="font-mono text-[11px]">{p.gitlab_group}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[p.status]}`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">{p.repos_count}</td>
                <td className="px-4 py-3 text-center">{p.members_count}</td>
                <td className="px-4 py-3 text-center">{p.competencies_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
