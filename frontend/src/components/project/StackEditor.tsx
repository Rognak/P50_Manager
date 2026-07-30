import { useEffect, useState } from 'react'

import { api, Competency, ProductStackItem } from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'

const LEVELS = [1, 2, 3, 4, 5] as const

export function StackEditor({
  productId,
  initial,
  onChanged,
}: {
  productId: number
  initial: ProductStackItem[]
  onChanged: () => void
}) {
  const readOnly = useReadOnly()
  const [allComps, setAllComps] = useState<Competency[] | null>(null)
  const [stack, setStack] = useState<Map<number, number>>(
    () => new Map(initial.map((i) => [i.competency_id, i.target_level])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    api.mpk.competencies().then(setAllComps).catch(() => undefined)
  }, [])

  useEffect(() => {
    setStack(new Map(initial.map((i) => [i.competency_id, i.target_level])))
  }, [initial])

  const toggle = (cid: number) => {
    setStack((prev) => {
      const next = new Map(prev)
      if (next.has(cid)) next.delete(cid)
      else next.set(cid, 3)
      return next
    })
  }

  const setLevel = (cid: number, lvl: number) => {
    setStack((prev) => {
      const next = new Map(prev)
      next.set(cid, lvl)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.products.setStack(
        productId,
        Array.from(stack.entries()).map(([cid, lvl]) => ({
          competency_id: cid,
          target_level: lvl,
        })),
      )
      setEditing(false)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-sm text-slate-400">
            В стеке: <span className="text-slate-200">{initial.length}</span>{' '}
            компетенций
          </div>
          <div className="flex-1" />
          {!readOnly && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
            >
              Редактировать стек
            </button>
          )}
        </div>
        {initial.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[...initial]
              .sort((a, b) => a.competency_name.localeCompare(b.competency_name))
              .map((s) => (
                <span
                  key={s.competency_id}
                  className="rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5"
                >
                  {s.competency_name}{' '}
                  <span className="text-accent">L{s.target_level}</span>
                </span>
              ))}
          </div>
        )}
      </div>
    )
  }

  if (!allComps) return <div className="text-sm text-slate-500">Загрузка…</div>

  const sorted = [...allComps].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="space-y-3 rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="text-sm text-slate-400">
        Отметьте компетенции и задайте целевой уровень. Влияет на матрицу,
        coverage, risk score.
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg bg-bg-panel/30 p-2">
        {sorted.map((c) => {
          const inStack = stack.has(c.id)
          const lvl = stack.get(c.id) ?? 3
          return (
            <div
              key={c.id}
              className={`flex items-center gap-3 rounded px-3 py-2 text-sm ${
                inStack ? 'bg-accent/5' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={inStack}
                onChange={() => toggle(c.id)}
                className="h-4 w-4 accent-accent"
              />
              <div className="flex-1">{c.name}</div>
              {inStack && (
                <div className="flex gap-1">
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLevel(c.id, l)}
                      className={`h-7 w-7 rounded text-sm font-semibold ${
                        lvl === l
                          ? 'bg-accent text-bg'
                          : 'bg-bg-elevated text-slate-400 ring-1 ring-white/5 hover:bg-bg'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? '…' : 'Сохранить'}
        </button>
        <button
          onClick={() => {
            setStack(new Map(initial.map((i) => [i.competency_id, i.target_level])))
            setEditing(false)
          }}
          className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
        >
          Отмена
        </button>
        <div className="flex-1" />
        <span className="self-center text-xs text-slate-500">
          выбрано: {stack.size}
        </span>
      </div>
    </div>
  )
}
