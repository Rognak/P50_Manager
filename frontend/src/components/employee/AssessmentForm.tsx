import { FormEvent, useState } from 'react'

import { api, Competency } from '../../api/client'

const LEVELS = [0, 1, 2, 3, 4, 5] as const

export function AssessmentForm({
  employeeId,
  competencies,
  onClose,
  onSaved,
  meetingIds = [],
  title = 'Новая оценка МПК',
  initialScores,
}: {
  employeeId: number
  competencies: Competency[]
  onClose: () => void
  onSaved: () => void
  meetingIds?: number[]
  title?: string
  initialScores?: Record<number, number>
}) {
  const [scores, setScores] = useState<Record<number, number>>(initialScores ?? {})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const toggle = (compId: number, level: number) => {
    setScores((prev) => {
      const next = { ...prev }
      if (next[compId] === level) delete next[compId]
      else next[compId] = level
      return next
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const entries = Object.entries(scores).map(([k, v]) => ({
      competency_id: Number(k),
      level: v,
    }))
    if (entries.length === 0) {
      setError('Добавьте хотя бы одну оценку')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.employees.assessments.create(employeeId, {
        scores: entries,
        notes: notes.trim() || null,
        meeting_ids: meetingIds,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-2 overflow-y-auto px-6 py-4">
            {competencies.map((c) => (
              <div key={c.id} className="rounded-lg bg-bg-panel p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="font-medium">{c.name}</div>
                    {c.criteria.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        className="mt-1 text-xs text-slate-400 hover:text-slate-200"
                      >
                        {expanded === c.id ? 'Скрыть' : 'Показать'} индикаторы ({c.criteria.length})
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => toggle(c.id, lvl)}
                        className={`h-8 w-8 rounded text-sm font-semibold transition ${
                          scores[c.id] === lvl
                            ? 'bg-accent text-bg'
                            : 'bg-bg-elevated text-slate-400 ring-1 ring-white/5 hover:bg-bg'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>
                {expanded === c.id && (
                  <ul className="mt-3 space-y-1 border-t border-white/5 pt-3 text-xs text-slate-400">
                    {c.criteria.map((cr) => (
                      <li key={cr.id}>
                        <span className="text-slate-500">{cr.order_num}.</span> {cr.description}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-white/5 px-6 py-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Заметки к оценке (опционально)"
              rows={2}
              className="mb-3 w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-400">
                Оценено компетенций: {Object.keys(scores).length} из {competencies.length}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-slate-400 hover:text-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
                >
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
