import { ReactNode, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, Employee, PublicProfile } from '../api/client'
import { DevMetricsTab } from '../components/employee/DevMetricsTab'
import { DigitalProfileTab } from '../components/employee/DigitalProfileTab'
import { ExtractedCompetenciesTab } from '../components/employee/ExtractedCompetenciesTab'
import { MpkTab } from '../components/employee/MpkTab'
import { ProceduresTab } from '../components/employee/ProceduresTab'
import { ProfileTab } from '../components/employee/ProfileTab'
import { ProjectsTab } from '../components/employee/ProjectsTab'
import { SelfReviewTab } from '../components/employee/SelfReviewTab'
import { TechnologiesPanel } from '../components/employee/TechnologiesPanel'

type TabId =
  | 'mpk'
  | 'procedures'
  | 'self_review'
  | 'projects'
  | 'dev_metrics'
  | 'extracted'
  | 'digital_profile'
  | 'technologies'
  | 'profile'

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

function LevelBadge({ level, muted = false }: { level: number; muted?: boolean }) {
  const style = muted ? 'text-slate-400 bg-bg-panel' : 'text-accent bg-accent/15'
  return (
    <span
      className={`inline-block min-w-[1.75rem] rounded px-2 py-0.5 text-center font-semibold ${style}`}
    >
      {level}
    </span>
  )
}

function GapBadge({ gap }: { gap: number }) {
  if (gap === 0) return <span className="text-slate-500">0</span>
  if (gap > 0) return <span className="font-semibold text-amber-400">+{gap}</span>
  return <span className="font-semibold text-emerald-400">{gap}</span>
}

function PublicView({ profile }: { profile: PublicProfile }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-amber-500/5 px-4 py-3 text-sm text-amber-300/90 ring-1 ring-amber-500/20">
        Чужой сотрудник: видны только итоговые уровни МПК. Встречи, артефакты,
        рекомендации — закрыты для просмотра. Руководитель: <strong>{profile.owner_name}</strong>.
      </div>
      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="w-12 px-4 py-3 text-right">#</th>
              <th className="px-4 py-3">Компетенция</th>
              <th className="w-24 px-4 py-3 text-center">Текущий</th>
              <th className="w-24 px-4 py-3 text-center">Требуемый</th>
              <th className="w-16 px-4 py-3 text-center">Δ</th>
            </tr>
          </thead>
          <tbody>
            {profile.items.map((i, idx) => (
              <tr key={i.competency_id} className="border-t border-white/5">
                <td className="px-4 py-3 text-right text-slate-500">{idx + 1}</td>
                <td className="px-4 py-3">{i.competency_name}</td>
                <td className="px-4 py-3 text-center">
                  {i.current_level === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <LevelBadge level={i.current_level} />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {i.required_level === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <LevelBadge level={i.required_level} muted />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
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
    </div>
  )
}

export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const empId = Number(id)

  const [tab, setTab] = useState<TabId>('mpk')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      // сначала пробуем публичный профиль — он доступен всем
      const pub = await api.employeePublic(empId)
      setPublicProfile(pub)
      // если мы owner — догружаем полные данные
      if (pub.is_owner) {
        const e = await api.employees.get(empId)
        setEmployee(e)
      } else {
        setEmployee(null)
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [empId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (error) return <div className="text-sm text-red-400">{error}</div>
  if (!publicProfile) return <div className="text-slate-500">Загрузка…</div>

  const headerName = employee?.full_name || publicProfile.full_name
  const headerPosition = employee?.position || publicProfile.position
  const roleName = employee?.role?.name || publicProfile.role?.name
  const gradeCode = employee?.grade?.code || publicProfile.grade?.code

  return (
    <div>
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-slate-400 hover:text-slate-200"
      >
        ← Назад
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{headerName}</h1>
        <div className="mt-1 text-sm text-slate-400">
          {headerPosition || '—'}
          {roleName && ` · ${roleName}`}
          {gradeCode && ` · ${gradeCode}`}
          {employee?.department && (
            <>
              {' · '}
              <a
                href={`/departments/${employee.department.id}`}
                onClick={(ev) => {
                  ev.preventDefault()
                  navigate(`/departments/${employee.department!.id}`)
                }}
                className="text-slate-300 hover:text-accent"
              >
                {employee.department.name}
              </a>
            </>
          )}
        </div>
      </div>

      {publicProfile.is_owner && employee ? (
        <>
          <div className="mb-4 flex gap-1 border-b border-white/5">
            <TabButton active={tab === 'mpk'} onClick={() => setTab('mpk')}>
              МПК
            </TabButton>
            <TabButton
              active={tab === 'procedures'}
              onClick={() => setTab('procedures')}
            >
              Процедуры МПК
            </TabButton>
            <TabButton
              active={tab === 'self_review'}
              onClick={() => setTab('self_review')}
            >
              Self-Review
            </TabButton>
            <TabButton
              active={tab === 'projects'}
              onClick={() => setTab('projects')}
            >
              Проекты
            </TabButton>
            <TabButton
              active={tab === 'dev_metrics'}
              onClick={() => setTab('dev_metrics')}
            >
              Дев-метрики
            </TabButton>
            <TabButton
              active={tab === 'extracted'}
              onClick={() => setTab('extracted')}
            >
              Компетенции (факт)
            </TabButton>
            <TabButton
              active={tab === 'digital_profile'}
              onClick={() => setTab('digital_profile')}
            >
              <span className="text-amber-400">⚡</span> AI-профиль
            </TabButton>
            <TabButton
              active={tab === 'technologies'}
              onClick={() => setTab('technologies')}
            >
              Технологии
            </TabButton>
            <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>
              Профиль
            </TabButton>
          </div>

          {tab === 'mpk' && <MpkTab employeeId={employee.id} />}
          {tab === 'procedures' && <ProceduresTab employeeId={employee.id} />}
          {tab === 'self_review' && <SelfReviewTab employeeId={employee.id} />}
          {tab === 'projects' && <ProjectsTab employeeId={employee.id} />}
          {tab === 'dev_metrics' && <DevMetricsTab employeeId={employee.id} />}
          {tab === 'extracted' && (
            <ExtractedCompetenciesTab employeeId={employee.id} />
          )}
          {tab === 'digital_profile' && (
            <DigitalProfileTab employeeId={employee.id} />
          )}
          {tab === 'technologies' && (
            <TechnologiesPanel employeeId={employee.id} />
          )}
          {tab === 'profile' && (
            <ProfileTab employee={employee} onChange={refresh} />
          )}
        </>
      ) : (
        <>
          <div className="mb-4 flex gap-1 border-b border-white/5">
            <TabButton
              active={tab !== 'technologies'}
              onClick={() => setTab('mpk')}
            >
              МПК
            </TabButton>
            <TabButton
              active={tab === 'technologies'}
              onClick={() => setTab('technologies')}
            >
              Технологии
            </TabButton>
          </div>
          {tab === 'technologies' ? (
            <TechnologiesPanel employeeId={empId} />
          ) : (
            <PublicView profile={publicProfile} />
          )}
        </>
      )}
    </div>
  )
}
