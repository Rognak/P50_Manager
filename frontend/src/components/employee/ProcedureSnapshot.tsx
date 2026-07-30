import { useEffect, useState } from 'react'

import { api, ProcedureSnapshot as Snapshot } from '../../api/client'

function LevelBadge({ level, muted = false }: { level: number; muted?: boolean }) {
  const style = muted ? 'text-slate-400 bg-bg-panel' : 'text-accent bg-accent/15'
  return (
    <span
      className={`inline-block min-w-[1.5rem] rounded px-1.5 text-center text-xs font-semibold ${style}`}
    >
      {level}
    </span>
  )
}

function GapBadge({ gap }: { gap: number }) {
  if (gap === 0) return <span className="text-xs text-slate-500">0</span>
  if (gap > 0) return <span className="text-xs font-semibold text-amber-400">+{gap}</span>
  return <span className="text-xs font-semibold text-emerald-400">{gap}</span>
}

export function ProcedureSnapshotView({
  employeeId,
  procedureId,
}: {
  employeeId: number
  procedureId: number
}) {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.employees.procedures
      .snapshot(employeeId, procedureId)
      .then(setData)
      .catch((e) => setError((e as Error).message))
  }, [employeeId, procedureId])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!data) return <div className="text-sm text-slate-500">Загрузка среза…</div>

  const measured = data.items.filter((i) => i.procedure_level !== null)
  if (measured.length === 0) {
    return (
      <div className="text-xs text-slate-500">
        В рамках процедуры ещё нет оценок. Зафиксируйте их в карточках встреч — они попадут
        сюда автоматически.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg bg-bg-panel">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="px-3 py-2">Компетенция</th>
            <th className="w-24 px-3 py-2 text-center">В процедуре</th>
            <th className="w-24 px-3 py-2 text-center">Требуемый</th>
            <th className="w-16 px-3 py-2 text-center">Δ</th>
          </tr>
        </thead>
        <tbody>
          {measured.map((i) => (
            <tr key={i.competency_id} className="border-t border-white/5">
              <td className="px-3 py-2">{i.competency_name}</td>
              <td className="px-3 py-2 text-center">
                <LevelBadge level={i.procedure_level!} />
              </td>
              <td className="px-3 py-2 text-center">
                {i.required_level === null ? (
                  <span className="text-slate-600">—</span>
                ) : (
                  <LevelBadge level={i.required_level} muted />
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {i.gap === null ? (
                  <span className="text-slate-600">—</span>
                ) : (
                  <GapBadge gap={i.gap} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
