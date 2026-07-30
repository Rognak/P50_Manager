import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  AIJob,
  Candidate,
  CandidateAiKind,
  CandidateStage,
  Grade,
  Role,
  VacancyListItem,
  api,
} from '../api/client'
import { Markdown } from '../components/Markdown'
import { UpcomingMeetingsWidget } from '../components/UpcomingMeetingsWidget'
import { ResumeViewer } from '../components/candidate/ResumeViewer'
import { MeetingsTab } from '../components/employee/MeetingsTab'
import { useReadOnly } from '../lib/auth-context'
import { findActiveJob, JobAborted, pollJob } from '../lib/jobs'

const STAGE_LABEL: Record<CandidateStage, string> = {
  new: 'новый',
  screening: 'скрининг',
  interview: 'интервью',
  offer: 'оффер',
  hired: 'нанят',
  rejected: 'отклонён',
}

const STAGE_CLR: Record<CandidateStage, string> = {
  new: 'bg-slate-500/15 text-slate-300',
  screening: 'bg-amber-500/15 text-amber-300',
  interview: 'bg-accent/15 text-accent',
  offer: 'bg-accent/15 text-accent',
  hired: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-rose-500/15 text-rose-300',
}

const STAGES: CandidateStage[] = [
  'new',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
]

const AI_TASKS: {
  kind: CandidateAiKind
  label: string
  hint: string
  field: 'ai_screening_reasoning_md'
  jobKind: 'candidate_screening'
  needsResume: boolean
}[] = [
  {
    kind: 'screening',
    label: 'AI-скрининг резюме',
    hint: 'балл соответствия, рекомендация к собеседованию, обоснование',
    field: 'ai_screening_reasoning_md',
    jobKind: 'candidate_screening',
    needsResume: true,
  },
]

