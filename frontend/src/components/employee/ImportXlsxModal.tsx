import { useEffect, useRef, useState } from 'react'

import { Department, EmployeeImportPreview, api } from '../../api/client'

type Step = 'pick' | 'preview' | 'done'

export function ImportXlsxModal({
  onClose,
  onImported,
}: {
  onClose: () => void
  onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(
    null,
  )

  // Свои отделы (где is_owner=true). Если ровно один — preselect, скрываем выбор.
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [deptLoaded, setDeptLoaded] = useState(false)

  useEffect(() => {
    api.departments
      .list()
      .then((all) => {
        const own = all.filter((d) => d.is_owner)
        setDepartments(own)
        if (own.length === 1) setDepartmentId(own[0].id)
        setDeptLoaded(true)
      })
      .catch(() => setDeptLoaded(true))
  }, [])

  const departmentName =
    departments.find((d) => d.id === departmentId)?.name || null

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const p = await api.employees.importXlsx.preview(file, departmentId)
      setPreview(p)
      setStep('preview')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.employees.importXlsx.commit({
        rows: preview.rows.filter((r) => r.action === 'create'),
      })
      setResult({ created: res.created, skipped: res.skipped })
      setStep('done')
      onImported()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-2xl bg-bg-elevated ring-1 ring-white/10">
        <div className="flex items-baseline justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">Импорт сотрудников из Excel</h2>
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-200"
          >
            ✕ закрыть
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {step === 'pick' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Загрузите файл <code className="text-slate-300">.xlsx</code> со
                списком сотрудников. Первая строка — заголовки. Импортируем:{' '}
                <span className="text-slate-300">
                  ФИО, Email, Должность, Стаж работы
                </span>
                .
              </p>
              <p className="text-xs text-slate-500">
                Роль, грейд и прочие поля МПК проставляются вручную в карточке
                сотрудника после импорта — там и удобнее, и нет риска
                ошибочного автоматического маппинга.
              </p>

              {/* Выбор отдела */}
              {deptLoaded && departments.length === 0 && (
                <div className="rounded-lg bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/20">
                  У вас нет ни одного отдела. Импортируемые сотрудники будут
                  созданы без привязки к отделу — добавьте отдел в разделе{' '}
                  <strong>Тех. зрелость практик</strong>, или продолжите без
                  привязки.
                </div>
              )}
              {deptLoaded && departments.length === 1 && (
                <div className="text-sm text-slate-400">
                  Сотрудники будут привязаны к отделу:{' '}
                  <span className="text-slate-200">
                    {departments[0].name}
                  </span>
                </div>
              )}
              {deptLoaded && departments.length > 1 && (
                <label className="block text-sm">
                  <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
                    Отдел для импортируемых сотрудников
                  </span>
                  <select
                    value={departmentId === null ? '' : String(departmentId)}
                    onChange={(e) =>
                      setDepartmentId(
                        e.target.value === '' ? null : Number(e.target.value),
                      )
                    }
                    className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
                  >
                    <option value="">— без привязки к отделу —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <p className="text-xs text-slate-500">
                Дедуп: если сотрудник с таким email уже есть в вашей команде —
                строка будет пропущена.
              </p>

              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onFile(f)
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy || !deptLoaded}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
              >
                {busy ? 'Парсим…' : 'Выбрать файл'}
              </button>
              {error && (
                <div className="text-sm text-rose-400">Ошибка: {error}</div>
              )}
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div>
                  Найдено строк:{' '}
                  <span className="text-slate-200">{preview.total_rows}</span>
                </div>
                <div className="text-emerald-400">
                  К созданию: <strong>{preview.to_create}</strong>
                </div>
                <div className="text-amber-400">
                  Пропустим: {preview.to_skip}
                </div>
                {preview.errors > 0 && (
                  <div className="text-rose-400">Ошибок: {preview.errors}</div>
                )}
                {departmentName && (
                  <div className="ml-auto text-xs text-slate-500">
                    отдел:{' '}
                    <span className="text-slate-300">{departmentName}</span>
                  </div>
                )}
              </div>

              <div className="overflow-hidden rounded-lg ring-1 ring-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg-panel text-slate-400">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Статус</th>
                      <th className="px-3 py-2">ФИО</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Должность</th>
                      <th className="px-3 py-2">В команде с</th>
                      <th className="px-3 py-2">Сообщения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const tone =
                        r.action === 'create'
                          ? 'text-emerald-400'
                          : r.action === 'skip'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                      return (
                        <tr
                          key={r.row}
                          className="border-t border-white/5 align-top"
                        >
                          <td className="px-3 py-2 text-slate-500">{r.row}</td>
                          <td className={`px-3 py-2 ${tone}`}>
                            {r.action === 'create'
                              ? 'создать'
                              : r.action === 'skip'
                                ? 'пропуск'
                                : 'ошибка'}
                          </td>
                          <td className="px-3 py-2">
                            {r.full_name || (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {r.email || (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {r.position || (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {r.hired_at || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {r.error && (
                              <div className="text-rose-400">{r.error}</div>
                            )}
                            {r.warnings.length > 0 && (
                              <ul className="space-y-0.5">
                                {r.warnings.map((w, i) => (
                                  <li key={i} className="text-amber-400/80">
                                    · {w}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {error && (
                <div className="text-sm text-rose-400">Ошибка: {error}</div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={commit}
                  disabled={busy || preview.to_create === 0}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
                >
                  {busy
                    ? 'Импортируем…'
                    : `Импортировать ${preview.to_create}`}
                </button>
                <button
                  onClick={() => {
                    setPreview(null)
                    setStep('pick')
                  }}
                  className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
                >
                  Назад
                </button>
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div className="space-y-3 text-sm">
              <div className="text-emerald-400">
                ✓ Импортировано: <strong>{result.created}</strong>
              </div>
              {result.skipped > 0 && (
                <div className="text-slate-400">
                  Пропущено: {result.skipped}
                </div>
              )}
              <p className="text-xs text-slate-500">
                Проставьте роль/грейд в карточках сотрудников вручную.
              </p>
              <button
                onClick={onClose}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
              >
                Готово
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
