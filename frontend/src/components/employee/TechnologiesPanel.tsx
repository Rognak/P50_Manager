import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  EmployeeTechnology,
  TechnologyMemberRole,
  TechnologyStatus,
  api,
} from '../../api/client'

const ROLE_LABEL: Record<TechnologyMemberRole, string> = {
  leader: 'Лидер', expert: 'Эксперт', practitioner: 'Носитель',
}
const ROLE_TONE: Record<TechnologyMemberRole, string> = {
  leader: 'bg-violet-500/15 text-violet-300',
  expert: 'bg-accent/15 text-accent',
  practitioner: 'bg-slate-500/15 text-slate-300',
}
const STATUS_TONE: Record<TechnologyStatus, string> = {
  adopt: 'text-teal-300', trial: 'text-amber-300',
  assess: 'text-sky-300', hold: 'text-rose-300',
}

export function TechnologiesPanel({ employeeId }: { employeeId: number }) {
  const [items, setItems] = useState<EmployeeTechnology[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    setError(null)
    api.employees.technologies(employeeId).then(setItems).catch((err) => {
      setError((err as Error).message)
    })
  }, [employeeId])

  return (
    <section className="mb-6 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Технологии</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Подтверждённые роли сотрудника в технологическом ландшафте.
          </p>
        </div>
        {items && items.length > 0 && (
          <div className="flex gap-2 text-xs text-slate-500">
            <span>лидер: {items.filter((item) => item.member_role === 'leader').length}</span>
            <span>эксперт: {items.filter((item) => item.member_role === 'expert').length}</span>
            <span>носитель: {items.filter((item) => item.member_role === 'practitioner').length}</span>
          </div>
        )}
      </div>
      {error ? (
        <div className="text-sm text-red-400">Не удалось загрузить технологии: {error}</div>
      ) : items === null ? (
        <div className="text-sm text-slate-500">Загрузка технологий…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-slate-500">Подтверждённые технологии пока не указаны.</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.technology_id}
              to={`/technology-radar/${item.technology_id}`}
              className="rounded-xl bg-bg-panel/50 p-3 ring-1 ring-white/5 transition hover:bg-bg-panel hover:ring-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">{item.technology_name}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{item.category.name}</div>
                </div>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${ROLE_TONE[item.member_role]}`}>
                  {ROLE_LABEL[item.member_role]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`font-medium uppercase ${STATUS_TONE[item.status]}`}>{item.status}</span>
                {item.products.length > 0 && (
                  <span className="text-slate-500">
                    {item.products.length} {item.products.length === 1 ? 'продукт' : 'продукта'}
                  </span>
                )}
                {item.attention.has_attention && <span className="text-amber-300">⚠ требует внимания</span>}
              </div>
              {item.products.length > 0 && (
                <div className="mt-2 text-xs text-slate-400">
                  {item.products.map((product) => `${product.product_name} · ${product.usage_type}`).join(', ')}
                </div>
              )}
              {item.notes && <div className="mt-2 text-xs text-slate-500">{item.notes}</div>}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