type Tab = 'overview' | 'meetings'

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm transition ${
        active
          ? 'border-b-2 border-accent text-accent'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

export function HiringDetail() {
  const readOnly = useReadOnly()
  const { id } = useParams<{ id: string }>()
  const candId = Number(id)
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [c, setC] = useState<Candidate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [uploading, setUploading] = useState(false)
  const [activeAi, setActiveAi] = useState<Set<CandidateAiKind>>(new Set())
  const [aiErrors, setAiErrors] = useState<Partial<Record<CandidateAiKind, string>>>({})
  const [showAi, setShowAi] = useState<CandidateAiKind | null>(null)

  // edit mode
  const [editing, setEditing] = useState(false)
  const [editFullName, setEditFullName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPosition, setEditPosition] = useState('')
  const [editSource, setEditSource] = useState('')
  const [editVacancyId, setEditVacancyId] = useState<number | ''>('')
  const [editRoleId, setEditRoleId] = useState<number | ''>('')
  const [editGradeId, setEditGradeId] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [vacancies, setVacancies] = useState<VacancyListItem[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [grades, setGrades] = useState<Grade[]>([])

  const load = useCallback(async () => {
    try {
      const fetched = await api.candidates.get(candId)
      setC(fetched)
      setEditFullName(fetched.full_name)
      setEditEmail(fetched.email || '')
      setEditPosition(fetched.position || '')
      setEditSource(fetched.source || '')
      setEditVacancyId(fetched.vacancy?.id ?? '')
      setEditRoleId(fetched.expected_role?.id ?? '')
      setEditGradeId(fetched.expected_grade?.id ?? '')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [candId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    // Для редактирования: список всех вакансий (открытые + закрытые) и справочники
    api.vacancies.list().then(setVacancies).catch(() => undefined)
    api.mpk.roles().then(setRoles).catch(() => undefined)
    api.mpk.grades().then(setGrades).catch(() => undefined)
  }, [])

  // resume polling
  useEffect(() => {
    if (!c) return
    let cancelled = false
    const ctrl = new AbortController()
    ;(async () => {
      for (const t of AI_TASKS) {
        const job = await findActiveJob(c.employee_id, t.jobKind, c.employee_id).catch(
          () => null,
        )
        if (!job || cancelled) continue
        setActiveAi((s) => new Set([...s, t.kind]))
        try {
          await pollJob(c.employee_id, job.id, undefined, ctrl.signal)
        } catch (e) {
          if (e instanceof JobAborted) return
          if (!cancelled) {
            setAiErrors((es) => ({ ...es, [t.kind]: (e as Error).message }))
          }
        } finally {
          if (!cancelled) {
            setActiveAi((s) => {
              const next = new Set(s)
              next.delete(t.kind)
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
  }, [c?.id, load])

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!c) return null

  const onUpload = async (file: File) => {
    setUploading(true)
    try {
      const updated = await api.candidates.uploadResume(c.id, file)
      setC(updated)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    if (!c) return
    setEditError(null)
    if (!editFullName.trim()) {
      setEditError('ФИО обязательно')
      return
    }
    setSaving(true)
    try {
      const updated = await api.candidates.update(c.id, {
        full_name: editFullName.trim(),
        email: editEmail.trim() || null,
        position: editPosition.trim() || null,
        source: editSource.trim() || null,
        vacancy_id: editVacancyId === '' ? null : Number(editVacancyId),
        expected_role_id: editRoleId === '' ? null : Number(editRoleId),
        expected_grade_id: editGradeId === '' ? null : Number(editGradeId),
      })
      setC(updated)
      setEditing(false)
    } catch (e) {
      setEditError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => {
    if (!c) return
    setEditing(false)
    setEditFullName(c.full_name)
    setEditEmail(c.email || '')
    setEditPosition(c.position || '')
    setEditSource(c.source || '')
    setEditVacancyId(c.vacancy?.id ?? '')
    setEditRoleId(c.expected_role?.id ?? '')
    setEditGradeId(c.expected_grade?.id ?? '')
    setEditError(null)
  }

  const setStage = async (stage: CandidateStage) => {
    try {
      const updated = await api.candidates.update(c.id, { stage })
      setC(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const hire = async () => {
    if (!confirm(`Нанять ${c.full_name}?\n\nКандидат превращается в действующего сотрудника, в карточке появляется hired_at = сегодня. Карточка кандидата остаётся как история.`))
      return
    try {
      const updated = await api.candidates.hire(c.id)
      setC(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const reject = async () => {
    const reason = prompt('Причина отказа (видна только руководителю, для архива):', '')
    if (reason === null) return
    try {
      const updated = await api.candidates.reject(c.id, reason.trim() || null)
      setC(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const downloadResume = () => {
    if (c.resume_filename)
      api.candidates.downloadResume(c.id, c.resume_filename).catch((e) => alert((e as Error).message))
  }

  const removeResume = async () => {
    if (!confirm('Удалить резюме?')) return
    try {
      const updated = await api.candidates.deleteResume(c.id)
      setC(updated)
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const removeCandidate = async () => {
    if (!confirm('Удалить кандидата полностью? История интервью и резюме также удалятся.'))
      return
    try {
      await api.candidates.delete(c.id)
      navigate('/hiring')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const runAi = async (kind: CandidateAiKind) => {
    setActiveAi((s) => new Set([...s, kind]))
    setAiErrors((es) => ({ ...es, [kind]: undefined }))
    const ctrl = new AbortController()
    try {
      const job: AIJob = await api.candidates.enqueueAi(c.id, kind)
      await pollJob(c.employee_id, job.id, undefined, ctrl.signal)
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

  const aiContent = (k: CandidateAiKind | null): string | null => {
    if (k === null) return null
    const cfg = AI_TASKS.find((a) => a.kind === k)
    if (!cfg) return null
    return c[cfg.field] || null
  }
  const showAiContent = aiContent(showAi)
  const isClosed = c.stage === 'hired' || c.stage === 'rejected'

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/hiring')}
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← Кандидаты
      </button>

      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{c.full_name}</h1>
          <span className={`rounded px-2 py-0.5 text-xs ${STAGE_CLR[c.stage]}`}>
            {STAGE_LABEL[c.stage]}
          </span>
          {c.feedback_decision && (
            <span
              className={
                'text-xs ' +
                (c.feedback_decision === 'positive'
                  ? 'text-emerald-400'
                  : 'text-rose-400')
              }
            >
              решение: {c.feedback_decision === 'positive' ? 'позитивно' : 'негативно'}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-slate-400">
          {c.position || '—'}
          {c.expected_role && ` · ожидание: ${c.expected_role.name}`}
          {c.expected_grade && ` · ${c.expected_grade.code}`}
          {c.source && ` · источник: ${c.source}`}
          {c.email && ` · ${c.email}`}
        </div>

        {c.vacancy && (
          <div className="mt-2 text-sm">
            <span className="text-slate-500">Вакансия: </span>
            <button
              onClick={() => navigate(`/vacancies/${c.vacancy!.id}`)}
              className="text-accent hover:underline"
            >
              {c.vacancy.title}
            </button>
            {c.vacancy.project_name && (
              <span className="text-slate-500">
                {' '}· проект {c.vacancy.project_name}
              </span>
            )}
            <span
              className={
                'ml-2 rounded px-1.5 py-0.5 text-[10px] ' +
                (c.vacancy.status === 'open'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-500/15 text-slate-400')
              }
            >
              {c.vacancy.status === 'open' ? 'открыта' : 'закрыта'}
            </span>
          </div>
        )}

        {c.ai_screening_recommended !== null && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {c.ai_screening_recommended === true ? (
              <span className="rounded bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300">
                AI-скрининг: ✓ рекомендован к собеседованию
              </span>
            ) : (
              <span className="rounded bg-rose-500/15 px-2 py-1 text-xs font-semibold text-rose-300">
                AI-скрининг: ✗ не рекомендован
              </span>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {!readOnly && !isClosed && (
            <select
              value={c.stage}
              onChange={(e) => setStage(e.target.value as CandidateStage)}
              className="rounded bg-bg-panel px-3 py-1 text-xs text-slate-300 ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              {STAGES.filter((s) => s !== 'hired' && s !== 'rejected').map((s) => (
                <option key={s} value={s}>
                  стадия: {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          )}
          {!readOnly && !isClosed && (
            <>
              <button
                onClick={hire}
                className="rounded bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
              >
                Нанять
              </button>
              <button
                onClick={reject}
                className="rounded bg-rose-500/15 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/25"
              >
                Отклонить
              </button>
            </>
          )}
          {c.stage === 'hired' && (
            <button
              onClick={() => navigate(`/employees/${c.employee_id}`)}
              className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25"
            >
              открыть карточку сотрудника →
            </button>
          )}
          {!readOnly && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="ml-auto text-xs text-slate-500 hover:text-slate-200"
            >
              редактировать
            </button>
          )}
          {!readOnly && (
            <button
              onClick={removeCandidate}
              className={
                'text-xs text-slate-500 hover:text-rose-400 ' +
                (editing ? 'ml-auto' : '')
              }
            >
              удалить
            </button>
          )}
        </div>
      </div>

      {editing && !readOnly && (
        <section className="space-y-3 rounded-2xl bg-bg-elevated p-5">
          <div className="text-sm font-semibold text-slate-200">
            Редактирование карточки
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">ФИО *</span>
              <input
                value={editFullName}
                onChange={(e) => setEditFullName(e.target.value)}
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Email</span>
              <input
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">
                Желаемая должность
              </span>
              <input
                value={editPosition}
                onChange={(e) => setEditPosition(e.target.value)}
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">
                Источник (LinkedIn, hh, реферал…)
              </span>
              <input
                value={editSource}
                onChange={(e) => setEditSource(e.target.value)}
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </label>
            <label className="block text-xs md:col-span-2">
              <span className="mb-1 block text-slate-400">
                Вакансия (контекст для AI-скрининга)
              </span>
              <select
                value={editVacancyId}
                onChange={(e) =>
                  setEditVacancyId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— без вакансии —</option>
                {vacancies.map((vac) => (
                  <option key={vac.id} value={vac.id}>
                    {vac.title}
                    {vac.project_name && ` · ${vac.project_name}`}
                    {vac.status === 'closed' && ' (закрыта)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">
                Ожидаемая роль (если без вакансии)
              </span>
              <select
                value={editRoleId}
                onChange={(e) =>
                  setEditRoleId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбрана —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block text-slate-400">Ожидаемый грейд</span>
              <select
                value={editGradeId}
                onChange={(e) =>
                  setEditGradeId(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— не выбран —</option>
                {grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {editError && (
            <div className="text-sm text-red-400">{editError}</div>
          )}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? '…' : 'Сохранить'}
            </button>
            <button
              onClick={cancelEdit}
              className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
          </div>
        </section>
      )}

      <div className="flex gap-1 border-b border-white/5">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Обзор
        </TabButton>
        <TabButton active={tab === 'meetings'} onClick={() => setTab('meetings')}>
          Интервью
        </TabButton>
      </div>

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Ближайшие встречи именно этого кандидата */}
          {!isClosed && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Ближайшие интервью
              </h2>
              <UpcomingMeetingsWidget
                filterEmployeeId={c.employee_id}
                emptyHint="Нет назначенных интервью. Запланируйте на вкладке «Интервью»."
              />
            </section>
          )}

          {/* Резюме */}
          <section className="rounded-2xl bg-bg-elevated p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Резюме
              </h2>
              {c.has_resume && (
                <div className="text-xs text-slate-500">
                  {c.resume_filename}
                  {c.resume_size_bytes && (
                    <> · {Math.round(c.resume_size_bytes / 1024)} КБ</>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
              >
                {uploading
                  ? 'загрузка…'
                  : c.has_resume
                    ? 'Заменить (.docx или .pdf)'
                    : 'Загрузить (.docx или .pdf)'}
              </button>
              {c.has_resume && (
                <>
                  <button
                    onClick={downloadResume}
                    className="rounded px-3 py-1.5 text-sm text-slate-300 hover:text-accent"
                  >
                    Скачать
                  </button>
                  <button
                    onClick={removeResume}
                    className="text-sm text-slate-500 hover:text-rose-400"
                  >
                    Удалить
                  </button>
                </>
              )}
            </div>
            {!c.has_resume && (
              <div className="mt-3 text-sm text-slate-500">
                Загрузите резюме — AI извлечёт сводку (опыт, навыки, что уточнить
                на интервью).
              </div>
            )}
            {c.has_resume && (
              <div className="mt-4">
                <ResumeViewer
                  candidateId={c.id}
                  filename={c.resume_filename}
                  uploadedAt={c.resume_uploaded_at}
                />
              </div>
            )}
          </section>

          {/* AI-помощник */}
          <section className="rounded-2xl bg-bg-elevated p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              AI-помощник
            </h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {AI_TASKS.map((cfg) => {
                const has = !!c[cfg.field]
                const running = activeAi.has(cfg.kind)
                const blocked = cfg.needsResume && !c.has_resume
                const err = aiErrors[cfg.kind]
                return (
                  <div
                    key={cfg.kind}
                    className="rounded-lg bg-bg-panel/40 p-3 ring-1 ring-white/5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{cfg.label}</div>
                        <div className="text-xs text-slate-500">{cfg.hint}</div>
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
                          ? 'Сначала загрузите резюме'
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

          {c.rejection_reason_md && (
            <section className="rounded-2xl bg-rose-500/5 p-5 ring-1 ring-rose-500/20">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-300">
                Причина отказа
              </h2>
              <Markdown content={c.rejection_reason_md} />
            </section>
          )}
        </div>
      )}

      {tab === 'meetings' && (
        <div>
          <div className="mb-3 text-xs text-slate-500">
            Используется тот же функционал встреч, что и в МПК: повестка, AI-вопросы
            и задания, артефакты ответов, заметки руководителя.
          </div>
          <MeetingsTab employeeId={c.employee_id} />
        </div>
      )}
    </div>
  )
}
