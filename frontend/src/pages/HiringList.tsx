import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  CandidateListItem,
  CandidateStage,
  Grade,
  Role,
  VacancyListItem,
  api,
} from '../api/client'
import { UpcomingMeetingsWidget } from '../components/UpcomingMeetingsWidget'
import { useReadOnly } from '../lib/auth-context'

const STAGE_LABEL: Record<CandidateStage, string> = {
  new: 'новый',
  screening: 'скрининг',
  interview: 'интервью',
  offer: 'оффер',
  hired: 'нанят',
  rejected: 'отклонён',
}

const STAGE_CLR: Record<CandidateStage, string> = {
  new: 'text-slate-300',
  screening: 'text-amber-400',
  interview: 'text-accent',
  offer: 'text-accent',
  hired: 'text-emerald-400',
  rejected: 'text-rose-400',
}

const STAGES: CandidateStage[] = [
  'new',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function HiringList() {
  const navigate = useNavigate()
  const readOnly = useReadOnly()
  const [items, setItems] = useState<CandidateListItem[]>([])
  const [filter, setFilter] = useState<CandidateStage | 'all'>('all')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // create form
  const [showCreate, setShowCreate] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [position, setPosition] = useState('')
  const [source, setSource] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [vacancies, setVacancies] = useState<VacancyListItem[]>([])
  const [vacancyId, setVacancyId] = useState('')
  const [expectedRole, setExpectedRole] = useState('')
  const [expectedGrade, setExpectedGrade] = useState('')
  const [creating, setCreating] = useState(false)

  const refresh = async () => {
    try {
      const list = await api.candidates.list()
      setItems(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    api.mpk.roles().then(setRoles).catch(() => undefined)
    api.mpk.grades().then(setGrades).catch(() => undefined)
    api.vacancies
      .list({ status: 'open' })
      .then(setVacancies)
      .catch(() => undefined)
  }, [])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const c = await api.candidates.create({
        full_name: fullName.trim(),
        email: email.trim() || null,
        position: position.trim() || null,
        source: source.trim() || null,
        vacancy_id: vacancyId ? Number(vacancyId) : null,
        expected_role_id: expectedRole ? Number(expectedRole) : null,
        expected_grade_id: expectedGrade ? Number(expectedGrade) : null,
      })
      setShowCreate(false)
      setFullName('')
      setEmail('')
      setPosition('')
      setSource('')
      setVacancyId('')
      setExpectedRole('')
      setExpectedGrade('')
      navigate(`/hiring/${c.id}`)
    } catch (err) {
      alert((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const visible =
    filter === 'all' ? items : items.filter((c) => c.stage === filter)

  // counts по стадиям для фильтр-кнопок
  const counts: Record<CandidateStage | 'all', number> = {
    all: items.length,
    new: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0,
  }
  for (const c of items) counts[c.stage]++

  if (loading) return <div className="text-slate-500">Загрузка…</div>
  if (error) return <div className="text-sm text-red-400">{error}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Кандидаты</h1>
          <p className="mt-1 text-sm text-slate-500">
            Кандидаты по воронке. Привяжите кандидата к вакансии и загрузите
            резюме — AI-скрининг выставит балл соответствия и обоснование, после
            чего можно вести интервью (тот же функционал, что в МПК).
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90"
          >
            + Добавить кандидата
          </button>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-2xl bg-bg-elevated p-4"
        >
          <div className="text-sm font-semibold text-slate-200">
            Новый кандидат
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              required
              autoFocus
              placeholder="ФИО *"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <input
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <input
              placeholder="Желаемая должность"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <input
              placeholder="Источник (LinkedIn, hh, реферал…)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <select
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent md:col-span-2"
            >
              <option value="">Вакансия (опц., но без неё AI-скрининг слабее)</option>
              {vacancies.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                  {v.project_name && ` · ${v.project_name}`}
                </option>
              ))}
            </select>
            <select
              value={expectedRole}
              onChange={(e) => setExpectedRole(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="">Ожидаемая роль (если без вакансии)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              value={expectedGrade}
              onChange={(e) => setExpectedGrade(e.target.value)}
              className="rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            >
              <option value="">Ожидаемый грейд (опц.)</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              {creating ? '…' : 'Создать'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Ближайшие интервью
        </h2>
        <UpcomingMeetingsWidget
          filterKinds={['hiring']}
          emptyHint="Нет назначенных интервью на ближайшие 30 дней."
        />
      </section>

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => setFilter('all')}
          className={
            'rounded-full px-3 py-1 ring-1 ring-white/5 ' +
            (filter === 'all'
              ? 'bg-accent/15 text-accent'
              : 'bg-bg-panel text-slate-300 hover:text-accent')
          }
        >
          все ({counts.all})
        </button>
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={
              'rounded-full px-3 py-1 ring-1 ring-white/5 ' +
              (filter === s
                ? 'bg-accent/15 text-accent'
                : 'bg-bg-panel text-slate-300 hover:text-accent')
            }
          >
            {STAGE_LABEL[s]} ({counts[s]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
          Пока нет кандидатов в этой стадии.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-bg-elevated">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-panel text-slate-400">
              <tr>
                <th className="px-4 py-3">ФИО</th>
                <th className="px-4 py-3">Вакансия</th>
                <th className="px-4 py-3">AI-скрининг</th>
                <th className="px-4 py-3">Резюме</th>
                <th className="px-4 py-3">Стадия</th>
                <th className="px-4 py-3">Источник</th>
                <th className="px-4 py-3">Создан</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/hiring/${c.id}`)}
                  className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {c.position || '—'}
                      {c.expected_role_name &&
                        ` · ${c.expected_role_name}`}
                      {c.expected_grade_code &&
                        ` · ${c.expected_grade_code}`}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {c.vacancy_title || (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.ai_screening_recommended === true ? (
                      <span
                        className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300"
                        title="рекомендован к собеседованию"
                      >
                        ✓ да
                      </span>
                    ) : c.ai_screening_recommended === false ? (
                      <span
                        className="rounded bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-300"
                        title="не рекомендован"
                      >
                        ✗ нет
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.has_resume ? 'есть' : '—'}
                  </td>
                  <td className={`px-4 py-3 text-xs ${STAGE_CLR[c.stage]}`}>
                    {STAGE_LABEL[c.stage]}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.source || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDate(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
