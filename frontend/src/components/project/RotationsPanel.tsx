import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  CurrentUser,
  EmployeeSearchItem,
  ProjectListItem,
  ReplacementCandidate,
  RotationCandidate,
  RotationFull,
  RotationListItem,
  RotationsPanel as RotationsPanelData,
  api,
} from '../../api/client'
import { Markdown } from '../Markdown'

const POLL_MS = 3000

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

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

const STATUS_LABEL: Record<string, string> = {
  proposed: 'на согласовании',
  accepted: 'согласовано',
  completed: 'завершено',
  cancelled: 'отменено',
  reverted: 'откачено',
}

const STATUS_CLR: Record<string, string> = {
  proposed: 'text-amber-400',
  accepted: 'text-accent',
  completed: 'text-emerald-400',
  cancelled: 'text-slate-500',
  reverted: 'text-slate-500',
}

function defaultPlannedStart(): string {
  // ровно через 30 дней — мягкий ориентир по умолчанию
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

function ProposeForm({
  candidate,
  projectId,
  currentUserId,
  onDone,
  onCancel,
}: {
  candidate: RotationCandidate
  projectId: number
  currentUserId: number | null
  onDone: () => void
  onCancel: () => void
}) {
  const [targetId, setTargetId] = useState<number | ''>(
    candidate.target_projects[0]?.project_id ?? '',
  )
  const [reason, setReason] = useState(candidate.rationale_md || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([])
  const [plannedStart, setPlannedStart] = useState<string>(defaultPlannedStart())

  // замена: единый id. Источников два — viable из бэка (зависят от target)
  // и manualPicked (добавленные через поиск по имени).
  const [replacementId, setReplacementId] = useState<number | ''>('')
  const [manualPicked, setManualPicked] = useState<EmployeeSearchItem[]>([])
  const [viableReplacements, setViableReplacements] = useState<ReplacementCandidate[]>([])
  const [replEmptyReason, setReplEmptyReason] = useState<string | null>(null)
  const [replLoading, setReplLoading] = useState(false)
  const [replSearchQ, setReplSearchQ] = useState('')
  const [replSearchResults, setReplSearchResults] = useState<EmployeeSearchItem[]>([])
  const [replSearching, setReplSearching] = useState(false)
  const [showReplSearch, setShowReplSearch] = useState(false)

  // согласующие: авто (вычисляются по проектам/owner'у) + ручные
  const [allUsers, setAllUsers] = useState<CurrentUser[]>([])
  const [autoApproverIds, setAutoApproverIds] = useState<number[]>([])
  const [autoApproverLabels, setAutoApproverLabels] = useState<
    Record<number, string>
  >({})
  const [extraApproverIds, setExtraApproverIds] = useState<number[]>([])
  const [showApproverPicker, setShowApproverPicker] = useState(false)

  // Если AI не предложил целевые проекты — даём выбрать из всех активных вручную
  const aiHasTargets = candidate.target_projects.length > 0
  useEffect(() => {
    api.projects
      .list()
      .then((list) =>
        setAllProjects(
          list.filter((p) => p.status === 'active' && p.id !== projectId),
        ),
      )
      .catch(() => undefined)
  }, [projectId])

  useEffect(() => {
    api.users
      .list()
      .then(setAllUsers)
      .catch(() => undefined)
  }, [])

  // Замены — подгружаются из выбранного target_project (паттерн «обмен»)
  useEffect(() => {
    if (typeof targetId !== 'number') {
      setViableReplacements([])
      setReplEmptyReason(null)
      setReplacementId('')
      return
    }
    setReplLoading(true)
    setReplEmptyReason(null)
    api.projects
      .replacements(projectId, candidate.employee_id, targetId)
      .then((res) => {
        setViableReplacements(res.viable)
        setReplEmptyReason(res.empty_reason)
        setReplacementId(res.viable[0]?.employee_id ?? '')
      })
      .catch((e) => {
        setViableReplacements([])
        setReplEmptyReason((e as Error).message)
      })
      .finally(() => setReplLoading(false))
  }, [targetId, projectId, candidate.employee_id])

  // Авто-согласующие (зеркало backend `_required_approvers`):
  //   • менеджеры исходного и целевого проектов — всегда
  //   • руководитель сотрудника — всегда
  //   • руководитель замены — если выбрана замена
  // Совпадения склеиваются в один approver-row с объединённым лейблом.
  useEffect(() => {
    if (typeof targetId !== 'number') {
      setAutoApproverIds([])
      setAutoApproverLabels({})
      return
    }
    // owner выбранной замены (если есть)
    let replacementOwnerId: number | null = null
    if (typeof replacementId === 'number') {
      const v = viableReplacements.find((r) => r.employee_id === replacementId)
      const m = manualPicked.find((e) => e.id === replacementId)
      replacementOwnerId = v?.owner_id ?? m?.owner_id ?? null
    }

    Promise.all([api.projects.get(projectId), api.projects.get(targetId)])
      .then(([fromP, toP]) => {
        const ids: number[] = []
        const labels: Record<number, string> = {}
        const add = (uid: number, lbl: string) => {
          if (!ids.includes(uid)) ids.push(uid)
          labels[uid] = labels[uid] ? `${labels[uid]}, ${lbl}` : lbl
        }
        add(fromP.created_by, 'менеджер исходного проекта')
        add(toP.created_by, 'менеджер целевого проекта')
        add(candidate.owner_id, 'руководитель сотрудника')
        if (replacementOwnerId !== null) {
          add(replacementOwnerId, 'руководитель замены')
        }
        setAutoApproverIds(ids)
        setAutoApproverLabels(labels)
      })
      .catch(() => undefined)
  }, [
    targetId,
    projectId,
    candidate.owner_id,
    replacementId,
    viableReplacements,
    manualPicked,
  ])

  // поиск замены по ФИО
  useEffect(() => {
    if (!showReplSearch || replSearchQ.trim().length < 2) {
      setReplSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      setReplSearching(true)
      try {
        const list = await api.employeesSearch(replSearchQ.trim(), 15)
        setReplSearchResults(
          list.filter((e) => e.id !== candidate.employee_id),
        )
      } finally {
        setReplSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [replSearchQ, showReplSearch, candidate.employee_id])

  const noViableSelected =
    candidate.replacement_needed &&
    viableReplacements.length === 0 &&
    manualPicked.length === 0 &&
    replacementId === ''

  const submit = async () => {
    if (typeof targetId !== 'number') {
      setError('Выберите целевой проект')
      return
    }
    if (noViableSelected) {
      const ok = confirm(
        'Запустить ротацию без замены?\n\n' +
          (replEmptyReason ||
            'На проекте может вырасти bus-factor.') +
          '\n\nЕсли план замены есть вне системы — опишите в обосновании.',
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      let finalReason = reason.trim()
      const finalReplacementId =
        typeof replacementId === 'number' ? replacementId : null
      if (!finalReplacementId && noViableSelected) {
        finalReason = (
          finalReason +
          '\n\n_Запущено без замены: ' +
          (replEmptyReason || 'нет подходящих кандидатов') +
          '_'
        ).trim()
      }
      await api.rotations.propose({
        employee_id: candidate.employee_id,
        from_project_id: projectId,
        to_project_id: targetId,
        reason_md: finalReason || null,
        planned_start_at: plannedStart || null,
        extra_approver_ids: extraApproverIds,
        replacement_employee_id: finalReplacementId,
      })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const userById = (id: number) => allUsers.find((u) => u.id === id)

  const totalApproverIds = Array.from(
    new Set([...autoApproverIds, ...extraApproverIds]),
  )

  return (
    <div className="space-y-3 rounded-lg bg-bg-panel/50 p-3 ring-1 ring-white/5">
      <div className="text-xs text-slate-400">
        Запустить ротацию: {candidate.full_name}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-500">
            Целевой проект
            {!aiHasTargets && (
              <span className="ml-2 text-slate-600">
                (AI не предложил — выберите вручную)
              </span>
            )}
          </div>
          <select
            value={targetId}
            onChange={(e) =>
              setTargetId(e.target.value === '' ? '' : Number(e.target.value))
            }
            className="w-full rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            <option value="">— целевой проект не выбран —</option>
            {aiHasTargets
              ? candidate.target_projects.map((tp) => (
                  <option key={tp.project_id} value={tp.project_id}>
                    {tp.project_name}
                    {tp.code ? ` (${tp.code})` : ''}
                  </option>
                ))
              : allProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">Дата начала ротации</div>
          <input
            type="date"
            value={plannedStart}
            onChange={(e) => setPlannedStart(e.target.value)}
            className="w-full rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </div>
      </div>

      {/* Замена */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>
            Замена (на кого)
            {typeof targetId === 'number' && (
              <span className="ml-2 text-slate-600">
                из участников целевого проекта
              </span>
            )}
          </span>
          {typeof targetId === 'number' && !showReplSearch && (
            <button
              type="button"
              onClick={() => setShowReplSearch(true)}
              className="text-slate-400 hover:text-accent"
            >
              + найти другого по имени
            </button>
          )}
        </div>

        {typeof targetId !== 'number' ? (
          <div className="rounded bg-bg-panel px-3 py-2 text-xs text-slate-500 ring-1 ring-white/5">
            Сначала выберите целевой проект — список замен подтянется из его участников.
          </div>
        ) : replLoading ? (
          <div className="rounded bg-bg-panel px-3 py-2 text-xs text-slate-500 ring-1 ring-white/5">
            Подбираем кандидатов…
          </div>
        ) : (
          <select
            value={replacementId}
            onChange={(e) =>
              setReplacementId(
                e.target.value === '' ? '' : Number(e.target.value),
              )
            }
            className="w-full rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            <option value="">— без замены —</option>
            {viableReplacements.map((r) => (
              <option key={`v-${r.employee_id}`} value={r.employee_id}>
                {r.full_name}
                {r.role_name ? ` · ${r.role_name}` : ''}
                {r.grade_code ? ` ${r.grade_code}` : ''}
                {` · ${r.tenure_months} мес в проекте`}
                {r.status === 'ready'
                  ? ' · готов'
                  : r.status === 'approachable'
                    ? ' · можно поговорить'
                    : ''}
              </option>
            ))}
            {manualPicked.length > 0 && viableReplacements.length > 0 && (
              <option disabled>──────────</option>
            )}
            {manualPicked.map((emp) => (
              <option key={`m-${emp.id}`} value={emp.id}>
                {emp.full_name}
                {emp.role_name ? ` · ${emp.role_name}` : ''}
                {emp.grade_code ? ` ${emp.grade_code}` : ''}
                {!emp.is_yours ? ` (${emp.owner_name})` : ''}
              </option>
            ))}
          </select>
        )}

        {/* warning «нет кандидатов» */}
        {noViableSelected && !showReplSearch && !replLoading && (
          <div className="mt-2 rounded bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-rose-500/20">
            <strong>Кандидатов нет.</strong>{' '}
            {replEmptyReason || ''} Можно найти кого-то вручную или
            подтвердить запуск без замены.
          </div>
        )}

        {/* search */}
        {showReplSearch && (
          <div className="mt-2 space-y-1">
            <div className="flex gap-2">
              <input
                autoFocus
                placeholder="ФИО или email"
                value={replSearchQ}
                onChange={(e) => setReplSearchQ(e.target.value)}
                className="flex-1 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => {
                  setShowReplSearch(false)
                  setReplSearchQ('')
                  setReplSearchResults([])
                }}
                className="text-xs text-slate-400 hover:text-slate-200"
              >
                закрыть
              </button>
            </div>
            {replSearching && (
              <div className="text-xs text-slate-500">поиск…</div>
            )}
            {replSearchResults.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {replSearchResults.map((emp) => {
                  const alreadyAdded =
                    viableReplacements.some(
                      (r) => r.employee_id === emp.id,
                    ) || manualPicked.some((m) => m.id === emp.id)
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        if (!alreadyAdded) {
                          setManualPicked([...manualPicked, emp])
                        }
                        setReplacementId(emp.id)
                        setShowReplSearch(false)
                        setReplSearchQ('')
                        setReplSearchResults([])
                      }}
                      className="flex w-full items-center gap-2 rounded bg-bg-panel/60 px-3 py-1.5 text-left text-xs hover:bg-bg-panel"
                    >
                      <span className="font-medium">{emp.full_name}</span>
                      <span className="text-slate-500">
                        {emp.role_name || '—'}
                        {emp.grade_code && ` · ${emp.grade_code}`}
                      </span>
                      {!emp.is_yours && (
                        <span className="ml-auto text-slate-600">
                          ({emp.owner_name})
                        </span>
                      )}
                      {alreadyAdded && (
                        <span className="text-slate-600">уже в списке</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Согласующие */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Согласующие ({totalApproverIds.length})</span>
          {!showApproverPicker && (
            <button
              type="button"
              onClick={() => setShowApproverPicker(true)}
              className="text-slate-400 hover:text-accent"
            >
              + добавить
            </button>
          )}
        </div>
        {totalApproverIds.length === 0 ? (
          <div className="rounded bg-bg-panel px-3 py-2 text-xs text-slate-500 ring-1 ring-white/5">
            Выберите целевой проект — список согласующих появится автоматически.
          </div>
        ) : (
          <div className="space-y-1">
            {totalApproverIds.map((uid) => {
              const u = userById(uid)
              const isAuto = autoApproverIds.includes(uid)
              const isInitiator = uid === currentUserId
              return (
                <div
                  key={uid}
                  className="flex items-center gap-2 rounded bg-bg-panel px-3 py-1.5 text-xs ring-1 ring-white/5"
                >
                  <span className="font-medium text-slate-200">
                    {u?.full_name || `#${uid}`}
                    {isInitiator && (
                      <span className="ml-2 text-emerald-400">вы</span>
                    )}
                  </span>
                  {isAuto ? (
                    <span className="text-slate-500">
                      · {autoApproverLabels[uid]}
                    </span>
                  ) : (
                    <span className="text-slate-500">· вручную</span>
                  )}
                  {isInitiator && (
                    <span className="text-slate-500">
                      · авто-согласие при создании
                    </span>
                  )}
                  {!isAuto && (
                    <button
                      type="button"
                      onClick={() =>
                        setExtraApproverIds(
                          extraApproverIds.filter((x) => x !== uid),
                        )
                      }
                      className="ml-auto text-slate-500 hover:text-rose-400"
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {showApproverPicker && (
          <div className="mt-2 space-y-1">
            <div className="text-xs text-slate-500">Выберите пользователя:</div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {allUsers
                .filter(
                  (u) =>
                    u.id !== currentUserId &&
                    !totalApproverIds.includes(u.id),
                )
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setExtraApproverIds([...extraApproverIds, u.id])
                      setShowApproverPicker(false)
                    }}
                    className="block w-full rounded bg-bg-panel/60 px-3 py-1.5 text-left text-xs hover:bg-bg-panel"
                  >
                    <span className="font-medium">{u.full_name}</span>
                    <span className="ml-2 text-slate-500">{u.email}</span>
                  </button>
                ))}
            </div>
            <button
              type="button"
              onClick={() => setShowApproverPicker(false)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              отмена
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-500">Обоснование</div>
        <textarea
          rows={4}
          placeholder="Markdown. По умолчанию — AI-обоснование, можно отредактировать."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded bg-accent px-3 py-1.5 text-sm text-bg disabled:opacity-50"
        >
          {busy ? '…' : 'Создать запрос'}
        </button>
        <button
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}

export function ScoreHelp() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg bg-bg-elevated/40 ring-1 ring-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs text-slate-400 hover:text-slate-200"
      >
        <span>Как считается score</span>
        <span className="text-slate-500">{open ? 'скрыть' : 'показать'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/5 px-4 py-3 text-xs text-slate-300">
          <div>
            <span className="font-semibold">Формула:</span>{' '}
            <code className="rounded bg-bg-panel px-1.5 py-0.5">
              score = tenure_score + 2 × bus_factor_score
            </code>
          </div>

          <div>
            <span className="font-semibold">tenure_score</span> — длительность сверх
            порога (18 мес.) делёнка на 3:
            <div className="mt-1 ml-3 text-slate-400">
              <code className="rounded bg-bg-panel px-1.5 py-0.5">
                tenure_score = (tenure_months − 18) ÷ 3
              </code>{' '}
              (округление вниз, не ниже нуля)
            </div>
            <div className="mt-1 ml-3 text-slate-500">
              18 мес → 0 · 21 мес → 1 · 24 мес → 2 · 27 мес → 3 · 30 мес → 4
            </div>
          </div>

          <div>
            <span className="font-semibold">bus_factor_score</span> — количество
            ★-компетенций стека проекта, которые сотрудник единственный закрывает
            на целевом уровне. Каждая такая компетенция = +1.
          </div>

          <div className="rounded bg-bg-panel/40 p-2">
            <div className="font-semibold text-slate-300">Примеры:</div>
            <div className="mt-1 space-y-1">
              <div>
                <span className="text-slate-400">tenure 26 мес, bus 0:</span>{' '}
                tenure_score = (26−18)÷3 = 2, bus = 0 → score{' '}
                <span className="text-accent">2</span>
              </div>
              <div>
                <span className="text-slate-400">tenure 28 мес, bus 1:</span>{' '}
                tenure_score = 3, bus = 1 → score{' '}
                <span className="text-accent">3 + 2 = 5</span>
              </div>
              <div>
                <span className="text-slate-400">tenure 19 мес, bus 2:</span>{' '}
                tenure_score = 0, bus = 2 → score{' '}
                <span className="text-accent">0 + 4 = 4</span>
              </div>
            </div>
          </div>

          <div className="text-slate-500">
            Чем выше score — тем сильнее сигнал к ротации. Высокий bus-factor
            особенно критичен: команде стоит готовить замену.
          </div>
        </div>
      )}
    </div>
  )
}

function ReplacementStatus({ candidate }: { candidate: RotationCandidate }) {
  const proj = candidate.replacement_project_name
  const inStack = candidate.replacement_role_keys_in_stack
    .map((c) => `«${c.competency_name}»`)
    .join(', ')

  if (candidate.replacement_needed) {
    return (
      <div className="mt-2 text-xs text-amber-400">
        Замена потребуется на «{proj}» — закрываете на целевом уровне ★-компетенции,
        входящие в стек проекта. Выберите её при запуске ротации.
      </div>
    )
  }

  if (candidate.replacement_role_keys_in_stack.length === 0) {
    return (
      <div className="mt-2 text-xs text-slate-500">
        Замена не требуется на «{proj}»: ★-компетенции вашей роли не входят
        в стек проекта.
      </div>
    )
  }

  return (
    <div className="mt-2 text-xs text-slate-500">
      Замена не требуется на «{proj}»: ★-компетенции вашей роли в стеке —{' '}
      {inStack}; вы не закрываете их на целевом уровне (или их закрывают другие участники).
    </div>
  )
}

export function CandidateRow({
  candidate,
  projectId,
  currentUserId,
  onChanged,
}: {
  candidate: RotationCandidate
  projectId: number
  currentUserId: number | null
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [proposing, setProposing] = useState(false)

  const refreshSuggestion = async () => {
    try {
      await api.projects.refreshRotationSuggestion(projectId, candidate.employee_id)
      onChanged()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const blocked =
    candidate.rotation_locked || candidate.pending_rotation_id !== null

  return (
    <div className="rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {candidate.full_name}
            <span className="ml-2 text-xs text-slate-500">
              {candidate.role_name || '—'}
              {candidate.grade_code && ` · ${candidate.grade_code}`}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            в проекте с {formatDate(candidate.joined_at)} ·{' '}
            <span className="text-slate-300">{candidate.tenure_months} мес.</span>{' '}
            · score{' '}
            <span className="text-accent">{candidate.score}</span>{' '}
            <span className="text-slate-500">
              (tenure {candidate.tenure_score} + 2×bus {candidate.bus_factor_score})
            </span>
          </div>
          {candidate.bus_factor_competencies.length > 0 && (
            <div className="mt-1 text-xs text-rose-300">
              bus-factor: единственный носитель ★ —{' '}
              {candidate.bus_factor_competencies
                .map((c) => c.competency_name)
                .join(', ')}
            </div>
          )}
          {candidate.rotation_locked && (
            <div className="mt-1 text-xs text-amber-400">
              заморожен: {candidate.rotation_lock_note || '—'}
            </div>
          )}
          {candidate.pending_rotation_id && (
            <div className="mt-1 text-xs text-amber-400">
              уже есть незакрытая ротация #{candidate.pending_rotation_id}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {candidate.suggestion_running ? (
            <span className="text-xs text-slate-400">генерация AI…</span>
          ) : (
            <button
              onClick={refreshSuggestion}
              className="rounded bg-bg-panel px-2.5 py-1 text-xs text-slate-300 ring-1 ring-white/5 hover:text-accent"
              title={
                candidate.suggestion_generated_at
                  ? `сгенерировано ${formatDateTime(candidate.suggestion_generated_at)}`
                  : 'обоснование ещё не сгенерировано'
              }
            >
              {candidate.rationale_md ? 'Обновить' : 'Сгенерировать'} обоснование
            </button>
          )}
          <button
            disabled={blocked}
            onClick={() => setProposing(true)}
            className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-30"
            title={
              candidate.rotation_locked
                ? `Заморожен: ${candidate.rotation_lock_note || '—'}`
                : candidate.pending_rotation_id
                  ? 'Уже есть незакрытая ротация'
                  : 'Создать запрос на ротацию'
            }
          >
            Запустить ротацию
          </button>
        </div>
      </div>

      {candidate.target_projects.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="text-slate-500">подходящие проекты:</span>
          {candidate.target_projects.map((tp) => (
            <span
              key={tp.project_id}
              className="rounded bg-bg-panel px-2 py-0.5 text-slate-300 ring-1 ring-white/5"
            >
              {tp.project_name}
              {tp.code && (
                <span className="ml-1 text-slate-500">({tp.code})</span>
              )}
            </span>
          ))}
        </div>
      )}

      <ReplacementStatus candidate={candidate} />

      {candidate.rationale_md && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            {expanded ? 'Скрыть обоснование' : 'Показать обоснование'}
          </button>
          {expanded && (
            <div className="mt-2 rounded bg-bg-panel/60 p-3">
              <Markdown content={candidate.rationale_md} />
            </div>
          )}
        </div>
      )}

      {proposing && (
        <div className="mt-3">
          <ProposeForm
            candidate={candidate}
            projectId={projectId}
            currentUserId={currentUserId}
            onDone={() => {
              setProposing(false)
              onChanged()
            }}
            onCancel={() => setProposing(false)}
          />
        </div>
      )}
    </div>
  )
}

export function ActiveRotationCard({
  rotation,
  currentUserId,
  onChanged,
}: {
  rotation: RotationFull
  currentUserId: number | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const myApproval = rotation.approvals.find((a) => a.user_id === currentUserId)
  const canApprove =
    rotation.status === 'proposed' && myApproval && myApproval.decision === null
  const canCancel =
    (rotation.status === 'proposed' || rotation.status === 'accepted') &&
    rotation.initiated_by_id === currentUserId
  const canComplete = rotation.status === 'accepted'
  const canRevert = rotation.status === 'completed'

  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const approve = () => {
    const c = prompt('Комментарий (опционально):', '')
    if (c === null) return
    return action(() => api.rotations.approve(rotation.id, c.trim() || null))
  }
  const reject = () => {
    const c = prompt('Причина отклонения:', '')
    if (c === null) return
    return action(() => api.rotations.reject(rotation.id, c.trim() || null))
  }
  const cancel = () => {
    if (!confirm('Отменить запрос на ротацию?')) return
    return action(() => api.rotations.cancel(rotation.id))
  }
  const complete = () => {
    if (
      !confirm(
        'Зафиксировать факт ротации? На исходном проекте left_at=сегодня, на целевом — joined_at=сегодня.',
      )
    )
      return
    return action(() => api.rotations.complete(rotation.id))
  }
  const revert = () => {
    if (!confirm('Откатить факт ротации?')) return
    return action(() => api.rotations.revert(rotation.id))
  }

  return (
    <div className="rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{rotation.employee_name}</span>
        <span className="text-xs text-slate-400">
          {rotation.from_project_name} →{' '}
          {rotation.to_project_name || <em className="text-slate-500">не задан</em>}
        </span>
        <span className={`ml-auto text-xs ${STATUS_CLR[rotation.status]}`}>
          {STATUS_LABEL[rotation.status]}
        </span>
      </div>
      <div className="mt-1 text-xs text-slate-500">
        предложил: {rotation.initiated_by_name} ·{' '}
        {formatDateTime(rotation.proposed_at)}
        {rotation.planned_start_at && (
          <> · план старта {formatDate(rotation.planned_start_at)}</>
        )}
        {rotation.completed_at && (
          <> · завершено {formatDateTime(rotation.completed_at)}</>
        )}
      </div>

      {rotation.approvals.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {rotation.approvals.map((a) => (
            <div key={a.user_id} className="flex flex-wrap items-center gap-2">
              <span className="text-slate-300">{a.user_name}</span>
              {a.decision === 'approve' && (
                <span className="text-emerald-400">согласовал</span>
              )}
              {a.decision === 'reject' && (
                <span className="text-rose-400">отклонил</span>
              )}
              {a.decision === null && (
                <span className="text-amber-400">ожидает решения</span>
              )}
              {a.comment && (
                <span className="text-slate-500">— {a.comment}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {rotation.replacement_employee_id && rotation.replacement_full_name && (
        <div className="mt-2 text-xs text-slate-400">
          Предполагаемая замена:{' '}
          <button
            onClick={() =>
              navigate(`/employees/${rotation.replacement_employee_id}`)
            }
            className="font-medium text-slate-200 hover:text-accent"
            title="Открыть карточку сотрудника"
          >
            {rotation.replacement_full_name}
          </button>
        </div>
      )}

      {rotation.reason_md && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">
            Обоснование
          </summary>
          <div className="mt-2 rounded bg-bg-panel/60 p-3">
            <Markdown content={rotation.reason_md} />
          </div>
        </details>
      )}

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        {canApprove && (
          <>
            <button
              disabled={busy}
              onClick={approve}
              className="rounded bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
            >
              Согласовать
            </button>
            <button
              disabled={busy}
              onClick={reject}
              className="rounded bg-rose-500/15 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/25"
            >
              Отклонить
            </button>
          </>
        )}
        {canCancel && (
          <button
            disabled={busy}
            onClick={cancel}
            className="rounded px-3 py-1 text-xs text-slate-400 hover:text-rose-400"
          >
            Отменить запрос
          </button>
        )}
        {canComplete && (
          <button
            disabled={busy}
            onClick={complete}
            className="rounded bg-accent/20 px-3 py-1 text-xs text-accent hover:bg-accent/30"
          >
            Зафиксировать факт
          </button>
        )}
        {canRevert && (
          <button
            disabled={busy}
            onClick={revert}
            className="rounded px-3 py-1 text-xs text-slate-400 hover:text-amber-400"
          >
            Откатить
          </button>
        )}
        {rotation.to_project_id && (
          <button
            onClick={() => navigate(`/projects/${rotation.to_project_id}`)}
            className="ml-auto rounded px-3 py-1 text-xs text-slate-500 hover:text-slate-300"
          >
            к целевому проекту →
          </button>
        )}
      </div>
    </div>
  )
}

export function RotationsPanel({ projectId }: { projectId: number }) {
  const [data, setData] = useState<RotationsPanelData | null>(null)
  const [activeRots, setActiveRots] = useState<RotationFull[]>([])
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const panel = await api.projects.rotations(projectId)
      setData(panel)
      // активные/недавние ротации по from_project ИЛИ to_project
      const list: RotationListItem[] = await api.rotations.list({
        project_id: projectId,
      })
      const active = list.filter(
        (r) =>
          r.status === 'proposed' ||
          r.status === 'accepted' ||
          r.status === 'completed',
      )
      const fulls = await Promise.all(
        active.map((r) => api.rotations.get(r.id)),
      )
      setActiveRots(fulls)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
    api.me().then((u) => setMe(u.id)).catch(() => undefined)
  }, [refresh])

  // авто-поллинг, пока есть AI-генерации в работе
  useEffect(() => {
    if (!data) return
    const hasRunning = data.candidates.some((c) => c.suggestion_running)
    if (!hasRunning) return
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [data, refresh])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!data) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-6">
      {activeRots.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Активные и недавние ротации
          </h3>
          <div className="space-y-2">
            {activeRots.map((r) => (
              <ActiveRotationCard
                key={r.id}
                rotation={r}
                currentUserId={me}
                onChanged={refresh}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Кандидаты на ротацию
        </h3>
        <div className="mb-3">
          <ScoreHelp />
        </div>
        {data.no_candidates ? (
          <div className="rounded-2xl bg-emerald-500/10 px-6 py-6 text-center text-sm text-emerald-300 ring-1 ring-emerald-500/20">
            Ротация не требуется — никто из активных участников не достиг
            порога 18 месяцев или все заморожены.
          </div>
        ) : (
          <div className="space-y-2">
            {data.candidates.map((c) => (
              <CandidateRow
                key={c.employee_id}
                candidate={c}
                projectId={projectId}
                currentUserId={me}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
