import { useCallback, useEffect, useState } from 'react'

import { api, Recommendation, RecommendationListItem } from '../../api/client'
import { findActiveJob, JobAborted, pollJob } from '../../lib/jobs'
import { Markdown } from '../Markdown'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DetailModal({
  employeeId,
  recommendationId,
  onClose,
  onChanged,
}: {
  employeeId: number
  recommendationId: number
  onClose: () => void
  onChanged: () => void
}) {
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    api.employees.recommendations
      .get(employeeId, recommendationId)
      .then(setRec)
      .catch((e) => setError((e as Error).message))
  }, [employeeId, recommendationId])

  const downloadDocx = async () => {
    if (!rec) return
    setSaving('docx')
    try {
      await api.employees.recommendations.downloadDocx(
        employeeId,
        rec.id,
        `${rec.title}.docx`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const openPrint = async () => {
    if (!rec) return
    setSaving('print')
    try {
      await api.employees.recommendations.openPrint(employeeId, rec.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const remove = async () => {
    if (!rec) return
    if (!confirm('Удалить рекомендацию?')) return
    try {
      await api.employees.recommendations.delete(employeeId, rec.id)
      onChanged()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/5 px-6 py-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{rec?.title || 'Загрузка…'}</h2>
            {rec && (
              <div className="mt-1 text-xs text-slate-500">
                Создано {formatDate(rec.created_at)} · модель {rec.model}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
          {!rec && !error && <div className="text-slate-500">Загрузка…</div>}
          {rec && (
            <div className="rounded-lg bg-bg-panel p-5">
              <Markdown content={rec.content_md} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-6 py-4">
          <button
            type="button"
            disabled={!rec || saving !== null}
            onClick={downloadDocx}
            className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {saving === 'docx' ? '…' : '📄 Скачать DOCX'}
          </button>
          <button
            type="button"
            disabled={!rec || saving !== null}
            onClick={openPrint}
            className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {saving === 'print' ? '…' : '🖨 Печать / PDF'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            disabled={!rec || saving !== null}
            onClick={remove}
            className="text-sm text-slate-500 hover:text-red-400"
          >
            Удалить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

export function RecommendationsSection({ employeeId }: { employeeId: number }) {
  const [list, setList] = useState<RecommendationListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const items = await api.employees.recommendations.list(employeeId)
      setList(items)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [employeeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // подхват активной задачи генерации ИПР после refresh
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    findActiveJob(employeeId, 'employee_recommendation', employeeId)
      .then((job) => {
        if (cancelled || !job) return
        setGenerating(true)
        setPhase(job.status === 'running' ? 'running' : 'queued')
        return pollJob(
          employeeId,
          job.id,
          (j) => setPhase(j.status === 'running' ? 'running' : 'queued'),
          controller.signal,
        ).then((finalJob) => {
          if (cancelled) return
          refresh()
          const recId = (finalJob.result as { recommendation_id?: number })?.recommendation_id
          if (recId) setOpenId(recId)
        })
      })
      .catch((e) => {
        if (e instanceof JobAborted) return
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) {
          setGenerating(false)
          setPhase('idle')
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [employeeId, refresh])

  const [phase, setPhase] = useState<'idle' | 'queued' | 'running'>('idle')

  const generate = async () => {
    setGenerating(true)
    setPhase('queued')
    setError(null)
    try {
      const job = await api.employees.recommendations.generate(employeeId, {})
      const finalJob = await pollJob(employeeId, job.id, (j) => {
        if (j.status === 'running') setPhase('running')
      })
      await refresh()
      const recId = (finalJob.result as { recommendation_id?: number })?.recommendation_id
      if (recId) setOpenId(recId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
      setPhase('idle')
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-400">
          Рекомендации по развитию (ИПР)
        </h3>
        <div className="flex-1" />
        <button
          type="button"
          disabled={generating}
          onClick={generate}
          className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          {generating
            ? phase === 'queued'
              ? 'В очереди…'
              : 'AI думает…'
            : '✨ Сгенерировать ИПР'}
        </button>
      </div>

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

      {!loading && list.length === 0 && !generating && (
        <div className="rounded-2xl bg-bg-elevated px-6 py-8 text-center text-sm text-slate-500">
          ИПР ещё не генерировался. AI соберёт индивидуальный план развития на основе
          оценок МПК, гэпов, истории встреч и доступных ресурсов обучения.
        </div>
      )}

      {list.length > 0 && (
        <div className="space-y-2">
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => setOpenId(r.id)}
              className="flex w-full items-center gap-4 rounded-2xl bg-bg-elevated px-6 py-4 text-left transition hover:bg-bg-panel/40"
            >
              <div className="flex-1">
                <div className="font-medium">{r.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatDate(r.created_at)} · {r.model}
                </div>
              </div>
              <span className="text-slate-500">→</span>
            </button>
          ))}
        </div>
      )}

      {openId !== null && (
        <DetailModal
          employeeId={employeeId}
          recommendationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </section>
  )
}
