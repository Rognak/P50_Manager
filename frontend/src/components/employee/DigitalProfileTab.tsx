import { useCallback, useEffect, useRef, useState } from 'react'

import { DigitalProfilePublic, api } from '../../api/client'
import { findActiveJob, JobAborted, pollJob } from '../../lib/jobs'
import { useReadOnly } from '../../lib/auth-context'
import { Markdown } from '../Markdown'
import { DigitalProfileView } from './DigitalProfileView'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU')
}

export function DigitalProfileTab({ employeeId }: { employeeId: number }) {
  const readOnly = useReadOnly()
  const [profile, setProfile] = useState<DigitalProfilePublic | null | undefined>(
    undefined,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pollingJob, setPollingJob] = useState(false)
  // id активной задачи + аборт-контроллер polling-а (для кнопки «Отменить»)
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    try {
      setProfile(await api.employees.digitalProfile(employeeId))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [employeeId])

  useEffect(() => {
    load()
  }, [load])

  // При входе на вкладку проверяем, не идёт ли уже задача
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    ;(async () => {
      const job = await findActiveJob(employeeId, 'digital_profile').catch(
        () => null,
      )
      if (!job || cancelled) return
      setActiveJobId(job.id)
      setPollingJob(true)
      try {
        await pollJob(employeeId, job.id, undefined, ctrl.signal)
        if (!cancelled) await load()
      } catch (e) {
        if (e instanceof JobAborted) return
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) {
          setPollingJob(false)
          setActiveJobId(null)
        }
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [employeeId, load])

  const regenerate = async () => {
    setBusy(true)
    setError(null)
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    let jobId: number | null = null
    try {
      const job = await api.employees.generateDigitalProfile(employeeId)
      jobId = job.id
      setActiveJobId(job.id)
      setPollingJob(true)
      await pollJob(employeeId, job.id, undefined, ctrl.signal)
      await load()
    } catch (e) {
      if (!(e instanceof JobAborted)) setError((e as Error).message)
    } finally {
      setBusy(false)
      setPollingJob(false)
      setActiveJobId(null)
      void jobId  // suppress unused warning if not needed
    }
  }

  const cancel = async () => {
    if (activeJobId === null) return
    try {
      await api.aiJobs.cancel(employeeId, activeJobId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      // Прерываем polling-цикл сразу — backend уже пометил error
      ctrlRef.current?.abort()
      setPollingJob(false)
      setActiveJobId(null)
      setBusy(false)
    }
  }

  if (profile === undefined) return <div className="text-slate-500">Загрузка…</div>

  const isRunning = busy || pollingJob

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-slate-400">
          AI-сводка по сотруднику на основе всех имеющихся данных: МПК, Self-Review,
          dev-метрики, извлечённые из PR-ов компетенции, проекты.
        </p>
        {!readOnly && (
          <div className="flex gap-2">
            {isRunning && activeJobId !== null && (
              <button
                onClick={cancel}
                className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/25"
              >
                Отменить
              </button>
            )}
            <button
              onClick={regenerate}
              disabled={isRunning}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              {isRunning
                ? 'AI работает…'
                : profile
                  ? 'Перегенерировать'
                  : 'Сгенерировать профиль'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-500/20">
          Ошибка: {error}
        </div>
      )}

      {!profile && !pollingJob && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Цифровой профиль ещё не генерировался. Нажмите «Сгенерировать» —
          AI соберёт сводку с разрывом «заявлено vs факт», сильными/слабыми
          сторонами и рекомендуемыми действиями.
        </div>
      )}

      {pollingJob && !profile && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-amber-300">
          Генерация идёт… Если затянется — нажмите «Отменить». Жёсткий
          таймаут — 6 минут.
        </div>
      )}

      {profile && (
        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            Сгенерирован: {formatDateTime(profile.generated_at)} ·
            модель: <span className="font-mono">{profile.model}</span>
          </div>
          {profile.content_json ? (
            <DigitalProfileView content={profile.content_json} />
          ) : (
            <div className="rounded-2xl bg-bg-elevated p-5">
              {/* legacy: профиль был сгенерирован старой версией без structured-JSON */}
              <Markdown content={profile.content_md} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
