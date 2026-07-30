import { useCallback, useEffect, useState } from 'react'

import {
  AIGenParams,
  AIQuestion,
  AITask,
  AssessmentListItem,
  Competency,
  Meeting,
  MeetingArtifact,
  MeetingStatus,
  api,
} from '../../api/client'
import { findActiveJob, JobAborted, pollJob } from '../../lib/jobs'

import { AiGenerateModal } from './AiGenerateModal'
import { AiQuestionModal, AiTaskModal } from './AiItemModal'
import { AssessmentForm } from './AssessmentForm'

const STATUS_LABEL: Record<MeetingStatus, string> = {
  planned: 'Запланирована',
  done: 'Проведена',
  cancelled: 'Отменена',
}

const STATUS_STYLE: Record<MeetingStatus, string> = {
  planned: 'bg-accent/15 text-accent',
  done: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-slate-500/15 text-slate-400',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function LevelChip({ level }: { level: number }) {
  return (
    <span className="inline-block min-w-[1.5rem] rounded bg-accent/15 px-1.5 text-center text-xs font-semibold text-accent">
      {level}
    </span>
  )
}

function ArtifactBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400"
      title={`${count} заметок по этому item`}
    >
      💬 {count}
    </span>
  )
}

function QuestionTile({
  q,
  idx,
  artifactCount,
  onClick,
}: {
  q: AIQuestion
  idx: number
  artifactCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg bg-bg-panel p-4 text-left transition hover:bg-bg-panel/70 hover:ring-1 hover:ring-accent/30"
    >
      <div className="mb-2 flex items-start gap-3">
        <span className="pt-0.5 text-slate-500">{idx + 1}.</span>
        <span className="flex-1 text-base leading-snug">{q.question}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs text-slate-400">
        {q.competency_name && <span>{q.competency_name}</span>}
        <span>·</span>
        <span>
          уровень: <LevelChip level={q.expected_level} />
        </span>
        <ArtifactBadge count={artifactCount} />
        <span className="ml-auto text-accent/70">Открыть →</span>
      </div>
    </button>
  )
}

function TaskTile({
  t,
  idx,
  artifactCount,
  onClick,
}: {
  t: AITask
  idx: number
  artifactCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg bg-bg-panel p-4 text-left transition hover:bg-bg-panel/70 hover:ring-1 hover:ring-accent/30"
    >
      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-slate-500">{idx + 1}.</span>
        <span className="flex-1 text-base font-medium leading-snug">{t.title}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs text-slate-400">
        {t.competency_name && <span>{t.competency_name}</span>}
        <span>·</span>
        <span>
          уровень: <LevelChip level={t.expected_level} />
        </span>
        {t.time_min !== null && (
          <>
            <span>·</span>
            <span>{t.time_min} мин</span>
          </>
        )}
        <ArtifactBadge count={artifactCount} />
        <span className="ml-auto text-accent/70">Открыть →</span>
      </div>
    </button>
  )
}

