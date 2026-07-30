import { FormEvent, ReactNode, useEffect, useState } from 'react'

import { api, Department, Employee, Grade, Role } from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm text-slate-400">{label}</div>
      {children}
    </label>
  )
}

function Input(props: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <input
      type={props.type || 'text'}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
    />
  )
}

function Select(props: {
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
    >
      {props.children}
    </select>
  )
}

export function ProfileTab({
  employee,
  onChange,
}: {
  employee: Employee
  onChange: () => void
}) {
  const readOnly = useReadOnly()
  const [roles, setRoles] = useState<Role[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [fullName, setFullName] = useState(employee.full_name)
  const [email, setEmail] = useState(employee.email || '')
  const [position, setPosition] = useState(employee.position || '')
  const [roleId, setRoleId] = useState(employee.role?.id.toString() || '')
  const [gradeId, setGradeId] = useState(employee.grade?.id.toString() || '')
  const [departmentId, setDepartmentId] = useState(
    employee.department?.id.toString() || '',
  )
  const [hiredAt, setHiredAt] = useState(employee.hired_at || '')
  const [leftAt, setLeftAt] = useState(employee.left_at || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    api.mpk.roles().then(setRoles)
    api.mpk.grades().then(setGrades)
    api.departments.list().then(setDepartments).catch(() => undefined)
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      await api.employees.update(employee.id, {
        full_name: fullName.trim(),
        email: email.trim() || null,
        position: position.trim() || null,
        role_id: roleId ? Number(roleId) : null,
        grade_id: gradeId ? Number(gradeId) : null,
        department_id: departmentId ? Number(departmentId) : null,
        hired_at: hiredAt || null,
        left_at: leftAt || null,
      })
      setMsg('Сохранено')
      onChange()
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4 rounded-2xl bg-bg-elevated p-6">
      <Field label="ФИО">
        <Input value={fullName} onChange={setFullName} />
      </Field>
      <Field label="Email">
        <Input value={email} onChange={setEmail} type="email" />
      </Field>
      <Field label="Должность">
        <Input value={position} onChange={setPosition} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Роль МПК">
          <Select value={roleId} onChange={setRoleId}>
            <option value="">— не задана —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Грейд">
          <Select value={gradeId} onChange={setGradeId}>
            <option value="">— не задан —</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Отдел / практика">
        <Select value={departmentId} onChange={setDepartmentId}>
          <option value="">— не привязан —</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Дата найма">
          <Input value={hiredAt} onChange={setHiredAt} type="date" />
        </Field>
        <Field label="Дата ухода (если ушёл)">
          <Input value={leftAt} onChange={setLeftAt} type="date" />
        </Field>
      </div>
      {leftAt && (
        <div className="rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-300 ring-1 ring-amber-500/20">
          Сотрудник помечен как ушедший с {leftAt}. Он не учитывается в активных
          метриках, но история (МПК, проекты, ревью) сохраняется.
        </div>
      )}
      <div className="flex items-center gap-4 pt-2">
        {!readOnly ? (
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        ) : (
          <span className="text-xs text-slate-500">
            режим просмотра — редактирование недоступно
          </span>
        )}
        {msg && <span className="text-sm text-slate-400">{msg}</span>}
      </div>
    </form>
  )
}
