import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Department, api } from '../api/client'
import { DeptMaturityPanel } from '../components/department/DeptMaturityPanel'

export function DepartmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const departmentId = Number(id)
  const [dept, setDept] = useState<Department | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const refresh = useCallback(async () => {
    try {
      const d = await api.departments.get(departmentId)
      setDept(d)
      setEditName(d.name)
      setEditDesc(d.description || '')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [departmentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const save = async () => {
    if (!dept) return
    try {
      await api.departments.update(departmentId, {
        name: editName.trim(),
        description: editDesc.trim() || null,
      })
      setEditing(false)
      await refresh()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const remove = async () => {
    if (!confirm('Удалить отдел? История опросников также удалится.')) return
    try {
      await api.departments.delete(departmentId)
      navigate('/departments')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!dept) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-8">
      <div>
        <button
          onClick={() => navigate('/departments')}
          className="mb-4 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Тех. зрелость практик
        </button>

        {!editing ? (
          <>
            <h1 className="text-2xl font-semibold">{dept.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span>Руководитель: {dept.owner_name || '—'}</span>
              {dept.is_owner && (
                <>
                  <button
                    onClick={() => setEditing(true)}
                    className="ml-auto text-xs text-slate-500 hover:text-slate-300"
                  >
                    редактировать
                  </button>
                  <button
                    onClick={remove}
                    className="text-xs text-slate-500 hover:text-red-400"
                  >
                    удалить
                  </button>
                </>
              )}
            </div>
            {dept.description && (
              <div className="mt-3 max-w-3xl text-sm text-slate-400">
                {dept.description}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3 rounded-2xl bg-bg-elevated p-4">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <textarea
              rows={3}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
              >
                Сохранить
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </div>

      <DeptMaturityPanel
        departmentId={departmentId}
        canEdit={dept.is_owner}
      />
    </div>
  )
}
