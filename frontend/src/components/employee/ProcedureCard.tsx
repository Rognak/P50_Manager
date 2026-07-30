import { FormEvent, useCallback, useEffect, useState } from 'react'

import {
  api,
  Meeting,
  Procedure,
  ProcedureListItem,
  ProcedureStatus,
} from '../../api/client'

import { Markdown } from '../Markdown'
import { findActiveJob, JobAborted, pollJob } from '../../lib/jobs'

import { MeetingCard } from './MeetingCard'
import { ProcedureSnapshotView } from './ProcedureSnapshot'

const STATUS_LABEL: Record<ProcedureStatus, string> = {
  open: 'Открыта',
  closed: 'Закрыта',
}

const STATUS_STYLE: Record<ProcedureStatus, string> = {
  open: 'bg-accent/15 text-accent',
  closed: 'bg-slate-500/15 text-slate-400',
}

function formatPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null
  const parts: string[] = []
  if (start) parts.push(new Date(start).toLocaleDateString('ru-RU'))
  if (end) parts.push(new Date(end).toLocaleDateString('ru-RU'))
  return parts.join(' — ')
}

function nextRoundHourLocal(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function NewMeetingInProcedureForm({
  employeeId,
  procedureId,
  onCreated,
  onCancel,
}: {
  employeeId: number
  procedureId: number
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
        procedure_id: procedureId,
      })
      onCreated()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-lg bg-bg-panel/50 p-4 ring-1 ring-white/5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs text-slate-400">Дата и время</div>
          <input
            type="datetime-local"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full rounded bg-bg-panel px-2 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-400">Длительность, мин</div>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full rounded bg-bg-panel px-2 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            {[15, 30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        rows={2}
        value={agenda}
        onChange={(e) => setAgenda(e.target.value)}
        placeholder="Повестка встречи"
        className="w-full rounded bg-bg-panel px-2 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? '…' : 'Добавить встречу'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          Отмена
        </button>
      </div>
    </form>
  )
}

