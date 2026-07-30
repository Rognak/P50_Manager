import { useState } from 'react'

import {
  AIQuestion,
  AITask,
  api,
  ArtifactKind,
  MeetingArtifact,
} from '../../api/client'
import { Markdown } from '../Markdown'

function LevelChip({ level }: { level: number }) {
  return (
    <span className="inline-block min-w-[1.5rem] rounded bg-accent/15 px-1.5 text-center text-xs font-semibold text-accent">
      {level}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </div>
  )
}

function ArtifactEditor({
  employeeId,
  meetingId,
  itemUid,
  competencyId,
  kind,
  label,
  placeholder,
  mono = false,
  artifacts,
  onSaved,
}: {
  employeeId: number
  meetingId: number
  itemUid: string | null
  competencyId: number | null
  kind: ArtifactKind
  label: string
  placeholder?: string
  mono?: boolean
  artifacts: MeetingArtifact[]
  onSaved: () => void
}) {
  const existing =
    artifacts.find(
      (a) => a.kind === kind && (a.ai_item_uid ?? null) === (itemUid ?? null),
    ) || null

  const [value, setValue] = useState(existing?.content ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== (existing?.content ?? '')

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.employees.meetings.artifacts.upsert(employeeId, meetingId, {
        kind,
        ai_item_uid: itemUid,
        competency_id: competencyId,
        content: value,
      })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {existing && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-normal text-emerald-400">
            сохранено
          </span>
        )}
      </div>
      <textarea
        rows={mono ? 10 : 4}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent ${
          mono ? 'font-mono text-xs' : 'text-sm'
        }`}
      />
      {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
      <div className="mt-2 flex justify-end gap-2">
        {dirty && (
          <button
            type="button"
            onClick={() => setValue(existing?.content ?? '')}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Отмена
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="rounded bg-accent/15 px-3 py-1 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          {saving ? '…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex items-center justify-end border-t border-white/5 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

export function AiQuestionModal({
  item,
  index,
  total,
  employeeId,
  meetingId,
  artifacts,
  onArtifactsChanged,
  onClose,
}: {
  item: AIQuestion
  index: number
  total: number
  employeeId: number
  meetingId: number
  artifacts: MeetingArtifact[]
  onArtifactsChanged: () => void
  onClose: () => void
}) {
  return (
    <Shell title={`Вопрос ${index + 1} из ${total}`} onClose={onClose}>
      <div className="text-lg font-medium leading-relaxed">{item.question}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        {item.competency_name && <span>{item.competency_name}</span>}
        <span>·</span>
        <span>
          ожидаемый уровень: <LevelChip level={item.expected_level} />
        </span>
      </div>
      {item.rationale && (
        <div>
          <SectionLabel>Зачем этот вопрос</SectionLabel>
          <div className="rounded-lg bg-bg-panel p-4 text-sm text-slate-300">
            {item.rationale}
          </div>
        </div>
      )}
      {item.reference_answer ? (
        <div>
          <SectionLabel>Эталонный ответ (для проверяющего)</SectionLabel>
          <div className="rounded-lg bg-bg-panel p-4">
            <Markdown content={item.reference_answer} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
          Эталонный ответ не сгенерирован (вопрос создан в старой версии). Перегенерируй, чтобы
          получить эталон.
        </div>
      )}

      <div className="border-t border-white/5 pt-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-500">
          Ход встречи
        </div>
        <div className="space-y-4">
          <ArtifactEditor
            employeeId={employeeId}
            meetingId={meetingId}
            itemUid={item.uid}
            competencyId={item.competency_id}
            kind="question_answer"
            label="Ответ сотрудника"
            placeholder="Как сотрудник ответил (Markdown поддерживается)"
            artifacts={artifacts}
            onSaved={onArtifactsChanged}
          />
          <ArtifactEditor
            employeeId={employeeId}
            meetingId={meetingId}
            itemUid={item.uid}
            competencyId={item.competency_id}
            kind="manager_comment"
            label="Комментарий руководителя"
            placeholder="Ваши наблюдения по ответу"
            artifacts={artifacts}
            onSaved={onArtifactsChanged}
          />
        </div>
        {!item.uid && (
          <div className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
            У этого вопроса нет стабильного идентификатора — заметки не сохранятся. Перегенерируй,
            чтобы связать.
          </div>
        )}
      </div>
    </Shell>
  )
}

export function AiTaskModal({
  item,
  index,
  total,
  employeeId,
  meetingId,
  artifacts,
  onArtifactsChanged,
  onClose,
}: {
  item: AITask
  index: number
  total: number
  employeeId: number
  meetingId: number
  artifacts: MeetingArtifact[]
  onArtifactsChanged: () => void
  onClose: () => void
}) {
  return (
    <Shell title={`Задание ${index + 1} из ${total}: ${item.title}`} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        {item.competency_name && <span>{item.competency_name}</span>}
        <span>·</span>
        <span>
          уровень: <LevelChip level={item.expected_level} />
        </span>
        {item.time_min !== null && (
          <>
            <span>·</span>
            <span>{item.time_min} мин</span>
          </>
        )}
      </div>
      <div>
        <SectionLabel>Задание</SectionLabel>
        <div className="rounded-lg bg-bg-panel p-4">
          <Markdown content={item.description} />
        </div>
      </div>
      {item.input_data && (
        <div>
          <SectionLabel>Входные данные</SectionLabel>
          <div className="rounded-lg bg-bg-panel p-4">
            <Markdown content={item.input_data} />
          </div>
        </div>
      )}
      {item.reference_solution ? (
        <div>
          <SectionLabel>Эталонное решение (для проверяющего)</SectionLabel>
          <div className="rounded-lg bg-bg-panel p-4">
            <Markdown content={item.reference_solution} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
          Эталонное решение не сгенерировано (задание создано в старой версии). Перегенерируй,
          чтобы получить эталон.
        </div>
      )}

      <div className="border-t border-white/5 pt-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-slate-500">
          Ход встречи
        </div>
        <div className="space-y-4">
          <ArtifactEditor
            employeeId={employeeId}
            meetingId={meetingId}
            itemUid={item.uid}
            competencyId={item.competency_id}
            kind="task_answer"
            label="Ответ сотрудника"
            placeholder="Как сотрудник описал решение"
            artifacts={artifacts}
            onSaved={onArtifactsChanged}
          />
          <ArtifactEditor
            employeeId={employeeId}
            meetingId={meetingId}
            itemUid={item.uid}
            competencyId={item.competency_id}
            kind="task_code"
            label="Код решения"
            placeholder="Вставьте код сотрудника (в тройных backticks для подсветки)"
            mono
            artifacts={artifacts}
            onSaved={onArtifactsChanged}
          />
          <ArtifactEditor
            employeeId={employeeId}
            meetingId={meetingId}
            itemUid={item.uid}
            competencyId={item.competency_id}
            kind="manager_comment"
            label="Комментарий руководителя"
            placeholder="Оценка решения, что в нём сильное/слабое"
            artifacts={artifacts}
            onSaved={onArtifactsChanged}
          />
        </div>
        {!item.uid && (
          <div className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">
            У этого задания нет стабильного идентификатора — заметки не сохранятся. Перегенерируй,
            чтобы связать.
          </div>
        )}
      </div>
    </Shell>
  )
}
