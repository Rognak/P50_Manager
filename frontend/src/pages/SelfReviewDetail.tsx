import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  AIJob,
  SelfReview,
  SelfReviewAiKind,
  SelfReviewStatus,
  api,
} from '../api/client'
import { Markdown } from '../components/Markdown'
import { useReadOnly } from '../lib/auth-context'
import { findActiveJob, JobAborted, pollJob } from '../lib/jobs'

const STATUS_LABEL: Record<SelfReviewStatus, string> = {
  draft: 'черновик',
  submitted: 'отправлен',
  closed: 'закрыт',
}

const AI_KINDS: {
  kind: SelfReviewAiKind
  label: string
  shortHint: string
  field: keyof Pick<
    SelfReview,
    | 'ai_topics_md'
    | 'ai_comparison_md'
    | 'ai_burnout_md'
    | 'ai_calibration_md'
    | 'ai_drafting_md'
  >
  jobKind:
    | 'self_review_topics'
    | 'self_review_compare'
    | 'self_review_burnout'
    | 'self_review_calibration'
    | 'self_review_draft'
  requiresFile: boolean
}[] = [
  {
    kind: 'topics',
    label: 'Темы для 1:1',
    shortHint: 'вопросы, расхождения, флаги',
    field: 'ai_topics_md',
    jobKind: 'self_review_topics',
    requiresFile: true,
  },
  {
    kind: 'compare',
    label: 'Сравнить с прошлым годом',
    shortHint: 'дифф целей, динамика, запросы',
    field: 'ai_comparison_md',
    jobKind: 'self_review_compare',
    requiresFile: true,
  },
  {
    kind: 'burnout',
    label: 'Выгорание / вовлечённость',
    shortHint: 'сигналы из текста',
    field: 'ai_burnout_md',
    jobKind: 'self_review_burnout',
    requiresFile: true,
  },
  {
    kind: 'calibration',
    label: 'Калибровка с МПК',
    shortHint: 'переоценка / недооценка',
    field: 'ai_calibration_md',
    jobKind: 'self_review_calibration',
    requiresFile: true,
  },
  {
    kind: 'draft',
    label: 'Черновик от AI',
    shortHint: 'если сотрудник не заполнил',
    field: 'ai_drafting_md',
    jobKind: 'self_review_draft',
    requiresFile: false,
  },
]

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SelfReviewDetail() {
  const readOnly = useReadOnly()
  const { employeeId, reviewId } = useParams<{
    employeeId: string
    reviewId: string
  }>()
  const empId = Number(employeeId)
  const rvId = Number(reviewId)
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [rv, setRv] = useState<SelfReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [viewerHtml, setViewerHtml] = useState<string | null>(null)
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [activeAi, setActiveAi] = useState<Set<SelfReviewAiKind>>(new Set())
  const [aiErrors, setAiErrors] = useState<Partial<Record<SelfReviewAiKind, string>>>({})
  const [showAi, setShowAi] = useState<SelfReviewAiKind | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [scoreDraft, setScoreDraft] = useState<{ p: string; c: string }>({
    p: '',
    c: '',
  })
  const [scheduledDraft, setScheduledDraft] = useState<string>('')

  const load = useCallback(async () => {
    try {
      const r = await api.selfReviews.get(empId, rvId)
      setRv(r)
      setNotesDraft(r.manager_notes_md || '')
      setScoreDraft({
        p: r.project_score?.toString() ?? '',
        c: r.company_score?.toString() ?? '',
      })
      // datetime-local нужен формат YYYY-MM-DDTHH:mm
      setScheduledDraft(
        r.scheduled_1on1_at
          ? new Date(r.scheduled_1on1_at).toISOString().slice(0, 16)
          : '',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [empId, rvId])

  useEffect(() => {
    load()
  }, [load])

  // viewer: HTML-рендер через mammoth (бэк). Рендер не pixel-perfect,
  // но даёт читаемые таблицы, заголовки и списки на любых шаблонах.
  useEffect(() => {
    if (!rv?.has_source) {
      setViewerHtml(null)
      return
    }
    setViewerError(null)
    let cancelled = false
    api.selfReviews
      .fetchViewerHtml(empId, rvId)
      .then((html) => {
        if (!cancelled) setViewerHtml(html)
      })
      .catch((e) => {
        if (!cancelled) setViewerError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [empId, rvId, rv?.has_source, rv?.source_uploaded_at])

  // resume polling for any AI jobs in flight
  useEffect(() => {
    if (!rv) return
    let cancelled = false
    const ctrl = new AbortController()
    ;(async () => {
      for (const ai of AI_KINDS) {
        const job = await findActiveJob(empId, ai.jobKind, rvId).catch(() => null)
        if (!job || cancelled) continue
        setActiveAi((s) => new Set([...s, ai.kind]))
        setAiErrors((es) => ({ ...es, [ai.kind]: undefined }))
        try {
          await pollJob(empId, job.id, undefined, ctrl.signal)
        } catch (e) {
          if (e instanceof JobAborted) return
          if (!cancelled) {
            setAiErrors((es) => ({ ...es, [ai.kind]: (e as Error).message }))
          }
        } finally {
          if (!cancelled) {
            setActiveAi((s) => {
              const next = new Set(s)
              next.delete(ai.kind)
              return next
            })
            await load()
          }
        }
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [empId, rvId, rv?.id, load])

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!rv) return null

  const onUpload = async (file: File) => {
    setUploading(true)
    try {
      const updated = await api.selfReviews.uploadSource(empId, rvId, file)
      setRv(updated)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeFile = async () => {
    if (!confirm('Удалить приложенный файл?')) return
    try {
      const updated = await api.selfReviews.deleteSource(empId, rvId)
      setRv(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const downloadFile = async () => {
    if (!rv.source_filename) return
    try {
      await api.selfReviews.downloadSource(empId, rvId, rv.source_filename)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const setStatus = async (status: SelfReviewStatus) => {
    try {
      const updated = await api.selfReviews.update(empId, rvId, { status })
      setRv(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const saveScores = async () => {
    const p = scoreDraft.p === '' ? null : Math.max(1, Math.min(10, Number(scoreDraft.p)))
    const c = scoreDraft.c === '' ? null : Math.max(1, Math.min(10, Number(scoreDraft.c)))
    try {
      const updated = await api.selfReviews.update(empId, rvId, {
        project_score: p,
        company_score: c,
      })
      setRv(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const saveSchedule = async () => {
    const iso = scheduledDraft ? new Date(scheduledDraft).toISOString() : null
    try {
      const updated = await api.selfReviews.update(empId, rvId, {
        scheduled_1on1_at: iso,
      })
      setRv(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const saveNotes = async () => {
    try {
      const updated = await api.selfReviews.update(empId, rvId, {
        manager_notes_md: notesDraft,
      })
      setRv(updated)
      setEditingNotes(false)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const runAi = async (kind: SelfReviewAiKind) => {
    setActiveAi((s) => new Set([...s, kind]))
    setAiErrors((es) => ({ ...es, [kind]: undefined }))
    const ctrl = new AbortController()
    try {
      const job: AIJob = await api.selfReviews.enqueueAi(empId, rvId, kind)
      await pollJob(empId, job.id, undefined, ctrl.signal)
      await load()
      setShowAi(kind)
    } catch (e) {
      if (!(e instanceof JobAborted)) {
        setAiErrors((es) => ({ ...es, [kind]: (e as Error).message }))
      }
    } finally {
      setActiveAi((s) => {
        const next = new Set(s)
        next.delete(kind)
        return next
      })
    }
  }

  const deleteReview = async () => {
    if (!confirm('Удалить ревью полностью?')) return
    try {
      await api.selfReviews.delete(empId, rvId)
      navigate('/self-review')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const aiContent = (k: SelfReviewAiKind | null): string | null => {
    if (k === null) return null
    const cfg = AI_KINDS.find((a) => a.kind === k)
    if (!cfg) return null
    return rv[cfg.field] || null
  }

  const showAiContent = aiContent(showAi)

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate('/self-review')}
          className="mb-3 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Self-Review
        </button>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{rv.employee_name}</h1>
          <span className="text-slate-400">· Self-Review {rv.year}</span>
          <span
            className={
              'rounded px-2 py-0.5 text-xs ' +
              (rv.status === 'draft'
                ? 'bg-amber-500/15 text-amber-300'
                : rv.status === 'submitted'
                  ? 'bg-accent/15 text-accent'
                  : 'bg-emerald-500/15 text-emerald-300')
            }
          >
            {STATUS_LABEL[rv.status]}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          {!readOnly && rv.status === 'draft' && (
            <button
              onClick={() => setStatus('submitted')}
              className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25"
            >
              Пометить «отправлен»
            </button>
          )}
          {!readOnly && rv.status !== 'closed' && (
            <button
              onClick={() => setStatus('closed')}
              className="rounded bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
            >
              Закрыть после 1:1
            </button>
          )}
          {!readOnly && rv.status === 'closed' && (
            <button
              onClick={() => setStatus('submitted')}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              переоткрыть
            </button>
          )}
          <span className="ml-2 h-4 w-px bg-white/10" />
          <button
            onClick={() =>
              api.selfReviews.downloadSummaryDocx(
                empId,
                rvId,
                `Self-Review ${rv.year} ${rv.employee_name} — сводка.docx`,
              )
            }
            className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
            title="Сводка по итогам 1:1: scores + ваши заметки + AI-выводы"
          >
            Сводка .docx
          </button>
          <button
            onClick={() =>
              api.selfReviews.openSummaryPrint(empId, rvId).catch((e) => alert((e as Error).message))
            }
            className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
            title="Та же сводка в печатной HTML-версии (можно сохранить как PDF)"
          >
            Сводка PDF/печать
          </button>
          {!readOnly && (
            <button
              onClick={deleteReview}
              className="ml-auto text-xs text-slate-500 hover:text-rose-400"
            >
              удалить
            </button>
          )}
        </div>
      </div>

      {/* Файл */}
      <section className="rounded-2xl bg-bg-elevated p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Файл Self-Review
          </h2>
          {rv.has_source && (
            <div className="text-xs text-slate-500">
              {rv.source_filename}
              {rv.source_size_bytes && (
                <> · {Math.round(rv.source_size_bytes / 1024)} КБ</>
              )}
              {rv.source_uploaded_at && (
                <> · {formatDateTime(rv.source_uploaded_at)}</>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUpload(f)
            }}
          />
          {!readOnly && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              {uploading ? 'загрузка…' : rv.has_source ? 'Заменить .docx' : 'Загрузить .docx'}
            </button>
          )}
          {rv.has_source && (
            <>
              <button
                onClick={downloadFile}
                className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-accent"
              >
                Скачать
              </button>
              {!readOnly && (
                <button
                  onClick={removeFile}
                  className="text-sm text-slate-500 hover:text-rose-400"
                >
                  Удалить файл
                </button>
              )}
            </>
          )}
        </div>

        {rv.has_source && (
          <div className="mt-4">
            {viewerError && (
              <div className="mb-2 text-xs text-rose-400">
                Ошибка отображения: {viewerError}. Файл можно скачать кнопкой выше.
              </div>
            )}
            {viewerHtml && (
              <div className="max-h-[800px] overflow-auto rounded-xl bg-bg-panel/40 p-5 ring-1 ring-white/5">
                <div
                  className="sr-viewer"
                  dangerouslySetInnerHTML={{ __html: viewerHtml }}
                />
              </div>
            )}
          </div>
        )}
        {!rv.has_source && (
          <div className="mt-3 text-sm text-slate-500">
            Загрузите .docx (шаблон Self-Review). Файл хранится как есть и отображается
            ниже «как в Word»; AI-задачи извлекают из него текст.
          </div>
        )}
      </section>

      {/* Численные оценки */}
      <section className="rounded-2xl bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Самооценки 1–10
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              По проекту
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={scoreDraft.p}
              onChange={(e) => setScoreDraft({ ...scoreDraft, p: e.target.value })}
              onBlur={saveScores}
              className="w-32 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              По компании
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={scoreDraft.c}
              onChange={(e) => setScoreDraft({ ...scoreDraft, c: e.target.value })}
              onBlur={saveScores}
              className="w-32 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Заполняйте по итогам разговора с сотрудником — нужны для дашборд-агрегатов.
        </div>
      </section>

      {/* 1:1 встреча */}
      <section className="rounded-2xl bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          1:1 по итогам ревью
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="datetime-local"
            value={scheduledDraft}
            onChange={(e) => setScheduledDraft(e.target.value)}
            className="rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <button
            onClick={saveSchedule}
            className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
          >
            {rv.scheduled_1on1_at ? 'Обновить' : 'Запланировать'}
          </button>
          {rv.scheduled_1on1_at && (
            <>
              <span className="text-xs text-slate-400">
                запланировано:{' '}
                {new Date(rv.scheduled_1on1_at).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button
                onClick={() => {
                  setScheduledDraft('')
                  api.selfReviews
                    .update(empId, rvId, { scheduled_1on1_at: null })
                    .then(setRv)
                    .catch((e) => alert((e as Error).message))
                }}
                className="text-xs text-slate-500 hover:text-rose-400"
              >
                снять
              </button>
            </>
          )}
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Встреча появится в виджете «Ближайшие встречи» на дашборде. После
          разговора — пометьте ревью «закрыто» (кнопка вверху).
        </div>
      </section>

      {/* Заметки руководителя */}
      <section className="rounded-2xl bg-bg-elevated p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Заметки руководителя
          </h2>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-xs text-slate-400 hover:text-accent"
            >
              {rv.manager_notes_md ? 'редактировать' : '+ добавить'}
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              rows={8}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Markdown. Договорённости, action items, наблюдения, на что обратить внимание."
              className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={saveNotes}
                className="rounded bg-accent px-3 py-1.5 text-sm text-bg hover:bg-accent/90"
              >
                Сохранить
              </button>
              <button
                onClick={() => {
                  setNotesDraft(rv.manager_notes_md || '')
                  setEditingNotes(false)
                }}
                className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : rv.manager_notes_md ? (
          <Markdown content={rv.manager_notes_md} />
        ) : (
          <div className="text-sm text-slate-500">Заметок ещё нет.</div>
        )}
      </section>

      {/* AI-помогатор */}
      <section className="rounded-2xl bg-bg-elevated p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          AI-помощник
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {AI_KINDS.map((cfg) => {
            const has = !!rv[cfg.field]
            const running = activeAi.has(cfg.kind)
            const blocked = cfg.requiresFile && !rv.has_source
            const err = aiErrors[cfg.kind]
            return (
              <div
                key={cfg.kind}
                className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{cfg.label}</div>
                    <div className="text-xs text-slate-500">{cfg.shortHint}</div>
                  </div>
                  {has && (
                    <button
                      onClick={() =>
                        setShowAi(showAi === cfg.kind ? null : cfg.kind)
                      }
                      className="text-xs text-accent hover:underline"
                    >
                      {showAi === cfg.kind ? 'скрыть' : 'показать'}
                    </button>
                  )}
                </div>
                <button
                  disabled={running || blocked}
                  onClick={() => runAi(cfg.kind)}
                  className="mt-2 rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-30"
                  title={
                    blocked
                      ? 'Нужно загрузить файл .docx'
                      : has
                        ? 'Перегенерировать'
                        : 'Сгенерировать'
                  }
                >
                  {running
                    ? 'генерация…'
                    : err
                      ? 'попробовать ещё раз'
                      : has
                        ? 'обновить'
                        : 'сгенерировать'}
                </button>
                {err && !running && (
                  <div className="mt-1 text-[11px] text-rose-400" title={err}>
                    ошибка: {err.length > 80 ? err.slice(0, 80) + '…' : err}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {showAiContent && (
          <div className="mt-4 rounded-xl bg-bg-panel/40 p-5 ring-1 ring-white/5">
            <Markdown content={showAiContent} />
          </div>
        )}
      </section>
    </div>
  )
}