function PreparationBlock({
  employeeId,
  procedure,
  onChanged,
}: {
  employeeId: number
  procedure: Procedure
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(!!procedure.preparation_md)

  // подхват активной задачи генерации после refresh / переключения процедур
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    findActiveJob(employeeId, 'procedure_preparation', procedure.id)
      .then((job) => {
        if (cancelled || !job) return
        setBusy(job.status === 'running' ? 'running' : 'gen')
        return pollJob(
          employeeId,
          job.id,
          (j) => setBusy(j.status === 'running' ? 'running' : 'gen'),
          controller.signal,
        ).then(() => {
          if (!cancelled) {
            onChanged()
            setExpanded(true)
          }
        })
      })
      .catch((e) => {
        if (e instanceof JobAborted) return
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setBusy(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [employeeId, procedure.id, onChanged])

  const titleForFile = `Материалы к процедуре ${procedure.title}.docx`

  const generate = async () => {
    if (
      procedure.preparation_md &&
      !confirm('Перегенерировать материалы? Текущая версия будет заменена.')
    )
      return
    setBusy('gen')
    setError(null)
    try {
      const job = await api.employees.procedures.generatePreparation(
        employeeId,
        procedure.id,
      )
      await pollJob(employeeId, job.id, (j) => {
        if (j.status === 'running') setBusy('running')
      })
      await onChanged()
      setExpanded(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const downloadDocx = async () => {
    setBusy('docx')
    setError(null)
    try {
      await api.employees.procedures.downloadPreparationDocx(
        employeeId,
        procedure.id,
        titleForFile,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const openPrint = async () => {
    setBusy('print')
    setError(null)
    try {
      await api.employees.procedures.openPreparationPrint(employeeId, procedure.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="text-sm font-semibold text-slate-300">
          Материалы для подготовки сотрудника
        </div>
        <div className="flex-1" />
        {procedure.preparation_md && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={downloadDocx}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-40"
            >
              {busy === 'docx' ? '…' : '📄 DOCX'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={openPrint}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-40"
            >
              {busy === 'print' ? '…' : '🖨 PDF'}
            </button>
          </>
        )}
        <button
          type="button"
          disabled={busy !== null}
          onClick={generate}
          className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          {busy === 'gen'
            ? 'В очереди…'
            : busy === 'running'
              ? 'AI думает…'
              : procedure.preparation_md
                ? 'Перегенерировать'
                : '✨ Сгенерировать'}
        </button>
      </div>
      {error && <div className="mb-2 text-xs text-red-400">{error}</div>}
      {!procedure.preparation_md && (
        <div className="rounded-lg bg-bg-panel/40 px-4 py-6 text-center text-xs text-slate-500">
          Материалы ещё не сгенерированы. AI составит документ для сотрудника: темы проверки,
          что повторить, ресурсы для изучения, вопросы для самопроверки.
        </div>
      )}
      {procedure.preparation_md && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mb-2 text-xs text-slate-400 hover:text-slate-200"
          >
            {expanded ? '▾ Скрыть превью' : '▸ Показать превью'}
          </button>
          {expanded && (
            <div className="rounded-lg bg-bg-panel p-5">
              <Markdown content={procedure.preparation_md} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ProcedureCard({
  item,
  employeeId,
  onChanged,
}: {
  item: ProcedureListItem
  employeeId: number
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [procedure, setProcedure] = useState<Procedure | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [title, setTitle] = useState(item.title)
  const [summary, setSummary] = useState('')
  const [showMeetingForm, setShowMeetingForm] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const loadDetail = useCallback(async () => {
    try {
      const proc = await api.employees.procedures.get(employeeId, item.id)
      setProcedure(proc)
      setTitle(proc.title)
      setSummary(proc.summary_md || '')
      // загружаем встречи процедуры
      if (proc.meeting_ids.length > 0) {
        const ms = await Promise.all(
          proc.meeting_ids.map((mid) =>
            api.employees.meetings.get(employeeId, mid).catch(() => null),
          ),
        )
        setMeetings(ms.filter((m): m is Meeting => m !== null))
      } else {
        setMeetings([])
      }
      setLoaded(true)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [employeeId, item.id])

  useEffect(() => {
    if (expanded && !loaded) loadDetail()
  }, [expanded, loaded, loadDetail])

  const dirty = procedure && (title !== procedure.title || summary !== (procedure.summary_md || ''))

  const save = async () => {
    if (!procedure) return
    setSaving('save')
    setError(null)
    try {
      await api.employees.procedures.update(employeeId, procedure.id, {
        title: title.trim(),
        summary_md: summary.trim() || null,
      })
      await loadDetail()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const changeStatus = async (status: ProcedureStatus) => {
    if (!procedure) return
    setSaving(status)
    setError(null)
    try {
      await api.employees.procedures.update(employeeId, procedure.id, { status })
      await loadDetail()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const remove = async () => {
    if (!confirm('Удалить процедуру? Встречи внутри неё останутся, но отвяжутся.')) return
    setSaving('del')
    setError(null)
    try {
      await api.employees.procedures.delete(employeeId, item.id)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setSaving(null)
    }
  }

  const period = formatPeriod(item.period_start, item.period_end)

  return (
    <div className="rounded-2xl bg-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 px-6 py-4 text-left hover:bg-bg-panel/40"
      >
        <div className="flex-1">
          <div className="font-semibold">{item.title}</div>
          <div className="mt-1 text-sm text-slate-400">
            {(item.role_snapshot || item.grade_snapshot) && (
              <>
                <span className="text-slate-500">на тот момент:</span>{' '}
                <span className="text-slate-300">
                  {item.role_snapshot || '—'}
                  {item.grade_snapshot && ` / ${item.grade_snapshot}`}
                </span>
                {' · '}
              </>
            )}
            {period && <>{period} · </>}
            {item.meetings_count} встреч · {item.assessments_count} оценок
          </div>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-semibold ${STATUS_STYLE[item.status]}`}
        >
          {STATUS_LABEL[item.status]}
        </span>
        <span className="text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-white/5 px-6 py-4">
          {!loaded && <div className="text-sm text-slate-500">Загрузка…</div>}
          {procedure && (
            <>
              <label className="block">
                <div className="mb-1 text-sm text-slate-400">Название</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
                />
              </label>

              {/* Встречи процедуры */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold text-slate-300">
                    Встречи в процедуре ({meetings.length})
                  </div>
                  <div className="flex-1" />
                  {!showMeetingForm && procedure.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => setShowMeetingForm(true)}
                      className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
                    >
                      + Добавить встречу
                    </button>
                  )}
                </div>
                {showMeetingForm && (
                  <NewMeetingInProcedureForm
                    employeeId={employeeId}
                    procedureId={procedure.id}
                    onCancel={() => setShowMeetingForm(false)}
                    onCreated={() => {
                      setShowMeetingForm(false)
                      loadDetail()
                    }}
                  />
                )}
                {meetings.length === 0 && !showMeetingForm && (
                  <div className="rounded-lg bg-bg-panel/40 px-4 py-6 text-center text-sm text-slate-500">
                    В этой процедуре ещё нет встреч
                  </div>
                )}
                <div className="space-y-2">
                  {meetings.map((m) => (
                    <MeetingCard
                      key={m.id}
                      meeting={m}
                      employeeId={employeeId}
                      onChanged={() => {
                        loadDetail()
                        onChanged()
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Материалы для подготовки */}
              <PreparationBlock
                employeeId={employeeId}
                procedure={procedure}
                onChanged={loadDetail}
              />

              {/* Срез процедуры */}
              <div>
                <div className="mb-2 text-sm font-semibold text-slate-300">
                  Срез: зафиксировано в рамках процедуры
                </div>
                <ProcedureSnapshotView employeeId={employeeId} procedureId={procedure.id} />
              </div>

              {/* Итоговые заметки по процедуре */}
              <label className="block">
                <div className="mb-1 text-sm text-slate-400">Итоги процедуры (опционально)</div>
                <textarea
                  rows={4}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Общий вывод по серии встреч: что подтверждено, где зона роста, договорённости"
                  className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
                />
              </label>

              {error && <div className="text-sm text-red-400">{error}</div>}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!dirty || saving !== null}
                  onClick={save}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-40"
                >
                  {saving === 'save' ? 'Сохраняем…' : 'Сохранить'}
                </button>
                {procedure.status === 'open' ? (
                  <button
                    type="button"
                    disabled={saving !== null}
                    onClick={() => changeStatus('closed')}
                    className="rounded-lg bg-slate-500/15 px-4 py-2 text-sm text-slate-300 hover:bg-slate-500/25"
                  >
                    Закрыть процедуру
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving !== null}
                    onClick={() => changeStatus('open')}
                    className="rounded-lg bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25"
                  >
                    Переоткрыть
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={remove}
                  className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-red-400"
                >
                  Удалить
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
