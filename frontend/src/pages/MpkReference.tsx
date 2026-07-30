import { useCallback, useEffect, useState } from 'react'

import { api, Role, RoleProfileDetail } from '../api/client'
import { useReadOnly } from '../lib/auth-context'

const LEVELS = [0, 1, 2, 3, 4, 5] as const

function levelStyle(lvl: number): string {
  if (lvl === 0) return 'text-slate-600 bg-transparent'
  if (lvl <= 2) return 'text-slate-300 bg-bg-panel'
  if (lvl <= 3) return 'text-accent bg-accent/15'
  return 'text-emerald-400 bg-emerald-500/15'
}

function Cell({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled: boolean
}) {
  if (disabled) {
    return (
      <span
        className={`inline-block w-10 rounded py-0.5 text-center text-sm font-semibold ${levelStyle(value)}`}
      >
        {value || '—'}
      </span>
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-10 rounded border-0 py-0.5 text-center text-sm font-semibold outline-none focus:ring-1 focus:ring-accent ${levelStyle(
        value,
      )}`}
    >
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  )
}

export function MpkReference() {
  const readOnly = useReadOnly()
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null)
  const [detail, setDetail] = useState<RoleProfileDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.mpk
      .roles()
      .then((rs) => {
        setRoles(rs)
        if (rs.length > 0) setSelectedRoleId(rs[0].id)
      })
      .catch((e) => setError((e as Error).message))
  }, [])

  const loadDetail = useCallback(async (roleId: number) => {
    try {
      setDetail(null)
      const d = await api.mpk.roleProfile(roleId)
      setDetail(d)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (selectedRoleId !== null) loadDetail(selectedRoleId)
  }, [selectedRoleId, loadDetail])

  const onCellChange = async (
    competency_id: number,
    grade_id: number,
    required_level: number,
  ) => {
    if (!selectedRoleId || !detail) return
    setSaving(true)
    setError(null)
    // оптимистично обновляем локально
    setDetail({
      ...detail,
      competencies: detail.competencies.map((c) => {
        if (c.competency_id !== competency_id) return c
        const levels = { ...c.levels }
        if (required_level === 0) delete levels[grade_id]
        else levels[grade_id] = required_level
        return { ...c, levels }
      }),
    })
    try {
      await api.mpk.patchCell(selectedRoleId, {
        competency_id,
        grade_id,
        required_level,
      })
    } catch (err) {
      setError((err as Error).message)
      await loadDetail(selectedRoleId)
    } finally {
      setSaving(false)
    }
  }

  const onKeyToggle = async (competency_id: number, is_key: boolean) => {
    if (!selectedRoleId || !detail) return
    setSaving(true)
    setError(null)
    setDetail({
      ...detail,
      competencies: detail.competencies.map((c) =>
        c.competency_id === competency_id ? { ...c, is_key } : c,
      ),
    })
    try {
      await api.mpk.patchKey(selectedRoleId, competency_id, is_key)
    } catch (err) {
      setError((err as Error).message)
      await loadDetail(selectedRoleId)
    } finally {
      setSaving(false)
    }
  }

  const keyCount = detail?.competencies.filter((c) => c.is_key).length || 0

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">Справочник МПК</h1>
        <div className="flex-1" />
        {saving && <span className="text-xs text-slate-500">Сохраняем…</span>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-sm text-slate-400">Роль:</span>
          <select
            value={selectedRoleId ?? ''}
            onChange={(e) => setSelectedRoleId(Number(e.target.value))}
            className="min-w-[260px] rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {detail && (
          <div className="text-sm text-slate-400">
            Ключевых компетенций:{' '}
            <span className="text-accent">{keyCount}</span>
            <span className="text-slate-600"> / {detail.competencies.length}</span>
          </div>
        )}
      </div>

      {error && <div className="mb-3 text-sm text-red-400">{error}</div>}
      {!detail && <div className="text-sm text-slate-500">Загрузка…</div>}

      {detail && (
        <div className="overflow-x-auto rounded-2xl bg-bg-elevated">
          <table className="w-full text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="w-10 px-2 py-2 text-center">★</th>
                <th className="px-3 py-2 text-left">Компетенция</th>
                {detail.grades.map((g) => (
                  <th
                    key={g.id}
                    className="w-14 px-1 py-2 text-center text-xs font-semibold"
                  >
                    {g.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.competencies.map((c) => (
                <tr
                  key={c.competency_id}
                  className={`border-t border-white/5 ${
                    c.is_key ? 'bg-accent/5' : ''
                  }`}
                >
                  <td className="px-2 py-1 text-center">
                    <button
                      onClick={() => onKeyToggle(c.competency_id, !c.is_key)}
                      className={`text-base transition ${
                        c.is_key
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-slate-600 hover:text-slate-400'
                      }`}
                      title={c.is_key ? 'Убрать ключевую' : 'Пометить ключевой'}
                    >
                      {c.is_key ? '★' : '☆'}
                    </button>
                  </td>
                  <td className="px-3 py-1">
                    <div className="text-slate-200">{c.competency_name}</div>
                  </td>
                  {detail.grades.map((g) => (
                    <td key={g.id} className="px-1 py-1 text-center">
                      <Cell
                        value={c.levels[g.id] || 0}
                        onChange={(v) => onCellChange(c.competency_id, g.id, v)}
                        disabled={readOnly}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-500">
        <p>
          ★ — ключевая компетенция роли: будет использоваться в AI-генерации при
          включённой опции «только ключевые». Нажмите, чтобы переключить.
        </p>
        <p className="mt-1">
          Ячейки: требуемый уровень владения (0..5) по грейдам. 0 = компетенция не
          требуется. Изменения сохраняются автоматически.
        </p>
      </div>
    </div>
  )
}
