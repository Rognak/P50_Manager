import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  Employee,
  SelfReviewListItem,
  SelfReviewStatus,
  api,
} from '../api/client'
import { UpcomingMeetingsWidget } from '../components/UpcomingMeetingsWidget'
import { useCurrentUser, useReadOnly } from '../lib/auth-context'

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

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const CURRENT_YEAR = new Date().getFullYear()

export function SelfReviewList() {
  const readOnly = useReadOnly()
  const currentUser = useCurrentUser()
  const isCoreTeam = currentUser?.role === 'core_team'
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [allReviews, setAllReviews] = useState<SelfReviewListItem[]>([])
  const [year, setYear] = useState(CURRENT_YEAR)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingFor, setCreatingFor] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | SelfReviewStatus>('all')
  const [stuckOnly, setStuckOnly] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<number | 'all'>('all')

  const refresh = async () => {
    try {
      const [emps, revs] = await Promise.all([
        api.employees.list(),
        api.selfReviews.listAll(),
      ])
      setEmployees(emps)
      setAllReviews(revs)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const reviewByEmpYear = useMemo(() => {
    const m = new Map<string, SelfReviewListItem>()
    for (const r of allReviews) m.set(`${r.employee_id}-${r.year}`, r)
    return m
  }, [allReviews])

  const STUCK_DAYS = 14
  const isStuck = (r: SelfReviewListItem): boolean => {
    if (r.status !== 'submitted') return false
    if (!r.submitted_at) return false
    const days =
      (Date.now() - new Date(r.submitted_at).getTime()) / 86400000
    return days > STUCK_DAYS
  }

  const matchesFilters = (r: SelfReviewListItem): boolean => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false
    if (stuckOnly && !isStuck(r)) return false
    if (ownerFilter !== 'all' && r.owner_id !== ownerFilter) return false
    return true
  }

  const owners = useMemo(() => {
    const map = new Map<number, string>()
    for (const e of employees) {
      if (e.owner) map.set(e.owner.id, e.owner.full_name)
    }
    for (const r of allReviews) {
      if (r.owner_id != null && r.owner_name) map.set(r.owner_id, r.owner_name)
    }
    return Array.from(map.entries())
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [employees, allReviews])

  const visibleEmployees = useMemo(
    () =>
      employees.filter(
        (e) => ownerFilter === 'all' || e.owner_id === ownerFilter,
      ),
    [employees, ownerFilter],
  )

  const yearReviews = useMemo(
    () => allReviews.filter((r) => r.year === year),
    [allReviews, year],
  )

  const filteredReviews = useMemo(
    () => yearReviews.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [yearReviews, statusFilter, stuckOnly],
  )

  const filteredEmpIds = useMemo(
    () => new Set(filteredReviews.map((r) => r.employee_id)),
    [filteredReviews],
  )

  const filtersActive = statusFilter !== 'all' || stuckOnly || ownerFilter !== 'all'

  const yearStats = useMemo(() => {
    const submitted = yearReviews.filter((r) => r.status === 'submitted').length
    const drafts = yearReviews.filter((r) => r.status === 'draft').length
    const closed = yearReviews.filter((r) => r.status === 'closed').length
    const projectScores = yearReviews
      .map((r) => r.project_score)
      .filter((s): s is number => s !== null)
    const companyScores = yearReviews
      .map((r) => r.company_score)
      .filter((s): s is number => s !== null)
    const avg = (xs: number[]) =>
      xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
    return {
      total: yearReviews.length,
      drafts,
      submitted,
      closed,
      avg_project: avg(projectScores),
      avg_company: avg(companyScores),
    }
  }, [yearReviews])

  const create = async (employeeId: number) => {
    setCreatingFor(employeeId)
    try {
      const rv = await api.selfReviews.create(employeeId, { year })
      navigate(`/self-review/${employeeId}/${rv.id}`)
    } catch (e) {
      alert((e as Error).message)
      setCreatingFor(null)
    }
  }

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>

  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Self-Review</h1>
          <p className="mt-1 text-sm text-slate-500">
            Годовой Performance Review. Загружаете заполненный сотрудником .docx,
            заполняете заметки, AI помогает с темами 1:1, сравнением с прошлым годом,
            калибровкой и анализом выгорания.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Год:</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          >
            {[CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map(
              (y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ),
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl bg-bg-elevated p-4">
          <div className="text-xs text-slate-400">Всего за год</div>
          <div className="mt-1 text-2xl font-semibold text-accent">
            {yearStats.total}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4">
          <div className="text-xs text-slate-400">Черновиков</div>
          <div className="mt-1 text-2xl font-semibold text-amber-400">
            {yearStats.drafts}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4">
          <div className="text-xs text-slate-400">Отправлено</div>
          <div className="mt-1 text-2xl font-semibold text-accent">
            {yearStats.submitted}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4">
          <div className="text-xs text-slate-400">Закрыто</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-400">
            {yearStats.closed}
          </div>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-4">
          <div className="text-xs text-slate-400">Средние оценки</div>
          <div className="mt-1 text-sm text-slate-300">
            проект:{' '}
            <span className="text-accent">
              {yearStats.avg_project ?? '—'}
            </span>
            <br />
            компания:{' '}
            <span className="text-accent">
              {yearStats.avg_company ?? '—'}
            </span>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ближайшие 1:1 по ревью
        </h2>
        <UpcomingMeetingsWidget
          filterKinds={['self_review']}
          emptyHint="Нет запланированных 1:1 по Self-Review. Откройте карточку ревью и поставьте дату."
        />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Сотрудники
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {isCoreTeam && (
              <>
                <span className="text-slate-500">Руководитель:</span>
                <select
                  value={ownerFilter === 'all' ? 'all' : String(ownerFilter)}
                  onChange={(ev) =>
                    setOwnerFilter(
                      ev.target.value === 'all'
                        ? 'all'
                        : Number(ev.target.value),
                    )
                  }
                  className="rounded bg-bg-panel px-2 py-1 ring-1 ring-white/5 outline-none focus:ring-accent"
                >
                  <option value="all">все ({employees.length})</option>
                  {owners.map((u) => {
                    const cnt = employees.filter(
                      (e) => e.owner_id === u.id,
                    ).length
                    return (
                      <option key={u.id} value={u.id}>
                        {u.full_name} ({cnt})
                      </option>
                    )
                  })}
                </select>
              </>
            )}
            <span className="text-slate-500">Статус:</span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
              className="rounded bg-bg-panel px-2 py-1 ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="all">все</option>
              <option value="draft">черновики</option>
              <option value="submitted">отправлены</option>
              <option value="closed">закрыты</option>
            </select>
            <label className="ml-2 flex items-center gap-1 text-slate-300">
              <input
                type="checkbox"
                checked={stuckOnly}
                onChange={(e) => setStuckOnly(e.target.checked)}
                className="accent-accent"
              />
              зависшие (submitted &gt; {STUCK_DAYS} дн)
            </label>
            {filtersActive && (
              <button
                onClick={() => {
                  setStatusFilter('all')
                  setStuckOnly(false)
                  setOwnerFilter('all')
                }}
                className="text-slate-500 hover:text-rose-400"
              >
                сброс
              </button>
            )}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">ФИО</th>
                <th className="px-4 py-3">Роль / грейд</th>
                {isCoreTeam && (
                  <th className="px-4 py-3">Руководитель</th>
                )}
                <th className="px-4 py-3">Self-Review {year}</th>
                <th className="px-4 py-3">Оценки (проект/компания)</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees
                .filter((e) => {
                  if (!filtersActive) return true
                  // владелец-фильтр уже применён к visibleEmployees;
                  // здесь оставляем только те, у которых ревью прошло matchesFilters
                  // — или просто показываем сотрудника, если нужны все.
                  if (ownerFilter !== 'all' && statusFilter === 'all' && !stuckOnly)
                    return true
                  return filteredEmpIds.has(e.id)
                })
                .map((e) => {
                const rv = reviewByEmpYear.get(`${e.id}-${year}`)
                return (
                  <tr key={e.id} className="border-t border-white/5">
                    <td className="px-4 py-3">{e.full_name}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {e.role?.name || '—'}
                      {e.grade?.code && ` · ${e.grade.code}`}
                    </td>
                    {isCoreTeam && (
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {e.owner?.full_name || '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {rv ? (
                        <button
                          onClick={() => navigate(`/self-review/${e.id}/${rv.id}`)}
                          className={`text-left text-xs hover:underline ${STATUS_CLR[rv.status]}`}
                        >
                          {STATUS_LABEL[rv.status]}
                          {rv.has_source && (
                            <span className="ml-2 text-slate-500">· файл загружен</span>
                          )}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600">нет ревью</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {rv ? (
                        <>
                          {rv.project_score ?? '—'}
                          <span className="text-slate-600"> / </span>
                          {rv.company_score ?? '—'}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rv ? (
                        <button
                          onClick={() => navigate(`/self-review/${e.id}/${rv.id}`)}
                          className="text-xs text-accent hover:underline"
                        >
                          открыть →
                        </button>
                      ) : !readOnly ? (
                        <button
                          disabled={creatingFor === e.id}
                          onClick={() => create(e.id)}
                          className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-30"
                        >
                          {creatingFor === e.id ? '…' : `+ запланировать ${year}`}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Дата создания / отправки фиксируется автоматически. Удалить ревью можно из карточки.
        </div>
      </section>

      {(() => {
        const archive = allReviews
          .filter((r) => r.year < year && matchesFilters(r))
          .sort((a, b) => b.year - a.year)
        if (archive.length === 0) return null
        return (
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Прошлых лет ({archive.length})
            </h2>
            <div className="overflow-hidden rounded-2xl bg-bg-elevated">
              <table className="w-full text-left text-sm">
                <thead className="bg-bg-panel text-slate-400">
                  <tr>
                    <th className="px-4 py-3">ФИО</th>
                    {isCoreTeam && (
                      <th className="px-4 py-3">Руководитель</th>
                    )}
                    <th className="px-4 py-3">Год</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Оценки</th>
                    <th className="px-4 py-3">Создан</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {archive.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-white/5 hover:bg-bg-panel/40"
                    >
                      <td className="px-4 py-3">{r.employee_name || '—'}</td>
                      {isCoreTeam && (
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {r.owner_name || '—'}
                        </td>
                      )}
                      <td className="px-4 py-3">{r.year}</td>
                      <td className={`px-4 py-3 text-xs ${STATUS_CLR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {r.project_score ?? '—'} / {r.company_score ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() =>
                            navigate(`/self-review/${r.employee_id}/${r.id}`)
                          }
                          className="text-xs text-accent hover:underline"
                        >
                          открыть →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })()}
    </div>
  )
}
