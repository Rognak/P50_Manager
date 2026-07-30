import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  SelfReview,
  SelfReviewListItem,
  SelfReviewStatus,
  api,
} from '../../api/client'
import { useReadOnly } from '../../lib/auth-context'
import { SelfReviewSparkline } from './SelfReviewSparkline'

const STATUS_LABEL: Record<SelfReviewStatus, string> = {
  draft: 'черновик',
  submitted: 'отправлен',
  closed: 'закрыт',
}

const STATUS_CLR: Record<SelfReviewStatus, string> = {
  draft: 'text-amber-400',
  submitted: 'text-accent',
  closed: 'text-emerald-400',
}

const CURRENT_YEAR = new Date().getFullYear()

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function ImportModal({
  employeeId,
  existing,
  onClose,
  onDone,
}: {
  employeeId: number
  existing: SelfReviewListItem[]
  onClose: () => void
  onDone: () => void
}) {
  const [year, setYear] = useState<number>(CURRENT_YEAR - 1)
  const [file, setFile] = useState<File | null>(null)
  const [markClosed, setMarkClosed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const submit = async () => {
    setError(null)
    if (!file) {
      setError('Выберите .docx файл')
      return
    }
    setBusy(true)
    try {
      // 1) если ревью за этот год уже есть — попросим подтверждение
      const found = existing.find((r) => r.year === year)
      let rv: SelfReview
      if (found) {
        const ok = confirm(
          `Ревью за ${year} уже есть (статус: ${STATUS_LABEL[found.status]}). ` +
            `Загрузить в него файл${found.has_source ? ' (текущий будет заменён)' : ''}?`,
        )
        if (!ok) {
          setBusy(false)
          return
        }
        rv = await api.selfReviews.get(employeeId, found.id)
      } else {
        rv = await api.selfReviews.create(employeeId, { year })
      }
      // 2) загрузим файл
      await api.selfReviews.uploadSource(employeeId, rv.id, file)
      // 3) если просили — закроем
      if (markClosed) {
        await api.selfReviews.update(employeeId, rv.id, { status: 'closed' })
      }
      onDone()
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
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">Импортировать отчёт</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div>
            <div className="mb-1 text-xs text-slate-500">Год</div>
            <input
              type="number"
              min={2010}
              max={CURRENT_YEAR + 1}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-32 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-slate-500">Файл</div>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-sm"
            />
            {file && (
              <div className="mt-1 text-xs text-slate-500">
                {file.name} ({Math.round(file.size / 1024)} КБ)
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={markClosed}
              onChange={(e) => setMarkClosed(e.target.checked)}
              className="accent-accent"
            />
            Сразу пометить «закрыто» (исторический отчёт)
          </label>
          {error && <div className="text-xs text-rose-400">{error}</div>}
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
            disabled={busy || !file}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? '…' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SelfReviewTab({ employeeId }: { employeeId: number }) {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [reviews, setReviews] = useState<SelfReviewListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    setError(null)
    try {
      const list = await api.selfReviews.listForEmployee(employeeId)
      setReviews(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [employeeId])

  const planCurrent = async () => {
    const existing = reviews.find((r) => r.year === CURRENT_YEAR)
    if (existing) {
      navigate(`/self-review/${employeeId}/${existing.id}`)
      return
    }
    setCreating(true)
    try {
      const rv = await api.selfReviews.create(employeeId, { year: CURRENT_YEAR })
      navigate(`/self-review/${employeeId}/${rv.id}`)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>

  const sorted = [...reviews].sort((a, b) => b.year - a.year)
  const hasCurrent = sorted.some((r) => r.year === CURRENT_YEAR)

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={planCurrent}
            disabled={creating}
            className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {creating
              ? '…'
              : hasCurrent
                ? `Открыть ревью ${CURRENT_YEAR}`
                : `+ запланировать ${CURRENT_YEAR}`}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg bg-bg-panel px-3 py-1.5 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent"
          >
            + импортировать прошлый отчёт
          </button>
        </div>
      )}

      {showImport && (
        <ImportModal
          employeeId={employeeId}
          existing={reviews}
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false)
            refresh()
          }}
        />
      )}

      {sorted.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Self-Review ещё не проводился. Запланируйте на текущий год или
          импортируйте старый отчёт.
        </div>
      ) : (
        <>
          <SelfReviewSparkline reviews={sorted} />
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="w-20 px-4 py-3">Год</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Файл</th>
                <th className="px-4 py-3">Оценки (проект/компания)</th>
                <th className="px-4 py-3">Создан</th>
                <th className="px-4 py-3">Закрыт</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/self-review/${employeeId}/${r.id}`)}
                  className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                >
                  <td className="px-4 py-3 font-medium">{r.year}</td>
                  <td className={`px-4 py-3 text-xs ${STATUS_CLR[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.has_source ? 'загружен' : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {r.project_score ?? '—'}
                    <span className="text-slate-600"> / </span>
                    {r.company_score ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(r.created_at)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(r.closed_at)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">→</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  )
}