export function MeetingCard({
  meeting,
  employeeId,
  onChanged,
}: {
  meeting: Meeting
  employeeId: number
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [agenda, setAgenda] = useState(meeting.agenda_md || '')
  const [summary, setSummary] = useState(meeting.summary_md || '')
  const [transcript, setTranscript] = useState(meeting.transcript_md || '')
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiModal, setAiModal] = useState<null | 'questions' | 'tasks'>(null)
  const [openQuestion, setOpenQuestion] = useState<number | null>(null)
  const [openTask, setOpenTask] = useState<number | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  const [competencies, setCompetencies] = useState<Competency[] | null>(null)
  const [meetingAssessments, setMeetingAssessments] = useState<AssessmentListItem[]>([])
  const [assessmentOpen, setAssessmentOpen] = useState(false)
  const [artifacts, setArtifacts] = useState<MeetingArtifact[]>([])

  const loadAssessments = useCallback(async () => {
    try {
      const list = await api.employees.meetings.assessments(employeeId, meeting.id)
      setMeetingAssessments(list)
    } catch (err) {
      console.error(err)
    }
  }, [employeeId, meeting.id])

  const loadArtifacts = useCallback(async () => {
    try {
      const list = await api.employees.meetings.artifacts.list(employeeId, meeting.id)
      setArtifacts(list)
    } catch (err) {
      console.error(err)
    }
  }, [employeeId, meeting.id])

  useEffect(() => {
    if (!expanded) return
    if (!competencies) api.mpk.competencies().then(setCompetencies).catch(() => undefined)
    loadAssessments()
    loadArtifacts()
  }, [expanded, competencies, loadAssessments, loadArtifacts])

  // подхват активной AI-задачи (questions/tasks/summary) для этой встречи после refresh
  useEffect(() => {
    if (!expanded) return
    const controller = new AbortController()
    let cancelled = false
    findActiveJob(
      employeeId,
      ['meeting_questions', 'meeting_tasks', 'meeting_summary'],
      meeting.id,
    )
      .then((job) => {
        if (cancelled || !job) return
        const map: Record<string, string> = {
          meeting_questions: 'ai-questions',
          meeting_tasks: 'ai-tasks',
          meeting_summary: 'ai-summary',
        }
        setSaving(map[job.kind] || 'gen')
        return pollJob(employeeId, job.id, undefined, controller.signal).then(() => {
          if (!cancelled) onChanged()
        })
      })
      .catch((e) => {
        if (e instanceof JobAborted) return
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setSaving(null)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [expanded, employeeId, meeting.id, onChanged])

  const artifactCountByUid = (uid: string | null | undefined): number =>
    uid ? artifacts.filter((a) => a.ai_item_uid === uid).length : 0

  const hasArtifactsForCurrentItems = (kind: 'questions' | 'tasks'): boolean => {
    const items =
      kind === 'questions'
        ? meeting.ai_questions?.items || []
        : meeting.ai_tasks?.items || []
    const uids = new Set(items.map((i) => i.uid).filter(Boolean) as string[])
    return artifacts.some((a) => a.ai_item_uid && uids.has(a.ai_item_uid))
  }

  const dirty =
    agenda !== (meeting.agenda_md || '') ||
    summary !== (meeting.summary_md || '') ||
    transcript !== (meeting.transcript_md || '')

  const change = async (patch: Partial<Meeting>, action: string) => {
    setSaving(action)
    setError(null)
    try {
      await api.employees.meetings.update(employeeId, meeting.id, patch)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const save = () =>
    change(
      {
        agenda_md: agenda.trim() || null,
        summary_md: summary.trim() || null,
        transcript_md: transcript.trim() || null,
      },
      'save',
    )

  const remove = async () => {
    if (!confirm('Удалить встречу?')) return
    setSaving('del')
    setError(null)
    try {
      await api.employees.meetings.delete(employeeId, meeting.id)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setSaving(null)
    }
  }

  const openAiModal = (kind: 'questions' | 'tasks') => {
    if (hasArtifactsForCurrentItems(kind)) {
      const what = kind === 'questions' ? 'вопросам' : 'заданиям'
      if (
        !confirm(
          `Перегенерация создаст новые ${what} и отвяжет сохранённые ответы / комментарии ` +
            `от текущих. Старые ответы останутся в истории встречи, но не будут связаны ` +
            `с новыми ${what}. Продолжить?`,
        )
      ) {
        return
      }
    }
    setAiModal(kind)
  }

  const runGen = async (kind: 'questions' | 'tasks', params: AIGenParams) => {
    setSaving(kind === 'questions' ? 'ai-questions' : 'ai-tasks')
    setError(null)
    try {
      const job =
        kind === 'questions'
          ? await api.employees.meetings.ai.questions(employeeId, meeting.id, params)
          : await api.employees.meetings.ai.tasks(employeeId, meeting.id, params)
      // Закрываем модалку после успешного enqueue — иначе ошибка enqueue
      // потерялась бы (модалка закрылась до отображения).
      setAiModal(null)
      await pollJob(employeeId, job.id)
      onChanged()
    } catch (err) {
      console.error('AI generation failed', err)
      setError((err as Error).message)
      // пробрасываем — AiGenerateModal покажет в своём баннере, если открыт
      throw err
    } finally {
      setSaving(null)
    }
  }

  const genSummary = async () => {
    setSaving('ai-summary')
    setError(null)
    try {
      const job = await api.employees.meetings.ai.summary(
        employeeId,
        meeting.id,
        summary,
      )
      await pollJob(employeeId, job.id)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const initialScoresFromAi = (): Record<number, number> => {
    const scores: Record<number, number> = {}
    const src = [
      ...(meeting.ai_questions?.items || []).map((q) => ({
        cid: q.competency_id,
        lvl: q.expected_level,
      })),
      ...(meeting.ai_tasks?.items || []).map((t) => ({
        cid: t.competency_id,
        lvl: t.expected_level,
      })),
    ]
    for (const { cid, lvl } of src) {
      if (!(cid in scores)) scores[cid] = lvl
    }
    return scores
  }

  return (
    <div className="rounded-2xl bg-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-4 px-6 py-4 text-left hover:bg-bg-panel/40"
      >
        <div className="flex-1">
          <div className="font-medium">{formatDateTime(meeting.scheduled_at)}</div>
          <div className="mt-1 text-sm text-slate-400">
            {meeting.duration_min} мин
            {meeting.agenda_md &&
              ` · ${meeting.agenda_md.slice(0, 80).replace(/\n/g, ' ')}${
                meeting.agenda_md.length > 80 ? '…' : ''
              }`}
          </div>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-semibold ${STATUS_STYLE[meeting.status]}`}
        >
          {STATUS_LABEL[meeting.status]}
        </span>
        <span className="text-slate-500">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-white/5 px-6 py-4">
          <label className="block">
            <div className="mb-1 text-sm text-slate-400">Повестка</div>
            <textarea
              rows={3}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </label>

          {/* AI-секция */}
          <div className="space-y-4 rounded-lg bg-bg-panel/30 p-4 ring-1 ring-white/5">
            <div className="text-sm font-semibold text-slate-300">AI-ассистент</div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="text-sm text-slate-400">
                  Вопросы для встречи
                  {meeting.ai_questions && ` · ${meeting.ai_questions.items.length} шт`}
                </div>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={saving === 'ai-questions'}
                  onClick={() => openAiModal('questions')}
                  className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
                >
                  {saving === 'ai-questions'
                    ? 'генерация…'
                    : meeting.ai_questions
                      ? 'Перегенерировать'
                      : 'Сгенерировать'}
                </button>
              </div>
              {meeting.ai_questions && meeting.ai_questions.items.length > 0 && (
                <div className="space-y-2">
                  {meeting.ai_questions.items.map((q, i) => (
                    <QuestionTile
                      key={q.uid || i}
                      q={q}
                      idx={i}
                      artifactCount={artifactCountByUid(q.uid)}
                      onClick={() => setOpenQuestion(i)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-white/5 pt-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-sm text-slate-400">
                  Практические задания
                  {meeting.ai_tasks && ` · ${meeting.ai_tasks.items.length} шт`}
                </div>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={saving === 'ai-tasks'}
                  onClick={() => openAiModal('tasks')}
                  className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
                >
                  {saving === 'ai-tasks'
                    ? 'генерация…'
                    : meeting.ai_tasks
                      ? 'Перегенерировать'
                      : 'Сгенерировать'}
                </button>
              </div>
              {meeting.ai_tasks && meeting.ai_tasks.items.length > 0 && (
                <div className="space-y-2">
                  {meeting.ai_tasks.items.map((t, i) => (
                    <TaskTile
                      key={t.uid || i}
                      t={t}
                      idx={i}
                      artifactCount={artifactCountByUid(t.uid)}
                      onClick={() => setOpenTask(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Транскрипт встречи */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowTranscript(!showTranscript)}
                className="text-sm text-slate-400 hover:text-slate-200"
              >
                {showTranscript ? '▾' : '▸'} Транскрипт встречи
                {transcript && !showTranscript && (
                  <span className="ml-2 text-xs text-slate-500">
                    ({Math.round(transcript.length / 1000)}k символов)
                  </span>
                )}
              </button>
            </div>
            {showTranscript && (
              <textarea
                rows={10}
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Вставьте расшифровку встречи (например, после прогона записи через ИИ). Транскрипт будет использован как контекст для AI-рекомендаций и следующих встреч."
                className="w-full rounded-lg bg-bg-panel px-3 py-2 font-mono text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            )}
          </div>

          <label className="block">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm text-slate-400">Итоги / заметки</span>
              <div className="flex-1" />
              <button
                type="button"
                disabled={saving !== null}
                onClick={genSummary}
                className="rounded-lg bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-40"
              >
                {saving === 'ai-summary' ? 'Думаю…' : 'Сформировать через AI'}
              </button>
            </div>
            <textarea
              rows={6}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Запишите заметки от руки или нажмите «Сформировать через AI» — модель структурирует их по разделам."
              className="w-full rounded-lg bg-bg-panel px-3 py-2 font-mono text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </label>

          {/* Оценка МПК по итогам встречи */}
          {meeting.status !== 'cancelled' && (
            <div className="rounded-lg bg-bg-panel/30 p-4 ring-1 ring-white/5">
              <div className="mb-2 flex items-center gap-2">
                <div className="text-sm font-semibold text-slate-300">
                  Оценка МПК по итогам встречи
                  {meetingAssessments.length > 0 && ` · ${meetingAssessments.length}`}
                </div>
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={!competencies}
                  onClick={() => setAssessmentOpen(true)}
                  className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
                >
                  {meetingAssessments.length > 0 ? 'Добавить ещё' : 'Зафиксировать оценку'}
                </button>
              </div>
              {meetingAssessments.length === 0 ? (
                <div className="text-xs text-slate-500">
                  После встречи зафиксируйте уровни по обсуждённым компетенциям — оценка
                  привяжется к этой встрече и появится в истории на вкладке «МПК».
                </div>
              ) : (
                <ul className="space-y-1 text-sm">
                  {meetingAssessments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between rounded bg-bg-panel px-3 py-2"
                    >
                      <span>{a.assessed_at}</span>
                      <span className="text-xs text-slate-500">{a.notes || 'без заметок'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
            {meeting.status === 'planned' && (
              <>
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => change({ status: 'done' }, 'done')}
                  className="rounded-lg bg-emerald-500/15 px-4 py-2 text-sm text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {saving === 'done' ? '…' : 'Пометить проведённой'}
                </button>
                <button
                  type="button"
                  disabled={saving !== null}
                  onClick={() => change({ status: 'cancelled' }, 'cancel')}
                  className="rounded-lg bg-slate-500/15 px-4 py-2 text-sm text-slate-400 hover:bg-slate-500/25 disabled:opacity-40"
                >
                  {saving === 'cancel' ? '…' : 'Отменить'}
                </button>
              </>
            )}
            {meeting.status !== 'planned' && (
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => change({ status: 'planned' }, 'replan')}
                className="rounded-lg bg-accent/15 px-4 py-2 text-sm text-accent hover:bg-accent/25 disabled:opacity-40"
              >
                Вернуть в «запланирована»
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
        </div>
      )}

      {aiModal && (
        <AiGenerateModal
          kind={aiModal}
          onClose={() => setAiModal(null)}
          onSubmit={(params) => runGen(aiModal, params)}
        />
      )}

      {openQuestion !== null && meeting.ai_questions && (
        <AiQuestionModal
          item={meeting.ai_questions.items[openQuestion]}
          index={openQuestion}
          total={meeting.ai_questions.items.length}
          employeeId={employeeId}
          meetingId={meeting.id}
          artifacts={artifacts}
          onArtifactsChanged={loadArtifacts}
          onClose={() => setOpenQuestion(null)}
        />
      )}

      {openTask !== null && meeting.ai_tasks && (
        <AiTaskModal
          item={meeting.ai_tasks.items[openTask]}
          index={openTask}
          total={meeting.ai_tasks.items.length}
          employeeId={employeeId}
          meetingId={meeting.id}
          artifacts={artifacts}
          onArtifactsChanged={loadArtifacts}
          onClose={() => setOpenTask(null)}
        />
      )}

      {assessmentOpen && competencies && (
        <AssessmentForm
          employeeId={employeeId}
          competencies={competencies}
          meetingIds={[meeting.id]}
          title={`Оценка по итогам встречи ${formatDateTime(meeting.scheduled_at)}`}
          initialScores={initialScoresFromAi()}
          onClose={() => setAssessmentOpen(false)}
          onSaved={() => {
            setAssessmentOpen(false)
            loadAssessments()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
