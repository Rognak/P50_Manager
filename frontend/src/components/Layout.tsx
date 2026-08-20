import { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { UserRole } from '../api/client'
import { clearToken } from '../lib/auth'
import { useAuth } from '../lib/auth-context'
import { ExternalLinkIcon } from './ExternalLinkIcon'
import { NotificationBell } from './NotificationBell'
import { ThemeToggle } from './ThemeToggle'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block border-l-2 rounded-lg px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
    isActive
      ? 'nav-item-active font-medium'
      : 'border-transparent text-ink-secondary hover:bg-surface-subtle hover:text-ink'
  }`

const ROLE_LABEL: Record<UserRole, string> = {
  department_head: 'Руководитель отдела',
  manager: 'Менеджер продукта',
  core_team: 'CoreTeam (read-only)',
}

const ROLE_TONE: Record<UserRole, string> = {
  department_head: 'text-primary',
  manager: 'text-ink-secondary',
  core_team: 'text-ink-secondary',
}

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, refresh } = useAuth()
  const logout = () => {
    clearToken()
    refresh()
    navigate('/login')
  }

  // Менеджер продукта работает только в рамках своих проектов:
  // ему не нужны разделы по сотрудникам/найму/МПК/self-review/ротациям.
  const isPm = user?.role === 'manager'
  // По умолчанию (если бек не вернул карту) показываем всё.
  const visible = (key: string): boolean =>
    user?.nav_visibility?.[key] ?? true

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-outline-subtle bg-surface p-4">
        <div className="mb-2 text-lg font-semibold text-primary">Прогресс 50</div>
        {user && (
          <div className="mb-6 rounded-lg bg-surface-subtle p-2 ring-1 ring-outline-subtle">
            <div className="truncate text-xs font-medium text-ink">
              {user.full_name}
            </div>
            <div
              className={`text-[10px] font-medium ${ROLE_TONE[user.role]}`}
              title={user.email}
            >
              {ROLE_LABEL[user.role]}
              {user.is_admin && (
                <span className="ml-1 text-warning">· admin</span>
              )}
            </div>
          </div>
        )}
        <nav className="space-y-1">
          {visible('dashboard') && (
            <NavLink to="/" end className={linkClass}>
              Dashboard
            </NavLink>
          )}
          {!isPm && visible('employees') && (
            <NavLink to="/employees" className={linkClass}>
              Сотрудники
            </NavLink>
          )}
          {visible('projects') && (
            <NavLink to="/products" className={linkClass}>
              Продукты
            </NavLink>
          )}
          {visible('technology_radar') && (
            <NavLink to="/technology-radar" className={linkClass}>
              Радар технологий
            </NavLink>
          )}
          {visible('departments') && (
            <NavLink to="/departments" className={linkClass}>
              Тех. зрелость практик
            </NavLink>
          )}
          {visible('assignments') && (
            <NavLink to="/assignments" className={linkClass}>
              Поручения
            </NavLink>
          )}
          {visible('rotations') && (
            <NavLink to="/rotations" className={linkClass}>
              Ротации
            </NavLink>
          )}
          {!isPm && visible('self_review') && (
            <NavLink to="/self-review" className={linkClass}>
              Self-Review
            </NavLink>
          )}
          {!isPm && visible('hiring') && (
            <NavLink to="/hiring" className={linkClass}>
              Кандидаты
            </NavLink>
          )}
          {!isPm && visible('vacancies') && (
            <NavLink to="/vacancies" className={linkClass}>
              Вакансии
            </NavLink>
          )}
          {!isPm && visible('mpk_reference') && (
            <NavLink to="/mpk-reference" className={linkClass}>
              Справочник МПК
            </NavLink>
          )}
        </nav>

        {user?.external_links && user.external_links.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-muted">
              Смежные системы
            </div>
            <div className="grid grid-cols-2 gap-2">
              {user.external_links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.url}
                  className="group flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl bg-surface-subtle px-2 py-2 text-center ring-1 ring-outline-subtle transition hover:ring-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ExternalLinkIcon label={link.label} />
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight text-ink-secondary group-hover:text-ink">
                    {link.label}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className="mt-6 w-full rounded-lg border border-outline px-3 py-2 text-sm text-ink-secondary transition hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Выйти
        </button>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-end gap-3 border-b border-outline-subtle bg-surface px-6 py-2">
          <ThemeToggle />
          {user?.is_admin && (
            <button
              onClick={() => navigate('/admin')}
              title="Админ-панель"
              aria-label="Админ-панель"
              className={
                'rounded-lg px-2 py-1 text-base transition ' +
                (location.pathname.startsWith('/admin')
                  ? 'bg-primary-soft text-primary'
                  : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink') +
                ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              }
            >
              ⚙
            </button>
          )}
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  )
}
