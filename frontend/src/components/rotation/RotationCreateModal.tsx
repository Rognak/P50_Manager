import { useEffect, useMemo, useState } from 'react'

import {
  CurrentUser,
  Project,
  ProjectListItem,
  ProjectMember,
  api,
} from '../../api/client'

function defaultPlannedStart(): string {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

interface AutoApproverEntry {
  user_id: number
  labels: string[]
}

function computeAutoApprovers(args: {
  fromProj: Project | null
  toProj: Project | null
  fromEmp: ProjectMember | null
  toEmp: ProjectMember | null
}): AutoApproverEntry[] {
  const { fromProj, toProj, fromEmp, toEmp } = args
  const map = new Map<number, string[]>()
  const add = (uid: number | undefined, lbl: string) => {
    if (uid === undefined || uid === null) return
    const arr = map.get(uid) ?? []
    if (!arr.includes(lbl)) arr.push(lbl)
    map.set(uid, arr)
  }
  if (fromProj) add(fromProj.created_by, 'менеджер исходного проекта')
  if (toProj) add(toProj.created_by, 'менеджер целевого проекта')
  if (fromEmp) add(fromEmp.owner_id, 'руководитель сотрудника')
  if (toEmp) add(toEmp.owner_id, 'руководитель замены')
  return Array.from(map.entries()).map(([user_id, labels]) => ({ user_id, labels }))
}

export function RotationCreateModal({
  initialFromProjectId,
  initialFromEmployeeId,
  onClose,
  onCreated,
}: {
  initialFromProjectId?: number
  initialFromEmployeeId?: number
  onClose: () => void
  onCreated: () => void
}) {
  const [allProjects, setAllProjects] = useState<ProjectListItem[]>([])
  const [allUsers, setAllUsers] = useState<CurrentUser[]>([])
  const [me, setMe] = useState<number | null>(null)

  const [fromProjId, setFromProjId] = useState<number | ''>(
    initialFromProjectId ?? '',
  )
  const [toProjId, setToProjId] = useState<number | ''>('')
  const [fromEmpId, setFromEmpId] = useState<number | ''>(
    initialFromEmployeeId ?? '',
  )
  const [toEmpId, setToEmpId] = useState<number | ''>('')

  const [fromProj, setFromProj] = useState<Project | null>(null)
  const [toProj, setToProj] = useState<Project | null>(null)

  const [plannedStart, setPlannedStart] = useState(defaultPlannedStart())
  const [reason, setReason] = useState('')
  const [extraApproverIds, setExtraApproverIds] = useState<number[]>([])
  const [showApproverPicker, setShowApproverPicker] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // load shared lists
  useEffect(() => {
    api.projects
      .list()
      .then((list) => setAllProjects(list.filter((p) => p.status === 'active')))
      .catch(() => undefined)
    api.users
      .list()
      .then(setAllUsers)
      .catch(() => undefined)
    api
      .me()
      .then((u) => setMe(u.id))
      .catch(() => undefined)
  }, [])

  // load fromProj when fromProjId changes
  useEffect(() => {
    if (typeof fromProjId !== 'number') {
      setFromProj(null)
      return
    }
    api.projects
      .get(fromProjId)
      .then(setFromProj)
      .catch(() => setFromProj(null))
  }, [fromProjId])

  useEffect(() => {
    if (typeof toProjId !== 'number') {
      setToProj(null)
      return
    }
    api.projects
      .get(toProjId)
      .then(setToProj)
      .catch(() => setToProj(null))
  }, [toProjId])

  // сбрасываем выбор сотрудника, если он не активный участник проекта
  // ИЛИ заморожен от ротации
  useEffect(() => {
    if (!fromProj) return
    if (
      typeof fromEmpId === 'number' &&
      !fromProj.members.some(
        (m) =>
          m.employee_id === fromEmpId &&
          m.left_at === null &&
          !m.rotation_locked,
      )
    ) {
      setFromEmpId('')
    }
  }, [fromProj, fromEmpId])

  useEffect(() => {
    if (!toProj) return
    if (
      typeof toEmpId === 'number' &&
      !toProj.members.some(
        (m) =>
          m.employee_id === toEmpId &&
          m.left_at === null &&
          !m.rotation_locked,
      )
    ) {
      setToEmpId('')
    }
  }, [toProj, toEmpId])

  const fromMember = useMemo(
    () =>
      fromProj?.members.find(
        (m) => m.employee_id === fromEmpId && m.left_at === null,
      ) ?? null,
    [fromProj, fromEmpId],
  )
  const toMember = useMemo(
    () =>
      toProj?.members.find(
        (m) => m.employee_id === toEmpId && m.left_at === null,
      ) ?? null,
    [toProj, toEmpId],
  )

  const autoApprovers = useMemo(
    () =>
      computeAutoApprovers({
        fromProj,
        toProj,
        fromEmp: fromMember,
        toEmp: toMember,
      }),
    [fromProj, toProj, fromMember, toMember],
  )
  const autoApproverIds = autoApprovers.map((a) => a.user_id)
  const totalApproverIds = Array.from(
    new Set([...autoApproverIds, ...extraApproverIds]),
  )

  const userById = (id: number) => allUsers.find((u) => u.id === id)
  const labelFor = (uid: number) =>
    autoApprovers.find((a) => a.user_id === uid)?.labels.join(', ') ?? 'вручную'

  const submit = async () => {
    setError(null)
    if (typeof fromProjId !== 'number' || typeof toProjId !== 'number') {
      setError('Выберите оба проекта')
      return
    }
    if (fromProjId === toProjId) {
      setError('Целевой и исходный проект должны различаться')
      return
    }
    if (typeof fromEmpId !== 'number') {
      setError('Выберите сотрудника, которого ротируем')
      return
    }
    if (fromMember?.rotation_locked) {
      setError(
        `Участник заморожен от ротации${
          fromMember.rotation_lock_note ? `: ${fromMember.rotation_lock_note}` : ''
        }`,
      )
      return
    }
    setBusy(true)
    try {
      await api.rotations.propose({
        employee_id: fromEmpId,
        from_project_id: fromProjId,
        to_project_id: toProjId,
        reason_md: reason.trim() || null,
        planned_start_at: plannedStart || null,
        extra_approver_ids: extraApproverIds,
        replacement_employee_id: typeof toEmpId === 'number' ? toEmpId : null,
      })
      onCreated()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
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
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">Создать ротацию</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* ОТКУДА */}
            <div className="space-y-3 rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Откуда
              </div>
              <ProjectAndEmployeePicker
                projectId={fromProjId}
                onProjectChange={setFromProjId}
                employeeId={fromEmpId}
                onEmployeeChange={setFromEmpId}
                project={fromProj}
                projects={allProjects}
                excludeProjectId={
                  typeof toProjId === 'number' ? toProjId : undefined
                }
                employeeLabel="Сотрудник для ротации"
              />
            </div>

            {/* КУДА */}
            <div className="space-y-3 rounded-lg bg-bg-panel/40 p-4 ring-1 ring-white/5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Куда
              </div>
              <ProjectAndEmployeePicker
                projectId={toProjId}
                onProjectChange={setToProjId}
                employeeId={toEmpId}
                onEmployeeChange={setToEmpId}
                project={toProj}
                projects={allProjects}
                excludeProjectId={
                  typeof fromProjId === 'number' ? fromProjId : undefined
                }
                employeeLabel="Замена (необязательно)"
                allowEmptyEmployee
                excludeEmployeeId={
                  typeof fromEmpId === 'number' ? fromEmpId : undefined
                }
              />
              <div className="text-xs text-slate-500">
                Замена — действующий участник целевого проекта, который займёт
                освобождающееся место. Можно оставить пустым.
              </div>
            </div>
          </div>

          {/* Дата */}
          <div>
            <div className="mb-1 text-xs text-slate-500">Дата начала ротации</div>
            <input
              type="date"
              value={plannedStart}
              onChange={(e) => setPlannedStart(e.target.value)}
              className="w-full max-w-xs rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
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
                Заполните проекты и сотрудников — согласующие появятся автоматически.
              </div>
            ) : (
              <div className="space-y-1">
                {totalApproverIds.map((uid) => {
                  const u = userById(uid)
                  const isAuto = autoApproverIds.includes(uid)
                  const isInitiator = uid === me
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
                      <span className="text-slate-500">
                        · {isAuto ? labelFor(uid) : 'вручную'}
                      </span>
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
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {allUsers
                    .filter(
                      (u) =>
                        u.id !== me && !totalApproverIds.includes(u.id),
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

          {/* Обоснование */}
          <div>
            <div className="mb-1 text-xs text-slate-500">Обоснование (Markdown)</div>
            <textarea
              rows={4}
              placeholder="Почему сейчас, что развить, нюансы плана."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? '…' : 'Создать запрос'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectAndEmployeePicker({
  projectId,
  onProjectChange,
  employeeId,
  onEmployeeChange,
  project,
  projects,
  excludeProjectId,
  employeeLabel,
  allowEmptyEmployee = false,
  excludeEmployeeId,
}: {
  projectId: number | ''
  onProjectChange: (id: number | '') => void
  employeeId: number | ''
  onEmployeeChange: (id: number | '') => void
  project: Project | null
  projects: ProjectListItem[]
  excludeProjectId?: number
  employeeLabel: string
  allowEmptyEmployee?: boolean
  excludeEmployeeId?: number
}) {
  // активные участники без заморозки и без исключённых id
  const activeMembers = (project?.members ?? []).filter(
    (m) =>
      m.left_at === null &&
      !m.rotation_locked &&
      m.employee_id !== excludeEmployeeId,
  )
  const lockedCount = (project?.members ?? []).filter(
    (m) => m.left_at === null && m.rotation_locked,
  ).length

  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs text-slate-500">Проект</div>
        <select
          value={projectId}
          onChange={(e) =>
            onProjectChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          className="w-full rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        >
          <option value="">— выберите проект —</option>
          {projects
            .filter((p) => p.id !== excludeProjectId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.code ? ` (${p.code})` : ''}
              </option>
            ))}
        </select>
      </div>
      <div>
        <div className="mb-1 text-xs text-slate-500">{employeeLabel}</div>
        <select
          value={employeeId}
          onChange={(e) =>
            onEmployeeChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          disabled={typeof projectId !== 'number'}
          className="w-full rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent disabled:opacity-50"
        >
          <option value="">
            {allowEmptyEmployee ? '— без замены —' : '— выберите сотрудника —'}
          </option>
          {activeMembers.map((m) => (
            <option key={m.id} value={m.employee_id}>
              {m.full_name}
              {m.role_name ? ` · ${m.role_name}` : ''}
              {m.grade_code ? ` ${m.grade_code}` : ''}
            </option>
          ))}
        </select>
        {lockedCount > 0 && (
          <div className="mt-1 text-[11px] text-slate-500">
            заморожено от ротации: {lockedCount} (скрыты в списке)
          </div>
        )}
      </div>
    </div>
  )
}
