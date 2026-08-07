import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  EmployeeSearchItem,
  Product,
  ProductListItem,
  ProductTechnology,
  ProductStatus,
  ProjectCoverage,
  ProjectExtractedCompetenciesResponse,
  ProjectExtractedCompetencyItem,
  ProjectGradeDistribution,
  PullRequestPublic,
  RotationApproverPreview,
  RotationListItem,
  RotationsPanel,
  api,
} from '../api/client'
import { CodeBuddyErrorBanner } from '../components/CodeBuddyErrorBanner'
import { PerformancePanel } from '../components/product/PerformancePanel'
import { StackEditor } from '../components/project/StackEditor'
import { TechMaturityPanel } from '../components/project/TechMaturityPanel'
import { useReadOnly } from '../lib/auth-context'

const STATUS_LABEL: Record<ProductStatus, string> = {
  active: 'Активен',
  on_hold: 'На паузе',
  completed: 'Завершён',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

// Единый фильтр периода страницы продукта. Числовой (дни) — совместим с
// /performance (period_days) и разворачивается в from/to для PR-ов и
// компетенций. Без «Всё» — performance считает по числу дней.
const PERIOD_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 180, label: 'полгода' },
  { days: 365, label: 'год' },
]

function periodQuery(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function ProductCompetenciesList({
  productId,
  items,
  onEmployeeClick,
  from,
  to,
}: {
  productId: number
  items: ProjectExtractedCompetencyItem[]
  onEmployeeClick: (employeeId: number) => void
  from: string
  to: string
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // PR-ы по компетенции — лениво подгружаем при раскрытии.
  const [prsByCompetency, setPrsByCompetency] = useState<
    Record<number, PullRequestPublic[] | 'loading' | 'error'>
  >({})

  const toggle = async (cid: number) => {
    const isOpen = expanded.has(cid)
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(cid) ? next.delete(cid) : next.add(cid)
      return next
    })
    if (isOpen) return
    if (prsByCompetency[cid] !== undefined) return // уже грузили/загружено
    setPrsByCompetency((prev) => ({ ...prev, [cid]: 'loading' }))
    try {
      const list = await api.products.competencyPrs(productId, cid, { from, to })
      setPrsByCompetency((prev) => ({ ...prev, [cid]: list }))
    } catch {
      setPrsByCompetency((prev) => ({ ...prev, [cid]: 'error' }))
    }
  }

  return (
    <div className="space-y-1.5">
      {items.slice(0, 30).map((it) => {
        const isOpen = expanded.has(it.competency_id)
        const hasSignals = it.top_signals && it.top_signals.length > 0
        const hasEmps = it.employees.length > 0
        const hasDetails = hasSignals || hasEmps
        const prsState = prsByCompetency[it.competency_id]
        const matchedPrs = Array.isArray(prsState) ? prsState : []
        const prsLoading = prsState === 'loading'
        const prsError = prsState === 'error'
        return (
          <div
            key={it.competency_id}
            className="rounded-lg bg-bg-elevated ring-1 ring-white/5"
          >
            <button
              onClick={hasDetails ? () => toggle(it.competency_id) : undefined}
              disabled={!hasDetails}
              className={
                'flex w-full items-baseline gap-3 px-3 py-2 text-left transition ' +
                (hasDetails ? 'hover:bg-bg-panel/30' : 'cursor-default')
              }
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {it.competency_name}
              </span>
              <span className="text-[11px] text-slate-500">
                у {it.employees_with} сотр.
              </span>
              <span className="font-mono text-xs text-slate-300">
                {it.total_frequency}
              </span>
              {hasDetails && (
                <span className="text-[11px] text-slate-500">
                  {isOpen ? '▴' : '▾'}
                </span>
              )}
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-white/5 px-3 py-3">
                {hasSignals && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                      Топ-сигналы команды
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {it.top_signals.slice(0, 10).map((s) => (
                        <span
                          key={s.signal}
                          title={`${s.signal_type} · вклад ${s.contribution.toFixed(1)}`}
                          className="rounded bg-bg-panel/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 ring-1 ring-white/5"
                        >
                          {s.signal}
                          <span className="ml-1 text-slate-500">
                            ×{s.occurrences}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {prsLoading ? (
                  <div className="text-[11px] text-slate-500">
                    Загружаем PR-ы по компетенции…
                  </div>
                ) : prsError ? (
                  <div className="text-[11px] text-rose-400">
                    Не удалось загрузить PR-ы.
                  </div>
                ) : matchedPrs.length > 0 ? (
                  <div>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        PR-ы по этой компетенции ({matchedPrs.length})
                      </span>
                      <span className="text-[10px] text-slate-600">
                        сопоставление через feature_keys ∩ top_signals
                      </span>
                    </div>
                    <div className="overflow-hidden rounded bg-bg-panel/20">
                      <table className="w-full text-left text-[12px]">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="px-2 py-1.5">Автор</th>
                            <th className="px-2 py-1.5">PR</th>
                            <th className="px-2 py-1.5">Репо</th>
                            <th className="px-2 py-1.5 text-center">Quality</th>
                            <th className="px-2 py-1.5 text-right">Создан</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchedPrs.slice(0, 30).map((p) => (
                            <tr
                              key={p.id}
                              className="border-t border-white/5"
                            >
                              <td className="px-2 py-1.5">
                                {p.author_employee_id ? (
                                  <button
                                    onClick={() =>
                                      onEmployeeClick(p.author_employee_id!)
                                    }
                                    className="text-slate-200 hover:text-accent"
                                  >
                                    {p.author_full_name || '—'}
                                  </button>
                                ) : (
                                  <span className="text-slate-400">
                                    {p.author_full_name || '—'}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                {p.url ? (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="line-clamp-1 max-w-xs hover:text-accent"
                                    title={p.title}
                                  >
                                    {p.title}
                                  </a>
                                ) : (
                                  <span
                                    className="line-clamp-1 max-w-xs"
                                    title={p.title}
                                  >
                                    {p.title}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-slate-400">
                                {p.project_name || '—'}
                              </td>
                              <td className="px-2 py-1.5 text-center">
                                <span
                                  className={
                                    p.quality_ratio >= 0.7
                                      ? 'text-emerald-400'
                                      : p.quality_ratio >= 0.5
                                        ? 'text-amber-400'
                                        : 'text-rose-400'
                                  }
                                >
                                  {Math.round(p.quality_ratio * 100)}%
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right text-slate-500">
                                {fmtDateShort(p.created_at_ext)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : hasEmps ? (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      Кто проявил ({it.employees.length})
                    </div>
                    {it.employees.slice(0, 20).map((emp) => (
                      <div
                        key={emp.employee_id}
                        className="flex items-baseline gap-3 rounded bg-bg-panel/40 px-2 py-1 text-[12px]"
                      >
                        <button
                          onClick={() => onEmployeeClick(emp.employee_id)}
                          className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-accent"
                        >
                          {emp.full_name}
                        </button>
                        <span className="font-mono text-[11px] text-slate-400">
                          {emp.frequency} PR
                        </span>
                      </div>
                    ))}
                    <div className="text-[10px] text-slate-600">
                      PR-таблица недоступна: feature_keys на PR-ах не пересеклись
                      с топ-сигналами компетенции (или PR-ы за пределами окна 90 дней).
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    Нет данных для drill-down.
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-accent">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Ручное добавление участника в продукт (поиск по ФИО/email). */
function AddProductMember({
  productId,
  existingIds,
  onAdded,
}: {
  productId: number
  existingIds: Set<number>
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<EmployeeSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roleInProject, setRoleInProject] = useState('')
  const [joinedAt, setJoinedAt] = useState(todayIso())

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    setSearching(true)
    setError(null)
    try {
      setResults(await api.employeesSearch(q, 30))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const add = async (emp: EmployeeSearchItem) => {
    setError(null)
    try {
      await api.products.addMember(productId, {
        employee_id: emp.id,
        role_in_project: roleInProject.trim() || null,
        joined_at: joinedAt || null,
      })
      onAdded()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
      >
        + Добавить участника
      </button>
    )

  return (
    <div className="space-y-2 rounded-2xl bg-bg-elevated p-3 ring-1 ring-white/5">
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input
          autoFocus
          placeholder="Поиск по ФИО или email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[220px] flex-1 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <input
          placeholder="Роль в продукте"
          value={roleInProject}
          onChange={(e) => setRoleInProject(e.target.value)}
          className="w-44 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <input
          type="date"
          title="С какой даты в продукте"
          value={joinedAt}
          onChange={(e) => setJoinedAt(e.target.value)}
          className="w-40 rounded bg-bg-panel px-3 py-1.5 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded bg-accent/15 px-3 py-1.5 text-sm text-accent hover:bg-accent/25"
        >
          {searching ? '…' : 'Найти'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          Закрыть
        </button>
      </form>
      {error && <div className="text-xs text-red-400">{error}</div>}
      {results.length > 0 && (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((emp) => {
            const already = existingIds.has(emp.id)
            return (
              <div
                key={emp.id}
                className="flex items-center gap-3 rounded bg-bg-panel px-3 py-2 text-sm"
              >
                <div className="flex-1">
                  <div className="font-medium">
                    {emp.full_name}
                    {!emp.is_yours && (
                      <span className="ml-2 text-xs text-slate-500">
                        ({emp.owner_name})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {emp.role_name || '—'}
                    {emp.grade_code && ` · ${emp.grade_code}`}
                  </div>
                </div>
                <button
                  disabled={already}
                  onClick={() => add(emp)}
                  className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-30"
                >
                  {already ? 'уже в продукте' : 'добавить'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ProductDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const productId = Number(id)

  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [coverage, setCoverage] = useState<ProjectCoverage | null>(null)
  const [grades, setGrades] = useState<ProjectGradeDistribution | null>(null)

  const [prs, setPrs] = useState<PullRequestPublic[] | null>(null)
  const [prError, setPrError] = useState<string | null>(null)

  const [comps, setComps] = useState<ProjectExtractedCompetenciesResponse | null>(null)
  const [compsError, setCompsError] = useState<string | null>(null)

  const [rotations, setRotations] = useState<RotationsPanel | null>(null)
  const [tab, setTab] = useState<'overview' | 'tech_maturity'>('overview')
  // Единый фильтр периода: управляет PR-ами, Performance и AI-компетенциями.
  const [periodDays, setPeriodDays] = useState(90)
  const [otherProducts, setOtherProducts] = useState<ProductListItem[]>([])
  const [technologies, setTechnologies] = useState<ProductTechnology[]>([])
  const [openRotations, setOpenRotations] = useState<RotationListItem[]>([])
  const [proposingFor, setProposingFor] = useState<{
    employee_id: number
    full_name: string
  } | null>(null)
  const [proposeTarget, setProposeTarget] = useState<number | null>(null)
  const [proposeReason, setProposeReason] = useState('')
  const [proposeBusy, setProposeBusy] = useState(false)
  const [proposeError, setProposeError] = useState<string | null>(null)
  const [approvers, setApprovers] = useState<
    RotationApproverPreview[] | 'loading' | null
  >(null)
  const [lockingMember, setLockingMember] = useState<{
    member_id: number
    full_name: string
  } | null>(null)
  const [lockNote, setLockNote] = useState('')

  const refresh = useCallback(async () => {
    try {
      const p = await api.products.get(productId)
      setProduct(p)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [productId])

  // Период-независимые данные: команда/репо/стек/покрытие/грейды/ротации —
  // это срез текущего состояния, а не активность за окно.
  useEffect(() => {
    refresh()
    api.products.coverage(productId).then(setCoverage).catch(() => undefined)
    api.products.grades(productId).then(setGrades).catch(() => undefined)
    api.products
      .rotations(productId)
      .then(setRotations)
      .catch(() => undefined)
    api.products
      .list()
      .then((list) =>
        setOtherProducts(list.filter((p) => p.id !== productId)),
      )
      .catch(() => undefined)
    api.products
      .technologies(productId)
      .then(setTechnologies)
      .catch(() => undefined)
    // Открытые ротации (proposed/accepted) с участием этого продукта в качестве источника.
    // Используем стандартный фильтр rotations.list по statusам.
    Promise.all([
      api.rotations.list({ status: 'proposed' }),
      api.rotations.list({ status: 'accepted' }),
    ])
      .then(([a, b]) => {
        const all = [...a, ...b].filter(
          (r) => r.from_product_id === productId,
        )
        all.sort(
          (x, y) =>
            new Date(y.proposed_at).getTime() -
            new Date(x.proposed_at).getTime(),
        )
        setOpenRotations(all)
      })
      .catch(() => undefined)
  }, [productId, refresh])

  // Период-зависимые данные: список PR-ов и AI-компетенции. Перечитываются
  // при смене единого фильтра периода — тот же from/to, что уходит в Performance.
  useEffect(() => {
    const { from, to } = periodQuery(periodDays)
    setPrs(null)
    setPrError(null)
    // limit повышенный — нужен полный набор для drill-down компетенций по
    // пересечению feature_keys ∩ top_signals. В UI рендерим только топ-30.
    api.products
      .pullRequests(productId, { limit: 300, from, to })
      .then((list) => {
        setPrs(list)
        // PR-эндпойнт на сервере материализует участников/проекты из свежих
        // PR-ов (read-hook). Перезагружаем продукт, чтобы обновлённая команда
        // и репо появились сразу, без ручного обновления страницы.
        refresh()
      })
      .catch((e) => setPrError((e as Error).message))
    setComps(null)
    setCompsError(null)
    api.products
      .extractedCompetencies(productId, { from, to })
      .then(setComps)
      .catch((e) => setCompsError((e as Error).message))
  }, [productId, periodDays, refresh])

  const reloadRotations = useCallback(() => {
    api.products
      .rotations(productId)
      .then(setRotations)
      .catch(() => undefined)
    Promise.all([
      api.rotations.list({ status: 'proposed' }),
      api.rotations.list({ status: 'accepted' }),
    ])
      .then(([a, b]) => {
        const all = [...a, ...b].filter(
          (r) => r.from_product_id === productId,
        )
        all.sort(
          (x, y) =>
            new Date(y.proposed_at).getTime() -
            new Date(x.proposed_at).getTime(),
        )
        setOpenRotations(all)
      })
      .catch(() => undefined)
  }, [productId])

  const lockMember = async (note: string) => {
    if (!lockingMember) return
    try {
      await api.products.lockMember(
        productId,
        lockingMember.member_id,
        note.trim() || null,
      )
      setLockingMember(null)
      setLockNote('')
      await refresh()
      reloadRotations()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const unlockMember = async (memberId: number) => {
    try {
      await api.products.unlockMember(productId, memberId)
      await refresh()
      reloadRotations()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const removeMember = async (memberId: number, fullName: string) => {
    if (
      !confirm(
        `Убрать ${fullName} из продукта? Запись будет удалена; история ротаций сохранится.`,
      )
    )
      return
    try {
      await api.products.removeMember(productId, memberId)
      await refresh()
      reloadRotations()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const submitPropose = async () => {
    if (!proposingFor || !proposeTarget) return
    setProposeBusy(true)
    setProposeError(null)
    try {
      await api.rotations.propose({
        employee_id: proposingFor.employee_id,
        from_product_id: productId,
        to_product_id: proposeTarget,
        reason_md: proposeReason.trim() || null,
      })
      setProposingFor(null)
      setProposeTarget(null)
      setProposeReason('')
      setApprovers(null)
      reloadRotations()
    } catch (e) {
      setProposeError((e as Error).message)
    } finally {
      setProposeBusy(false)
    }
  }

  if (error)
    return <div className="text-sm text-red-400">Ошибка: {error}</div>
  if (!product) return <div className="text-slate-500">Загрузка…</div>

  const remove = async () => {
    if (
      !confirm(
        'Удалить продукт? Все участники, стек, репо и связанные ротации тоже удалятся.',
      )
    )
      return
    try {
      await api.products.delete(productId)
      navigate('/products')
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="space-y-8">
      {/* header */}
      <div>
        <button
          onClick={() => navigate('/products')}
          className="mb-4 text-sm text-slate-400 hover:text-slate-200"
        >
          ← Продукты
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            {product.gitlab_group && (
              <div className="mt-1 text-xs text-slate-500">
                📁 GitLab-группа:{' '}
                <span className="font-mono text-slate-300">
                  {product.gitlab_group}
                </span>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="rounded bg-bg-panel px-2 py-0.5 text-xs">
                {STATUS_LABEL[product.status]}
              </span>
              <span>·</span>
              <span>{product.members.length} участников</span>
              <span>·</span>
              <span>{product.competencies.length} в стеке</span>
              <span>·</span>
              <span>{product.repos.length} репо</span>
            </div>
          </div>
          {!readOnly && (
            <button
              onClick={remove}
              className="text-xs text-slate-500 hover:text-red-400"
            >
              удалить
            </button>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-white/5">
        <button
          onClick={() => setTab('overview')}
          className={
            '-mb-px px-4 py-2 text-sm transition ' +
            (tab === 'overview'
              ? 'border-b-2 border-accent text-accent'
              : 'text-slate-400 hover:text-slate-200')
          }
        >
          Обзор
        </button>
        <button
          onClick={() => setTab('tech_maturity')}
          className={
            '-mb-px px-4 py-2 text-sm transition ' +
            (tab === 'tech_maturity'
              ? 'border-b-2 border-accent text-accent'
              : 'text-slate-400 hover:text-slate-200')
          }
        >
          Тех.зрелость
        </button>
      </div>

      {tab === 'tech_maturity' && (
        <section>
          <TechMaturityPanel productId={productId} />
        </section>
      )}

      {tab === 'overview' && (<>

      {/* единый фильтр периода — управляет PR-ами, Performance и AI-компетенциями */}
      <section className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Период:</span>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((o) => (
            <button
              key={o.days}
              onClick={() => setPeriodDays(o.days)}
              className={
                'rounded-lg px-2.5 py-1 text-xs transition ' +
                (periodDays === o.days
                  ? 'bg-accent text-bg font-medium'
                  : 'bg-bg-panel text-slate-400 hover:text-slate-200')
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-600">
          применяется к PR-ам, Performance и AI-компетенциям
        </span>
      </section>

      {/* tiles row */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <Tile label="Участников" value={product.members.length} />
        <Tile label="Репо" value={product.repos.length} />
        <Tile
          label="Стек компетенций"
          value={product.competencies.length}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Технологии
        </h2>
        {technologies.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-5 text-sm text-slate-500">
            Технологии продукта пока не указаны. Связи управляются в карточке технологии.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {technologies.map((technology) => {
              const debt = technology.status === 'hold' && product.status === 'active'
              return (
                <button
                  key={technology.technology_id}
                  onClick={() => navigate(`/technology-radar/${technology.technology_id}`)}
                  className={`rounded-xl p-4 text-left ring-1 transition hover:bg-bg-panel ${debt ? 'bg-rose-500/10 ring-rose-500/30' : 'bg-bg-elevated ring-white/5'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{technology.technology_name}</span>
                    <span className="rounded bg-bg-panel px-2 py-0.5 text-xs uppercase text-slate-300">
                      {technology.status} · {technology.usage_type}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{technology.category.name}</div>
                  {technology.notes && <div className="mt-2 text-xs text-slate-400">{technology.notes}</div>}
                  {debt && <div className="mt-2 text-xs text-rose-300">Технология находится в Hold и всё ещё используется активным продуктом.</div>}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* performance (объединено с обзором) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Performance
        </h2>
        <PerformancePanel productId={productId} periodDays={periodDays} />
      </section>

      {/* risk alerts — bus-factor */}
      {rotations && rotations.candidates.some((c) => c.bus_factor_score > 0) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-rose-300">
            ⚠ Bus-factor: уникальные носители ★-компетенций
          </h2>
          <div className="space-y-1.5">
            {rotations.candidates
              .filter((c) => c.bus_factor_score > 0)
              .sort((a, b) => b.bus_factor_score - a.bus_factor_score)
              .map((c) => (
                <div
                  key={c.member_id}
                  onClick={() => navigate(`/employees/${c.employee_id}`)}
                  className="flex cursor-pointer items-baseline gap-3 rounded-lg bg-rose-500/5 px-3 py-2 ring-1 ring-rose-500/30 hover:bg-rose-500/10"
                >
                  <span
                    className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-mono text-rose-200"
                    title="уникальный носитель ★-компетенции"
                  >
                    bus×{c.bus_factor_score}
                  </span>
                  <span className="text-sm font-medium text-slate-200">
                    {c.full_name}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {c.role_name || '—'} {c.grade_code || ''}
                  </span>
                  <span className="ml-auto truncate text-[11px] text-slate-400">
                    {c.bus_factor_competencies
                      .map((bf) => bf.competency_name)
                      .join(', ')}
                  </span>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* repos */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Репозитории
        </h2>
        {product.repos.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Нет репо. Будут появляться по мере того, как сотрудники продукта
            делают PR-ы в CodeBuddy.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-4 py-2">Имя</th>
                  <th className="px-4 py-2 text-right">GitLab project_id</th>
                </tr>
              </thead>
              <tbody>
                {product.repos.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/projects/${r.id}`)}
                    className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                  >
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-500">
                      {r.gitlab_project_id ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* members */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Команда
        </h2>
        {!readOnly && (
          <div className="mb-3">
            <AddProductMember
              productId={productId}
              existingIds={new Set(product.members.map((m) => m.employee_id))}
              onAdded={refresh}
            />
          </div>
        )}
        {product.members.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Команды нет. Сотрудники добавятся автоматически при синке из
            CodeBuddy, либо добавьте вручную кнопкой выше.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-4 py-2">Сотрудник</th>
                  <th className="px-4 py-2">Роль</th>
                  <th className="px-4 py-2">Грейд</th>
                  <th className="px-4 py-2">В команде с</th>
                  <th className="px-4 py-2">Owner</th>
                  <th className="px-4 py-2">Ротация</th>
                </tr>
              </thead>
              <tbody>
                {product.members.map((m) => {
                  // Открытая ротация по этому employee (proposed/accepted)
                  const openRot = openRotations.find(
                    (r) => r.employee_id === m.employee_id,
                  )
                  return (
                    <tr
                      key={m.id}
                      className="border-t border-white/5 hover:bg-bg-panel/40"
                    >
                      <td className="px-4 py-2">
                        <button
                          onClick={() =>
                            navigate(`/employees/${m.employee_id}`)
                          }
                          className="text-left font-medium hover:text-accent"
                        >
                          {m.full_name}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {m.role_name || '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {m.grade_code || '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {fmtDate(m.joined_at)}
                      </td>
                      <td className="px-4 py-2 text-slate-400">
                        {m.owner_name || '—'}
                        {m.is_yours && (
                          <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                            ваш
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {!readOnly && (
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            {openRot ? (
                              <span
                                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300"
                                title={`Открыта ротация → ${openRot.to_product_name || openRot.to_project_name || '?'}`}
                              >
                                в работе
                              </span>
                            ) : m.rotation_locked ? (
                              <>
                                <span
                                  className="rounded bg-slate-500/20 px-1.5 py-0.5 text-slate-400"
                                  title={
                                    m.rotation_lock_note ||
                                    'Заморожен от ротации'
                                  }
                                >
                                  🔒 заморожен
                                </span>
                                <button
                                  onClick={() => unlockMember(m.id)}
                                  className="text-slate-500 hover:text-slate-200"
                                >
                                  разморозить
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setProposingFor({
                                      employee_id: m.employee_id,
                                      full_name: m.full_name,
                                    })
                                    setProposeTarget(null)
                                    setProposeReason('')
                                    setProposeError(null)
                                  }}
                                  className="text-accent hover:underline"
                                >
                                  ротация
                                </button>
                                <button
                                  onClick={() => {
                                    setLockingMember({
                                      member_id: m.id,
                                      full_name: m.full_name,
                                    })
                                    setLockNote(m.rotation_lock_note || '')
                                  }}
                                  className="text-slate-500 hover:text-slate-200"
                                >
                                  заморозить
                                </button>
                              </>
                            )}
                            <button
                              onClick={() =>
                                removeMember(m.id, m.full_name)
                              }
                              className="text-slate-500 hover:text-rose-400"
                            >
                              убрать
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* tech stack */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Тех.стек продукта
        </h2>
        <StackEditor
          productId={productId}
          initial={product.competencies}
          onChanged={refresh}
        />
      </section>

      {/* pull-requests */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Последние PR-ы в продукте
        </h2>
        {prError ? (
          <CodeBuddyErrorBanner error={prError} />
        ) : !prs || prs.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Нет PR-ов за период.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">Автор</th>
                  <th className="px-3 py-2">Репо</th>
                  <th className="px-3 py-2 text-center">Размер</th>
                  <th className="px-3 py-2 text-center">Quality</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Создан</th>
                </tr>
              </thead>
              <tbody>
                {prs.slice(0, 30).map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-1 max-w-xs hover:text-accent"
                          title={p.title}
                        >
                          {p.title}
                        </a>
                      ) : (
                        <span className="line-clamp-1 max-w-xs" title={p.title}>
                          {p.title}
                        </span>
                      )}
                      <div className="text-[10px] text-slate-500">
                        !{p.external_id}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {p.author_employee_id ? (
                        <button
                          onClick={() =>
                            navigate(`/employees/${p.author_employee_id}`)
                          }
                          className="text-left text-slate-200 hover:text-accent"
                        >
                          {p.author_full_name || '—'}
                        </button>
                      ) : (
                        <span className="text-slate-400">
                          {p.author_full_name || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {p.project_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {p.size_bucket}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={
                          p.quality_ratio >= 0.7
                            ? 'text-emerald-400'
                            : p.quality_ratio >= 0.5
                              ? 'text-amber-400'
                              : 'text-rose-400'
                        }
                      >
                        {Math.round(p.quality_ratio * 100)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{p.state}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {fmtDate(p.created_at_ext)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* extracted competencies */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          AI-извлечённые компетенции команды
        </h2>
        {compsError ? (
          <CodeBuddyErrorBanner error={compsError} />
        ) : !comps || comps.items.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Пока нечего показать.
          </div>
        ) : (
          <ProductCompetenciesList
            productId={productId}
            items={comps.items}
            onEmployeeClick={(eid) => navigate(`/employees/${eid}`)}
            from={periodQuery(periodDays).from}
            to={periodQuery(periodDays).to}
          />
        )}
      </section>

      {/* открытые ротации продукта */}
      {openRotations.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Открытые ротации из этого продукта
          </h2>
          <div className="space-y-1.5">
            {openRotations.map((r) => (
              <div
                key={r.id}
                className="flex items-baseline gap-3 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-white/5"
              >
                <span
                  className={
                    'rounded px-1.5 py-0.5 text-[10px] font-mono ' +
                    (r.status === 'proposed'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-emerald-500/15 text-emerald-300')
                  }
                >
                  {r.status}
                </span>
                <span className="font-medium text-slate-200">
                  {r.employee_name}
                </span>
                <span className="text-[11px] text-slate-500">
                  → {r.to_product_name || r.to_project_name || '—'}
                </span>
                <span className="ml-auto text-[10px] text-slate-600">
                  {fmtDate(r.proposed_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* rotations */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Кандидаты на ротацию
        </h2>
        {!rotations ? (
          <div className="text-slate-500">Загрузка…</div>
        ) : rotations.no_candidates ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Никто не готов к ротации (нет участников с tenure ≥ 18 мес).
          </div>
        ) : (
          <div className="space-y-1.5">
            {rotations.candidates.slice(0, 10).map((c) => (
              <div
                key={c.member_id}
                className="flex items-baseline gap-3 rounded-lg bg-bg-elevated px-3 py-2 ring-1 ring-white/5"
              >
                <button
                  onClick={() => navigate(`/employees/${c.employee_id}`)}
                  className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-accent"
                >
                  {c.full_name}
                </button>
                <span className="text-[11px] text-slate-500">
                  {c.role_name || '—'} {c.grade_code || ''}
                </span>
                <span className="text-[11px] text-slate-500">
                  стаж {c.tenure_months} мес
                </span>
                {c.bus_factor_score > 0 && (
                  <span
                    className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300"
                    title="bus-factor: уникальный носитель ★-компетенции"
                  >
                    bus×{c.bus_factor_score}
                  </span>
                )}
                <span className="font-mono text-xs text-accent">
                  score {c.score}
                </span>
                {c.pending_rotation_id ? (
                  <span className="text-[11px] text-amber-400">
                    в работе
                  </span>
                ) : c.rotation_locked ? (
                  <span className="text-[11px] text-slate-500">
                    заморожен
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setProposingFor({
                        employee_id: c.employee_id,
                        full_name: c.full_name,
                      })
                      setProposeTarget(null)
                      setProposeReason('')
                      setProposeError(null)
                    }}
                    className="rounded bg-accent/15 px-2 py-1 text-[11px] text-accent hover:bg-accent/25"
                  >
                    предложить ротацию
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* freeze modal */}
      {lockingMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setLockingMember(null)}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">
              Заморозить от ротации: {lockingMember.full_name}
            </h3>
            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Причина (опционально, увидят коллеги)
              </label>
              <textarea
                value={lockNote}
                onChange={(e) => setLockNote(e.target.value)}
                rows={3}
                placeholder="Например: ведёт критичную фазу до Q2"
                className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setLockingMember(null)}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
              <button
                onClick={() => lockMember(lockNote)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
              >
                Заморозить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* propose modal */}
      {proposingFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setProposingFor(null)}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">
              Предложить ротацию: {proposingFor.full_name}
            </h3>
            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Целевой продукт
              </label>
              <select
                value={proposeTarget ?? ''}
                onChange={(e) => {
                  const tid = e.target.value ? Number(e.target.value) : null
                  setProposeTarget(tid)
                  if (tid && proposingFor) {
                    setApprovers('loading')
                    api.rotations
                      .approversPreview(
                        proposingFor.employee_id,
                        productId,
                        tid,
                      )
                      .then(setApprovers)
                      .catch(() => setApprovers(null))
                  } else {
                    setApprovers(null)
                  }
                }}
                className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
              >
                <option value="">— выберите —</option>
                {otherProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.gitlab_group ? ` (${p.gitlab_group})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* предпросмотр согласующих */}
            {approvers === 'loading' ? (
              <div className="text-xs text-slate-500">
                Считаем согласующих…
              </div>
            ) : approvers && approvers.length > 0 ? (
              <div className="rounded-lg bg-bg-panel/40 px-3 py-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                  Согласующие ({approvers.length})
                </div>
                <ul className="space-y-1">
                  {approvers.map((a) => (
                    <li
                      key={a.user_id}
                      className="flex items-baseline gap-2 text-[12px]"
                    >
                      <span className="text-slate-200">
                        {a.full_name || `#${a.user_id}`}
                      </span>
                      {a.is_initiator && (
                        <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] text-emerald-300">
                          вы · авто-согласие
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        {a.reasons.join(', ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs text-slate-500">
                Обоснование (опционально)
              </label>
              <textarea
                value={proposeReason}
                onChange={(e) => setProposeReason(e.target.value)}
                rows={3}
                placeholder="Почему ротация нужна / куда переходит / что закрывает"
                className="w-full rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </div>
            {proposeError && (
              <div className="text-sm text-rose-400">{proposeError}</div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setProposingFor(null)
                  setApprovers(null)
                }}
                className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
              <button
                onClick={submitPropose}
                disabled={!proposeTarget || proposeBusy}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
              >
                {proposeBusy ? 'Отправка…' : 'Предложить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* coverage + grades */}
      {coverage && coverage.items.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Покрытие тех.стека
          </h2>
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-4 py-2">Компетенция</th>
                  <th className="px-4 py-2 text-center">Target</th>
                  <th className="px-4 py-2 text-center">Носителей</th>
                  <th className="px-4 py-2 text-center">Средний</th>
                </tr>
              </thead>
              <tbody>
                {coverage.items.map((it) => (
                  <tr key={it.competency_id} className="border-t border-white/5">
                    <td className="px-4 py-2">{it.competency_name}</td>
                    <td className="px-4 py-2 text-center font-mono">
                      L{it.target_level}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {it.members_meeting} / {it.members_total}
                    </td>
                    <td
                      className={
                        'px-4 py-2 text-center font-mono ' +
                        (it.avg_level === null
                          ? 'text-slate-500'
                          : it.avg_level >= it.target_level
                            ? 'text-emerald-400'
                            : 'text-rose-400')
                      }
                    >
                      {it.avg_level === null ? '—' : it.avg_level}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {grades && grades.items.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Распределение по грейдам
          </h2>
          <div className="flex flex-wrap gap-2">
            {grades.items.map((g) => (
              <span
                key={g.grade_code}
                className="rounded-lg bg-bg-elevated px-3 py-1.5 text-sm ring-1 ring-white/5"
              >
                <span className="font-mono text-slate-300">{g.grade_code}</span>
                <span className="ml-2 text-slate-500">×{g.count}</span>
              </span>
            ))}
            {grades.no_grade > 0 && (
              <span className="rounded-lg bg-bg-elevated px-3 py-1.5 text-sm text-amber-400 ring-1 ring-amber-500/30">
                без грейда ×{grades.no_grade}
              </span>
            )}
          </div>
        </section>
      )}

      </>)}
    </div>
  )
}
