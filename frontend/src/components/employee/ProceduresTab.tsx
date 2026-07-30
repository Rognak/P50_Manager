import { FormEvent, useCallback, useEffect, useState } from 'react'

import { api, Meeting, ProcedureListItem } from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'

import { MeetingCard } from './MeetingCard'
import { ProcedureCard } from './ProcedureCard'

function NewProcedureForm({
  employeeId,
  onCreated,
  onCancel,
}: {
  employeeId: number
  onCreated: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.employees.procedures.create(employeeId, {
        title: title.trim(),
        period_start: start || null,
        period_end: end || null,
      })
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-4 rounded-2xl bg-bg-elevated p-6">
      <label className="block">
        <div className="mb-1 text-sm text-slate-400">Название процедуры</div>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Например: МПК Q1 2026"
          className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
        />
      </label>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-sm text-slate-400">Период: начало (опц.)</div>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-sm text-slate-400">Период: окончание (опц.)</div>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Создаём…' : 'Начать процедуру'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-slate-400 hover:text-slate-200"
        >
          Отмена
        </button>
      </div>
    </form>
  )
}

export function ProceduresTab({ employeeId }: { employeeId: number }) {
  const readOnly = useReadOnly()
  const [procedures, setProcedures] = useState<ProcedureListItem[] | null>(null)
  const [orphanMeetings, setOrphanMeetings] = useState<Meeting[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [procs, meetings] = await Promise.all([
        api.employees.procedures.list(employeeId),
        api.employees.meetings.list(employeeId),
      ])
      setProcedures(procs)
      setOrphanMeetings(meetings.filter((m) => m.procedure_id === null))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [employeeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!procedures) return <div className="text-slate-500">Загрузка…</div>

  const hasOpen = procedures.some((p) => p.status === 'open')

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-sm text-slate-400">
          Процедура МПК = серия встреч, после которой фиксируется срез по компетенциям.
          Итоговый уровень сотрудника собирается из всех оценок (latest-per-competency).
        </div>
        {!formOpen && !readOnly && (
          <button
            onClick={() => setFormOpen(true)}
            disabled={hasOpen}
            title={hasOpen ? 'Уже есть открытая процедура — закройте её перед созданием новой' : ''}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Начать процедуру
          </button>
        )}
      </div>

      {formOpen && (
        <NewProcedureForm
          employeeId={employeeId}
          onCancel={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false)
            refresh()
          }}
        />
      )}

      {procedures.length === 0 && !formOpen && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-10 text-center text-slate-500">
          Пока нет процедур МПК
        </div>
      )}

      {procedures.length > 0 && (
        <div className="space-y-2">
          {procedures.map((p) => (
            <ProcedureCard
              key={p.id}
              item={p}
              employeeId={employeeId}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {orphanMeetings.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-2 text-sm font-semibold text-slate-400">
            Встречи вне процедуры ({orphanMeetings.length})
          </h3>
          <div className="space-y-2">
            {orphanMeetings.map((m) => (
              <MeetingCard
                key={m.id}
                meeting={m}
                employeeId={employeeId}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
