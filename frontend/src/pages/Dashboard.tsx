import { ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, CurrentUser, DashboardMetrics, TeamMetrics } from '../api/client'
import { DevActivityWidget } from '../components/DevActivityWidget'
import { UpcomingMeetingsWidget } from '../components/UpcomingMeetingsWidget'
import { useCurrentUser } from '../lib/auth-context'

function Tile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string | number
  hint?: ReactNode
  tone?: 'default' | 'primary' | 'good' | 'warn' | 'bad'
}) {
  const valueColor = {
    default: 'metric-default',
    primary: 'metric-primary',
    good: 'metric-good',
    warn: 'metric-warn',
    bad: 'metric-bad',
  }[tone]
  return (
    <div className="rounded-2xl bg-bg-elevated p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${valueColor}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

type DashTab =
  | 'team'
  | 'mpk'
  | 'rotations'
  | 'self_review'
  | 'hiring'
  | 'activity'

const TAB_LABELS: Record<DashTab, string> = {
  team: 'Команда',
  mpk: 'МПК',
  rotations: 'Ротации',
  self_review: 'Self-Review',
  hiring: 'Найм',
  activity: 'Активность',
}

const STAGE_LABEL_DASH: Record<string, string> = {
  new: 'новый',
  screening: 'скрининг',
  interview: 'интервью',
  offer: 'оффер',
  hired: 'нанят',
  rejected: 'отклонён',
}

const STAGE_TONE_DASH: Record<string, string> = {
  new: 'text-slate-300 bg-slate-500/15',
  screening: 'text-amber-300 bg-amber-500/15',
  interview: 'text-accent bg-accent/15',
  offer: 'text-accent bg-accent/15',
  hired: 'text-emerald-300 bg-emerald-500/15',
  rejected: 'text-rose-300 bg-rose-500/15',
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm transition ${
        active
          ? 'border-b-2 border-accent text-accent'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-panel">
      <div
        className="metric-primary-bg h-full rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function formatDateShort(iso: string | null): string {
  if (!iso) return 'никогда'
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function relativeAge(iso: string | null): string {
  if (!iso) return '—'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days < 0) return formatDateShort(iso)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 30) return `${days} дн назад`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} мес назад`
  const years = Math.floor(days / 365)
  return `${years} ${years === 1 ? 'год' : years < 5 ? 'года' : 'лет'} назад`
}

export function Dashboard() {
  const navigate = useNavigate()
  const currentUser = useCurrentUser()
  const isCoreTeam = currentUser?.role === 'core_team'
  const isPm = currentUser?.role === 'manager'
  const [me, setMe] = useState<CurrentUser | null>(null)
  const [m, setM] = useState<DashboardMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DashTab>('team')
  const [team, setTeam] = useState<TeamMetrics | null>(null)
  const [managers, setManagers] = useState<CurrentUser[]>([])
  const [pickedManagerId, setPickedManagerId] = useState<number | null>(null)

  // эффективный owner для запросов
  const effectiveManagerId = isCoreTeam ? pickedManagerId : null

  useEffect(() => {
    api.me().then(setMe).catch(() => undefined)
  }, [])

  // подгружаем список руководителей для core_team
  useEffect(() => {
    if (!isCoreTeam) return
    api.users
      .list()
      .then((list) =>
        setManagers(list.filter((u) => u.role === 'department_head')),
      )
      .catch(() => undefined)
  }, [isCoreTeam])

  useEffect(() => {
    setError(null)
    setM(null)
    setTeam(null)
    api.dashboard
      .metrics(effectiveManagerId)
      .then(setM)
      .catch((e) => setError((e as Error).message))
    api.dashboard
      .team(effectiveManagerId)
      .then(setTeam)
      .catch(() => undefined)
  }, [effectiveManagerId])

  // PM-роль: дашборд по сотрудникам и self-review не релевантен — отправляем
  // на список проектов, где они работают.
  if (isPm) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            Здравствуйте{currentUser ? `, ${currentUser.full_name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Менеджер продукта. Доступ ограничен своими проектами — переходите в
            раздел «Проекты».
          </p>
        </div>
        <button
          onClick={() => navigate('/projects')}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
        >
          → Мои проекты
        </button>
      </div>
    )
  }

  // CoreTeam без выбранного руководителя — показываем только пикер
  if (isCoreTeam && pickedManagerId === null) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard (CoreTeam)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Выберите руководителя, чтобы увидеть его дашборд.
          </p>
        </div>
        <div className="rounded-2xl bg-bg-elevated p-6">
          <div className="mb-3 text-sm text-slate-400">Руководители</div>
          <div className="flex flex-wrap gap-2">
            {managers.map((u) => (
              <button
                key={u.id}
                onClick={() => setPickedManagerId(u.id)}
                className="rounded-lg bg-bg-panel px-4 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:bg-bg-panel/70 hover:text-accent"
              >
                {u.full_name}
              </button>
            ))}
            {managers.length === 0 && (
              <span className="text-xs text-slate-500">
                Загрузка списка руководителей…
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (error)
    return <div className="text-sm text-red-400">Ошибка загрузки: {error}</div>
  if (!m) return <div className="text-slate-500">Загрузка…</div>

  const ratio = m.employees_total > 0 ? m.assessed_last_12m / m.employees_total : 0
  const cycleTone =
    ratio >= 0.9 ? 'good' : ratio >= 0.5 ? 'primary' : 'warn'

  const TAB_BADGES: Record<DashTab, number | null> = {
    team: team ? team.without_role + team.without_grade : null,
    mpk: m.not_assessed_last_12m,
    rotations: m.rotation_candidates_count,
    self_review: m.self_review_pending,
    hiring: m.candidates_in_pipeline,
    activity: null,
  }

  const pickedManager =
    isCoreTeam && pickedManagerId
      ? managers.find((u) => u.id === pickedManagerId)
      : null

  return (
    <div className="space-y-6">
      {isCoreTeam && pickedManager && (
        <div className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-2 text-sm ring-1 ring-white/5">
          <div className="text-slate-400">
            Просматриваем дашборд:{' '}
            <span className="font-medium text-slate-200">
              {pickedManager.full_name}
            </span>
          </div>
          <button
            onClick={() => setPickedManagerId(null)}
            className="text-xs text-slate-500 hover:text-accent"
          >
            сменить руководителя
          </button>
        </div>
      )}
      <div>
        <h1 className="text-2xl font-semibold">
          Здравствуйте{me ? `, ${me.full_name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Сводка по разделам. Переключайтесь вкладками — каждая показывает свой
          срез без шума остальных.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/5">
        {(Object.keys(TAB_LABELS) as DashTab[]).map((k) => {
          const badge = TAB_BADGES[k]
          return (
            <TabButton key={k} active={tab === k} onClick={() => setTab(k)}>
              {TAB_LABELS[k]}
              {badge !== null && badge > 0 && (
                <span
                  className={
                    'ml-2 rounded px-1.5 py-0.5 text-xs ' +
                    (tab === k
                      ? 'bg-accent/20 text-accent'
                      : 'bg-bg-panel text-slate-400')
                  }
                >
                  {badge}
                </span>
              )}
            </TabButton>
          )
        })}
      </div>

      {tab === 'team' && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Ближайшие встречи (30 дней)
            </h2>
            <UpcomingMeetingsWidget />
          </section>

          {!team ? (
            <div className="text-slate-500">Загрузка…</div>
          ) : (
            <>
              <section>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Tile
                    label="Активных сотрудников"
                    value={team.total_active}
                    tone="primary"
                    hint={
                      team.total_all_time !== team.total_active
                        ? `всего за всё время: ${team.total_all_time}`
                        : undefined
                    }
                  />
                  <Tile
                    label={`Нанято в ${team.hired_year}`}
                    value={team.hired_count_year}
                    tone={team.hired_count_year > 0 ? 'good' : 'default'}
                  />
                  <Tile
                    label={`Ушло в ${team.hired_year}`}
                    value={team.left_count_year}
                    tone={team.left_count_year > 0 ? 'warn' : 'default'}
                  />
                  <Tile
                    label="Чистый прирост"
                    value={
                      team.net_change_year >= 0
                        ? `+${team.net_change_year}`
                        : team.net_change_year
                    }
                    tone={
                      team.net_change_year > 0
                        ? 'good'
                        : team.net_change_year < 0
                          ? 'bad'
                          : 'default'
                    }
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Tile
                    label="Средний стаж"
                    value={
                      team.avg_tenure_months === null
                        ? '—'
                        : team.avg_tenure_months >= 12
                          ? `${(team.avg_tenure_months / 12).toFixed(1)} лет`
                          : `${team.avg_tenure_months} мес`
                    }
                    hint={
                      team.without_hire_date > 0
                        ? `${team.without_hire_date} без даты найма`
                        : undefined
                    }
                    tone="primary"
                  />
                  <Tile
                    label="Стажёров"
                    value={team.interns}
                    tone={team.interns > 0 ? 'default' : 'default'}
                  />
                  <Tile
                    label="Без роли"
                    value={team.without_role}
                    tone={team.without_role > 0 ? 'warn' : 'good'}
                  />
                  <Tile
                    label="Без грейда"
                    value={team.without_grade}
                    tone={team.without_grade > 0 ? 'warn' : 'good'}
                  />
                </div>
              </section>

              {team.grades.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Распределение по грейдам
                  </h2>
                  <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                    <div className="space-y-2 px-6 py-4">
                      {team.grades.map((g) => {
                        const pct = team.total_active
                          ? (g.count / team.total_active) * 100
                          : 0
                        return (
                          <div key={g.grade_code} className="flex items-center gap-3">
                            <span className="w-20 text-sm text-slate-300">
                              {g.grade_code}
                            </span>
                            <div className="h-3 flex-1 overflow-hidden rounded-full bg-bg-panel">
                              <div
                                className="grade-distribution-bar h-full rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 text-right text-xs text-slate-400">
                              {g.count} · {Math.round(pct)}%
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              )}

              {team.roles.length > 0 && (
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Распределение по ролям
                  </h2>
                  <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                    <table className="w-full text-left text-sm">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="px-6 py-2">Роль</th>
                          <th className="w-32 px-6 py-2 text-right">Сотрудников</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.roles.map((r) => (
                          <tr key={r.role_id} className="border-t border-white/5">
                            <td className="px-6 py-2">{r.role_name}</td>
                            <td className="px-6 py-2 text-right text-accent">
                              {r.count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Наняты в {team.hired_year} ({team.hired_count_year})
                  </h2>
                  {team.recent_hires.length === 0 ? (
                    <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
                      Никого не нанимали в этом году.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                      <table className="w-full text-left text-sm">
                        <tbody>
                          {team.recent_hires.map((e) => (
                            <tr
                              key={e.employee_id}
                              onClick={() => navigate(`/employees/${e.employee_id}`)}
                              className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                            >
                              <td className="px-4 py-2">{e.full_name}</td>
                              <td className="px-4 py-2 text-xs text-slate-500">
                                {e.role_name || '—'}
                                {e.grade_code && ` · ${e.grade_code}`}
                              </td>
                              <td className="px-4 py-2 text-right text-xs text-emerald-400">
                                {formatDateShort(e.at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Ушли в {team.hired_year} ({team.left_count_year})
                  </h2>
                  {team.recent_leaves.length === 0 ? (
                    <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
                      Никто не уходил в этом году.
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                      <table className="w-full text-left text-sm">
                        <tbody>
                          {team.recent_leaves.map((e) => (
                            <tr
                              key={e.employee_id}
                              onClick={() => navigate(`/employees/${e.employee_id}`)}
                              className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                            >
                              <td className="px-4 py-2">{e.full_name}</td>
                              <td className="px-4 py-2 text-xs text-slate-500">
                                {e.role_name || '—'}
                                {e.grade_code && ` · ${e.grade_code}`}
                              </td>
                              <td className="px-4 py-2 text-right text-xs text-rose-400">
                                {formatDateShort(e.at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'mpk' && (
        <div className="space-y-8">
      {/* Годовой цикл */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Годовой цикл оценки
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Tile
            label="Оценено за 12 мес"
            value={`${m.assessed_last_12m} / ${m.employees_total}`}
            hint={
              <ProgressBar value={m.assessed_last_12m} max={m.employees_total} />
            }
            tone={cycleTone}
          />
          <Tile
            label="Осталось оценить"
            value={m.not_assessed_last_12m}
            tone={m.not_assessed_last_12m === 0 ? 'good' : 'warn'}
            hint="сотрудников без свежей оценки"
          />
          <Tile
            label="Запланированных процедур"
            value={m.procedures_planned}
            hint="первая встреча ещё впереди"
          />
          <Tile
            label="Открытых процедур"
            value={m.procedures_open}
            hint="идут прямо сейчас"
          />
          <Tile
            label="Завершено процедур / год"
            value={m.procedures_closed_last_12m}
          />
        </div>
      </section>

      {/* Не оценены за год */}
      {m.not_assessed_employees.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Не оценены за последние 12 месяцев ({m.not_assessed_last_12m})
          </h2>
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-4 py-3">ФИО</th>
                  <th className="px-4 py-3">Роль / грейд</th>
                  <th className="px-4 py-3">Последняя оценка</th>
                  <th className="px-4 py-3 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {m.not_assessed_employees.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => navigate(`/employees/${e.id}`)}
                    className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                  >
                    <td className="px-4 py-3">{e.full_name}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {e.role_name ? (
                        <>
                          {e.role_name}
                          {e.grade_code && ` · ${e.grade_code}`}
                        </>
                      ) : (
                        <span className="text-slate-600">не задана</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      <span
                        className={
                          e.last_assessed_at ? '' : 'text-rose-400'
                        }
                      >
                        {relativeAge(e.last_assessed_at)}
                      </span>
                      {e.last_assessed_at && (
                        <span className="ml-2 text-xs text-slate-600">
                          ({formatDateShort(e.last_assessed_at)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Состояние команды */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Состояние команды
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Tile
            label="Средний gap-score"
            value={m.avg_gap_score === null ? '—' : m.avg_gap_score.toFixed(1)}
            hint={
              m.avg_gap_score === null
                ? 'недостаточно данных'
                : 'дефицит по ключевым (★) компетенциям на сотрудника, меньше = лучше'
            }
            tone={
              m.avg_gap_score === null
                ? 'default'
                : m.avg_gap_score < 3
                  ? 'good'
                  : m.avg_gap_score < 8
                    ? 'default'
                    : 'warn'
            }
          />
          <Tile
            label="С назначенной ролью"
            value={`${m.employees_with_role_grade} / ${m.employees_total}`}
            hint="без role+grade гэпы не считаются"
          />
          <Tile
            label="Сотрудников всего"
            value={m.employees_total}
          />
        </div>

        {m.top_gap_competencies.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl bg-bg-elevated">
            <div className="border-b border-white/5 px-6 py-3 text-sm font-semibold text-slate-300">
              Топ ключевых компетенций с дефицитом
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-6 py-2">Компетенция</th>
                  <th className="w-32 px-6 py-2 text-center">У скольких</th>
                  <th className="w-32 px-6 py-2 text-center">Средний gap</th>
                </tr>
              </thead>
              <tbody>
                {m.top_gap_competencies.map((c) => (
                  <tr key={c.competency_id} className="border-t border-white/5">
                    <td className="px-6 py-2">{c.competency_name}</td>
                    <td className="px-6 py-2 text-center">
                      <span className="text-amber-400">{c.affected_count}</span>
                      <span className="text-slate-600"> / {c.total_with_role}</span>
                    </td>
                    <td className="px-6 py-2 text-center font-semibold text-amber-400">
                      +{c.avg_gap.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

        </div>
      )}

      {tab === 'rotations' && (
        <div className="space-y-8">
      <section>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Tile
            label="Кандидатов готово"
            value={m.rotation_candidates_count}
            hint={
              m.rotation_candidates_count === 0
                ? 'все участники в проектах < 18 мес или заморожены'
                : 'tenure ≥ 18 мес, не заморожены, без активной ротации'
            }
            tone={
              m.rotation_candidates_count === 0
                ? 'good'
                : m.rotation_candidates_count <= 5
                  ? 'default'
                  : 'warn'
            }
          />
          <Tile
            label="Bus-factor алертов"
            value={m.bus_factor_alerts}
            hint="★-компетенций с единственным носителем"
            tone={
              m.bus_factor_alerts === 0
                ? 'good'
                : m.bus_factor_alerts <= 3
                  ? 'warn'
                  : 'bad'
            }
          />
          <Tile
            label="В работе"
            value={m.rotations_in_progress}
            hint="ожидают согласования или завершения"
          />
          <Tile
            label="Заморожено участников"
            value={m.locked_members_count}
            hint="нельзя «выдёргивать» из проекта"
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Tile
            label="Завершено ротаций / 30 дней"
            value={m.rotations_completed_last_30d}
          />
          <Tile
            label="Завершено ротаций / год"
            value={m.rotations_completed_last_12m}
          />
        </div>

        {m.rotation_top_candidates.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-2xl bg-bg-elevated">
            <div className="border-b border-white/5 px-6 py-3 text-sm font-semibold text-slate-300">
              Ближайшие кандидаты на ротацию
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-6 py-2">ФИО</th>
                  <th className="px-6 py-2">Проект</th>
                  <th className="w-28 px-6 py-2 text-center">Стаж</th>
                  <th className="w-24 px-6 py-2 text-center">Score</th>
                  <th className="w-28 px-6 py-2 text-center">Bus-factor</th>
                </tr>
              </thead>
              <tbody>
                {m.rotation_top_candidates.map((c) => (
                  <tr
                    key={`${c.employee_id}-${c.from_project_id}`}
                    onClick={() => navigate(`/projects/${c.from_project_id}`)}
                    className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                  >
                    <td className="px-6 py-2">
                      {c.full_name}
                      <span className="ml-2 text-xs text-slate-500">
                        {c.role_name || '—'}
                        {c.grade_code && ` · ${c.grade_code}`}
                      </span>
                    </td>
                    <td className="px-6 py-2 text-slate-400">
                      {c.from_project_name}
                    </td>
                    <td className="px-6 py-2 text-center text-slate-300">
                      {c.tenure_months} мес
                    </td>
                    <td className="px-6 py-2 text-center font-semibold text-accent">
                      {c.score}
                    </td>
                    <td className="px-6 py-2 text-center">
                      {c.bus_factor_score > 0 ? (
                        <span className="text-rose-400">{c.bus_factor_score}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

        </div>
      )}

      {tab === 'self_review' && (
        <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="text-sm text-slate-500">Год: {m.self_review_year}</div>
          <div className="text-xs text-slate-500">
            до конца года:{' '}
            <span
              className={
                m.self_review_days_to_year_end < 30
                  ? 'font-semibold text-rose-400'
                  : m.self_review_days_to_year_end < 90
                    ? 'font-semibold text-amber-400'
                    : 'text-slate-300'
              }
            >
              {m.self_review_days_to_year_end} дн
            </span>
          </div>
        </div>

        {(m.self_review_pending > 0 ||
          m.self_review_stuck_submitted > 0 ||
          m.self_review_stale_drafts > 0) && (
          <div className="attention-banner mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-200 ring-1 ring-amber-500/20">
            <div className="font-semibold">Требует внимания</div>
            <ul className="mt-1 space-y-0.5">
              {m.self_review_pending > 0 && (
                <li>
                  {m.self_review_pending}{' '}
                  {m.self_review_pending === 1 ? 'сотрудник' : 'сотрудников'} без
                  ревью {m.self_review_year}
                </li>
              )}
              {m.self_review_stuck_submitted > 0 && (
                <li>
                  {m.self_review_stuck_submitted} ревью «отправлен» больше 14 дней
                  без закрытия — провести 1:1
                </li>
              )}
              {m.self_review_stale_drafts > 0 && (
                <li>
                  {m.self_review_stale_drafts} черновиков старше 30 дней без файла
                  — напомнить сотрудникам
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Tile
            label="Заведено"
            value={`${m.self_review_total} / ${m.employees_total}`}
            tone={m.self_review_pending === 0 ? 'good' : 'warn'}
            hint={
              m.self_review_pending === 0
                ? 'все сотрудники охвачены'
                : `${m.self_review_pending} без ревью`
            }
          />
          <Tile label="Черновики" value={m.self_review_drafts} tone="warn" />
          <Tile label="Отправлено" value={m.self_review_submitted} />
          <Tile
            label="Закрыто"
            value={m.self_review_closed}
            tone={m.self_review_closed > 0 ? 'good' : 'default'}
          />
          <Tile
            label="Средние оценки"
            value={
              m.self_review_avg_project !== null ||
              m.self_review_avg_company !== null
                ? `${m.self_review_avg_project ?? '—'} / ${m.self_review_avg_company ?? '—'}`
                : '—'
            }
            hint="проект / компания (1-10)"
          />
        </div>
        <button
          onClick={() => navigate('/self-review')}
          className="mt-3 text-xs text-accent hover:underline"
        >
          к вкладке «Self-Review» →
        </button>
      </section>

        </div>
      )}

      {tab === 'hiring' && (
        <div className="space-y-8">
          <section>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Tile
                label="Открытых вакансий"
                value={m.vacancies_open}
                tone={m.vacancies_open > 0 ? 'default' : 'good'}
                hint={
                  m.vacancies_closed > 0
                    ? `закрытых: ${m.vacancies_closed}`
                    : undefined
                }
              />
              <Tile
                label="Кандидатов всего"
                value={m.candidates_total}
                hint={
                  m.candidates_in_pipeline > 0
                    ? `в работе: ${m.candidates_in_pipeline}`
                    : 'воронка пуста'
                }
              />
              <Tile
                label={`Нанято в ${new Date().getFullYear()}`}
                value={m.candidates_hired_year}
                tone={m.candidates_hired_year > 0 ? 'good' : 'default'}
              />
              <Tile
                label={`Отклонено в ${new Date().getFullYear()}`}
                value={m.candidates_rejected_year}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-2">
              <Tile
                label="Новых кандидатов / 30 дней"
                value={m.candidates_added_last_30d}
              />
              <Tile
                label="Конверсия найма (год)"
                value={
                  m.candidates_hired_year + m.candidates_rejected_year > 0
                    ? `${Math.round(
                        (m.candidates_hired_year * 100) /
                          (m.candidates_hired_year +
                            m.candidates_rejected_year),
                      )}%`
                    : '—'
                }
                hint="нанято / (нанято + отклонено)"
              />
            </div>
          </section>

          {m.candidates_by_stage.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Распределение по стадиям
              </h2>
              <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                <div className="space-y-2 px-6 py-4">
                  {m.candidates_by_stage.map((b) => {
                    const pct =
                      m.candidates_total > 0
                        ? (b.count / m.candidates_total) * 100
                        : 0
                    return (
                      <div key={b.stage} className="flex items-center gap-3">
                        <span
                          className={
                            'inline-block w-24 rounded px-2 py-0.5 text-center text-xs ' +
                            (STAGE_TONE_DASH[b.stage] ||
                              'bg-slate-500/15 text-slate-300')
                          }
                        >
                          {STAGE_LABEL_DASH[b.stage] || b.stage}
                        </span>
                        <div className="h-3 flex-1 overflow-hidden rounded-full bg-bg-panel">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-xs text-slate-400">
                          {b.count} · {Math.round(pct)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Топ вакансий
              </h2>
              <button
                onClick={() => navigate('/vacancies')}
                className="text-xs text-accent hover:underline"
              >
                все вакансии →
              </button>
            </div>
            {m.top_vacancies.length === 0 ? (
              <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
                Пока нет вакансий. Создайте первую — кандидаты привязываются к
                вакансии для AI-скрининга.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl bg-bg-elevated">
                <table className="w-full text-left text-sm">
                  <thead className="bg-bg-panel text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Вакансия</th>
                      <th className="px-4 py-3">Проект / Отдел</th>
                      <th className="px-4 py-3 text-center">Кандидатов</th>
                      <th className="px-4 py-3">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.top_vacancies.map((v) => (
                      <tr
                        key={v.id}
                        onClick={() => navigate(`/vacancies/${v.id}`)}
                        className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                      >
                        <td className="px-4 py-3 font-medium">{v.title}</td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {v.project_name || v.department_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-center text-accent">
                          {v.candidates_count}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={
                              'rounded px-2 py-0.5 ' +
                              (v.status === 'open'
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-slate-500/15 text-slate-400')
                            }
                          >
                            {v.status === 'open' ? 'открыта' : 'закрыта'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="flex gap-3 text-xs">
            <button
              onClick={() => navigate('/hiring')}
              className="rounded bg-bg-panel px-3 py-2 text-slate-300 ring-1 ring-white/5 hover:text-accent"
            >
              к кандидатам →
            </button>
            <button
              onClick={() => navigate('/vacancies')}
              className="rounded bg-bg-panel px-3 py-2 text-slate-300 ring-1 ring-white/5 hover:text-accent"
            >
              к вакансиям →
            </button>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-8">
          <section>
            <div className="text-sm text-slate-500">Последние 30 дней</div>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Tile label="Оценок проведено" value={m.assessments_last_30d} />
              <Tile label="Встреч 1:1" value={m.meetings_done_last_30d} />
              <Tile
                label="AI-задач выполнено"
                value={m.ai_jobs_done_last_30d}
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Разработка (CodeBuddy)
            </h2>
            <DevActivityWidget managerId={effectiveManagerId} />
          </section>
        </div>
      )}
    </div>
  )
}
