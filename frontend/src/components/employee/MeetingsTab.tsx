import { FormEvent, useCallback, useEffect, useState } from 'react'

import { api, Meeting } from '../../api/client'

import { MeetingCard } from './MeetingCard'

function nextRoundHourLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function NewMeetingForm({
  employeeId,
  onCreated,
  onCancel,
}: {
  employeeId: number
  onCreated: () => void
  onCancel: () => void
}) {
  const [when, setWhen] = useState(nextRoundHourLocal())
  const [duration, setDuration] = useState(30)
  const [agenda, setAgenda] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.employees.meetings.create(employeeId, {
        scheduled_at: new Date(when).toISOString(),
        duration_min: duration,
        agenda_md: agenda.trim() || null,
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="block">
          <div className="mb-1 text-sm text-slate-400">Дата и время</div>
          <input
            type="datetime-local"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-sm text-slate-400">Длительность, мин</div>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <div className="mb-1 text-sm text-slate-400">Повестка</div>
        <textarea
          rows={3}
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          placeholder="Что обсуждаем, какие компетенции в фокусе…"
          className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
        />
      </label>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Запланировать'}
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

export function MeetingsTab({ employeeId }: { employeeId: number }) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const list = await api.employees.meetings.list(employeeId)
      setMeetings(list)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [employeeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!meetings) return <div className="text-slate-500">Загрузка…</div>

  const now = Date.now()
  const upcoming = meetings.filter(
    (m) => m.status === 'planned' && new Date(m.scheduled_at).getTime() >= now,
  )
  const archive = meetings.filter(
    (m) => m.status !== 'planned' || new Date(m.scheduled_at).getTime() < now,
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-slate-400">
          Встречи 1:1 по МПК. В раскрытой карточке — AI-вопросы, задания и автосуммаризация.
        </div>
        {!formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90"
          >
            + Запланировать
          </button>
        )}
      </div>

      {formOpen && (
        <NewMeetingForm
          employeeId={employeeId}
          onCancel={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false)
            refresh()
          }}
        />
      )}

      {meetings.length === 0 && !formOpen && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-10 text-center text-slate-500">
          Пока нет встреч
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-400">
            Предстоящие ({upcoming.length})
          </h3>
          <div className="space-y-2">
            {upcoming.map((m) => (
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

      {archive.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-400">
            Архив ({archive.length})
          </h3>
          <div className="space-y-2">
            {archive.map((m) => (
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
