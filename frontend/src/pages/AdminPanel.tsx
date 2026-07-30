import { ReactNode, useEffect, useState } from 'react'

import {
  CodeBuddyHealthResponse,
  CronJobMeta,
  CronRunPublic,
  ExternalLink,
  IntegrationsResponse,
  LLMConfigResponse,
  LLMTestResponse,
  NavVisibilityResponse,
  NotificationAdminPublic,
  NotificationKindsResponse,
  UserRole,
  api,
} from '../api/client'

type Tab =
  | 'flags'
  | 'notif_kinds'
  | 'notif_all'
  | 'broadcast'
  | 'cron'
  | 'external_links'
  | 'integrations'
  | 'llm'

const TAB_LABELS: Record<Tab, string> = {
  flags: 'Фича-флаги',
  notif_kinds: 'Типы уведомлений',
  notif_all: 'Все уведомления',
  broadcast: 'Рассылка',
  cron: 'Cron',
  external_links: 'Смежные системы',
  integrations: 'Интеграции',
  llm: 'LLM',
}

const ROLE_LABEL: Record<UserRole, string> = {
  department_head: 'Руководитель',
  manager: 'Менеджер продукта',
  core_team: 'CoreTeam',
}

const NAV_KEY_LABEL: Record<string, string> = {
  dashboard: 'Dashboard',
  employees: 'Сотрудники',
  projects: 'Проекты',
  departments: 'Тех. зрелость практик',
  assignments: 'Поручения',
  rotations: 'Ротации',
  self_review: 'Self-Review',
  hiring: 'Кандидаты',
  vacancies: 'Вакансии',
  mpk_reference: 'Справочник МПК',
}

function TabBtn({
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
      className={
        '-mb-px px-4 py-2 text-sm transition ' +
        (active
          ? 'border-b-2 border-accent text-accent'
          : 'text-slate-400 hover:text-slate-200')
      }
    >
      {children}
    </button>
  )
}

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('flags')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Админ-панель</h1>
        <p className="mt-1 text-sm text-slate-500">
          Управление видимостью разделов, уведомлениями, cron-задачами.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/5">
        {(Object.keys(TAB_LABELS) as Tab[]).map((k) => (
          <TabBtn key={k} active={tab === k} onClick={() => setTab(k)}>
            {TAB_LABELS[k]}
          </TabBtn>
        ))}
      </div>

      {tab === 'flags' && <FeatureFlagsTab />}
      {tab === 'notif_kinds' && <NotificationKindsTab />}
      {tab === 'notif_all' && <NotificationsAllTab />}
      {tab === 'broadcast' && <BroadcastTab />}
      {tab === 'cron' && <CronTab />}
      {tab === 'external_links' && <ExternalLinksTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'llm' && <LlmTab />}
    </div>
  )
}

// ---------- Tab: External links (DSTracker / CodeBuddy / ...) ----------

function ExternalLinksTab() {
  const [links, setLinks] = useState<ExternalLink[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.admin.externalLinks
      .get()
      .then((r) => setLinks(r.links))
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div className="text-sm text-rose-400">{error}</div>
  if (!links) return <div className="text-slate-500">Загрузка…</div>

  const update = (idx: number, field: 'label' | 'url', value: string) => {
    const next = links.map((l, i) => (i === idx ? { ...l, [field]: value } : l))
    setLinks(next)
    setDirty(true)
  }

  const add = () => {
    setLinks([...links, { label: '', url: '' }])
    setDirty(true)
  }

  const remove = (idx: number) => {
    setLinks(links.filter((_, i) => i !== idx))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const cleaned = links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label && l.url)
      const r = await api.admin.externalLinks.put(cleaned)
      setLinks(r.links)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-slate-400">
        Ссылки на смежные системы, которые показываются квадратами в нижней
        части левого сайдбара (открываются в новой вкладке). Изменения видны
        пользователям после следующей загрузки страницы.
      </p>
      <div className="space-y-2">
        {links.length === 0 && (
          <div className="rounded-lg bg-bg-elevated px-4 py-3 text-sm text-slate-500">
            Ссылок ещё нет. Нажмите «+ Добавить».
          </div>
        )}
        {links.map((l, idx) => (
          <div
            key={idx}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-elevated p-3 ring-1 ring-white/5"
          >
            <input
              placeholder="Название (напр. DSTracker)"
              value={l.label}
              onChange={(e) => update(idx, 'label', e.target.value)}
              className="w-40 rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <input
              placeholder="https://…"
              value={l.url}
              onChange={(e) => update(idx, 'url', e.target.value)}
              className="min-w-[260px] flex-1 rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
            />
            <button
              onClick={() => remove(idx)}
              className="text-xs text-slate-500 hover:text-rose-400"
            >
              удалить
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={add}
          className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent"
        >
          + Добавить
        </button>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {dirty && (
          <span className="self-center text-xs text-amber-400">
            есть несохранённые изменения
          </span>
        )}
      </div>
    </div>
  )
}

// ---------- Tab: Feature flags (видимость nav) ----------

function FeatureFlagsTab() {
  const [data, setData] = useState<NavVisibilityResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.admin.navVisibility
      .get()
      .then(setData)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div className="text-rose-400 text-sm">{error}</div>
  if (!data) return <div className="text-slate-500">Загрузка…</div>

  const toggle = (navKey: string, role: UserRole) => {
    const items = { ...data.items }
    items[navKey] = { ...items[navKey], [role]: !items[navKey][role] }
    setData({ items })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const fresh = await api.admin.navVisibility.put(data.items)
      setData(fresh)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const navKeys = Object.keys(data.items)
  const roles: UserRole[] = ['department_head', 'manager', 'core_team']

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Поставьте галочку, чтобы раздел был виден пользователям этой роли.
        Изменения вступают в силу после сохранения и при следующей загрузке
        страницы.
      </p>
      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-4 py-3">Раздел</th>
              {roles.map((r) => (
                <th key={r} className="px-4 py-3 text-center">
                  {ROLE_LABEL[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {navKeys.map((nav) => (
              <tr key={nav} className="border-t border-white/5">
                <td className="px-4 py-3">{NAV_KEY_LABEL[nav] || nav}</td>
                {roles.map((r) => (
                  <td key={r} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={data.items[nav][r]}
                      onChange={() => toggle(nav, r)}
                      className="accent-accent h-4 w-4"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {dirty && (
          <span className="self-center text-xs text-amber-400">
            есть несохранённые изменения
          </span>
        )}
      </div>
    </div>
  )
}

// ---------- Tab: Notification kinds (вкл/выкл) ----------

function NotificationKindsTab() {
  const [data, setData] = useState<NotificationKindsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.admin.notificationKinds
      .get()
      .then(setData)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div className="text-rose-400 text-sm">{error}</div>
  if (!data) return <div className="text-slate-500">Загрузка…</div>

  const toggle = (k: string) => {
    setData({
      ...data,
      enabled: { ...data.enabled, [k]: !data.enabled[k] },
    })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const fresh = await api.admin.notificationKinds.put(data.enabled)
      setData(fresh)
      setDirty(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Выключенные типы перестают создаваться на стороне бэкенда — даже если
        событие сработает, уведомление не появится у пользователей.
      </p>
      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-4 py-3">Тип</th>
              <th className="px-4 py-3 text-center">Включён</th>
            </tr>
          </thead>
          <tbody>
            {data.all_known_kinds.map((k) => (
              <tr key={k} className="border-t border-white/5">
                <td className="px-4 py-3 font-mono text-xs">{k}</td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={data.enabled[k] ?? true}
                    onChange={() => toggle(k)}
                    className="accent-accent h-4 w-4"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        onClick={save}
        disabled={!dirty || saving}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
      >
        {saving ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </div>
  )
}

// ---------- Tab: все уведомления ----------

function NotificationsAllTab() {
  const [items, setItems] = useState<NotificationAdminPublic[] | null>(null)
  const [filterKind, setFilterKind] = useState('')
  const [cleanupDays, setCleanupDays] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      const list = await api.admin.notifications.list({
        kind: filterKind || undefined,
        limit: 200,
      })
      setItems(list)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKind])

  const cleanup = async () => {
    if (!confirm(`Удалить все уведомления старше ${cleanupDays} дней?`)) return
    setBusy(true)
    try {
      const res = await api.admin.notifications.cleanup(cleanupDays)
      alert(`Удалено: ${res.deleted}`)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="text-rose-400 text-sm">{error}</div>
  if (items === null) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3 text-sm">
        <input
          placeholder="Фильтр по kind (точно)…"
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value)}
          className="rounded bg-bg-panel px-3 py-2 text-xs ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <div className="ml-auto flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={cleanupDays}
            onChange={(e) => setCleanupDays(Number(e.target.value))}
            className="w-20 rounded bg-bg-panel px-2 py-1 text-xs ring-1 ring-white/5"
          />
          <span className="text-xs text-slate-500">дней</span>
          <button
            onClick={cleanup}
            disabled={busy}
            className="rounded bg-rose-500/15 px-3 py-1 text-xs text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
          >
            Очистить старше
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-500">Показано: {items.length}</div>
      <div className="overflow-hidden rounded-2xl bg-bg-elevated">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-panel text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Получатель</th>
              <th className="px-3 py-2">Тип</th>
              <th className="px-3 py-2">Заголовок</th>
              <th className="px-3 py-2">Создано</th>
              <th className="px-3 py-2">Прочитано</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id} className="border-t border-white/5">
                <td className="px-3 py-2 text-slate-500">{n.id}</td>
                <td className="px-3 py-2 text-slate-300">
                  {n.recipient_email || `id=${n.recipient_user_id}`}
                </td>
                <td className="px-3 py-2 font-mono text-slate-400">{n.kind}</td>
                <td className="px-3 py-2">{n.title}</td>
                <td className="px-3 py-2 text-slate-500">
                  {new Date(n.created_at).toLocaleString('ru-RU')}
                </td>
                <td className="px-3 py-2">
                  {n.is_read ? '✓' : (
                    <span className="text-amber-400">●</span>
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

// ---------- Tab: Broadcast ----------

function BroadcastTab() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [target, setTarget] = useState<'all' | UserRole>('all')
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    if (!title.trim()) return
    if (
      !confirm(
        `Отправить ВСЕМ ${target === 'all' ? 'активным пользователям' : ROLE_LABEL[target]}?`,
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      const res = await api.admin.notifications.broadcast({
        title: title.trim(),
        body: body.trim() || null,
        role: target === 'all' ? null : target,
        user_ids: null,
      })
      setLastResult(`Доставлено: ${res.delivered}`)
      setTitle('')
      setBody('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-slate-400">
        Уведомление получит каждый выбранный пользователь как обычное событие
        с kind <code className="text-slate-300">admin_broadcast</code>.
      </p>
      <label className="block text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
          Кому
        </span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as 'all' | UserRole)}
          className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5"
        >
          <option value="all">Всем активным</option>
          <option value="department_head">Только руководителям</option>
          <option value="manager">Только менеджерам продукта</option>
          <option value="core_team">Только CoreTeam</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
          Заголовок *
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
          Текст (опц.)
        </span>
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
        />
      </label>
      <button
        onClick={send}
        disabled={busy || !title.trim()}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
      >
        {busy ? 'Отправляем…' : 'Отправить'}
      </button>
      {lastResult && (
        <div className="text-sm text-emerald-400">{lastResult}</div>
      )}
      {error && <div className="text-sm text-rose-400">{error}</div>}
    </div>
  )
}

// ---------- Tab: Cron ----------

function CronTab() {
  const [jobs, setJobs] = useState<CronJobMeta[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [history, setHistory] = useState<CronRunPublic[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      setJobs(await api.admin.cron.list())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const toggle = async (name: string, paused: boolean) => {
    setBusy(name)
    try {
      await api.admin.cron.pause(name, paused)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runNow = async (name: string) => {
    if (!confirm(`Запустить «${name}» прямо сейчас?`)) return
    setBusy(name)
    try {
      await api.admin.cron.runNow(name)
      // ждём 2 секунды, потом обновляем — чтобы успел появиться new run row
      setTimeout(refresh, 2000)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const openHistory = async (name: string) => {
    if (expanded === name) {
      setExpanded(null)
      return
    }
    setExpanded(name)
    setHistory([])
    try {
      const list = await api.admin.cron.runs(name, 20)
      setHistory(list)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error) return <div className="text-rose-400 text-sm">{error}</div>
  if (jobs === null) return <div className="text-slate-500">Загрузка…</div>

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Cron-задачи. Кнопка «пауза» отключает выполнение без рестарта воркера.
        «Запустить сейчас» — внеплановый ручной запуск.
      </p>
      {jobs.map((j) => {
        const isExp = expanded === j.name
        return (
          <div
            key={j.name}
            className="overflow-hidden rounded-2xl bg-bg-elevated ring-1 ring-white/5"
          >
            <div className="flex flex-wrap items-baseline gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-200">
                    {j.name}
                  </span>
                  {j.paused && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                      на паузе
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {j.description} · <span className="text-slate-400">{j.schedule}</span>
                </div>
                {j.last_run && (
                  <div className="mt-1 text-xs">
                    Последний запуск:{' '}
                    <span
                      className={
                        j.last_run.status === 'ok'
                          ? 'text-emerald-400'
                          : j.last_run.status === 'error'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                      }
                    >
                      {j.last_run.status}
                    </span>
                    <span className="text-slate-500">
                      {' '}({j.last_run.trigger}) ·{' '}
                      {new Date(j.last_run.started_at).toLocaleString('ru-RU')}
                    </span>
                    {j.last_run.error_msg && (
                      <div className="mt-1 text-[11px] text-rose-400/80">
                        {j.last_run.error_msg.slice(0, 200)}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runNow(j.name)}
                  disabled={busy === j.name}
                  className="rounded bg-accent/15 px-3 py-1 text-xs text-accent hover:bg-accent/25 disabled:opacity-50"
                >
                  {busy === j.name ? '…' : 'Запустить сейчас'}
                </button>
                <button
                  onClick={() => toggle(j.name, !j.paused)}
                  disabled={busy === j.name}
                  className={
                    'rounded px-3 py-1 text-xs disabled:opacity-50 ' +
                    (j.paused
                      ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25')
                  }
                >
                  {j.paused ? 'Возобновить' : 'Пауза'}
                </button>
                <button
                  onClick={() => openHistory(j.name)}
                  className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  {isExp ? 'скрыть' : 'история'}
                </button>
              </div>
            </div>
            {isExp && (
              <div className="border-t border-white/5 bg-bg-panel/30">
                {history.length === 0 ? (
                  <div className="px-5 py-3 text-xs text-slate-500">
                    Запусков ещё не было.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="px-5 py-2">Когда</th>
                        <th className="px-2 py-2">Триггер</th>
                        <th className="px-2 py-2">Статус</th>
                        <th className="px-2 py-2">Длительность</th>
                        <th className="px-2 py-2">Ошибка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((r) => {
                        const dur =
                          r.finished_at && r.started_at
                            ? Math.round(
                                (new Date(r.finished_at).getTime() -
                                  new Date(r.started_at).getTime()) /
                                  1000,
                              ) + ' с'
                            : '—'
                        return (
                          <tr key={r.id} className="border-t border-white/5">
                            <td className="px-5 py-2 text-slate-400">
                              {new Date(r.started_at).toLocaleString('ru-RU')}
                            </td>
                            <td className="px-2 py-2 text-slate-500">{r.trigger}</td>
                            <td
                              className={
                                'px-2 py-2 ' +
                                (r.status === 'ok'
                                  ? 'text-emerald-400'
                                  : r.status === 'error'
                                    ? 'text-rose-400'
                                    : 'text-amber-400')
                              }
                            >
                              {r.status}
                            </td>
                            <td className="px-2 py-2 text-slate-500">{dur}</td>
                            <td className="px-2 py-2 text-rose-400/80">
                              {r.error_msg
                                ? r.error_msg.slice(0, 100)
                                : ''}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------- Tab: Интеграции (CodeBuddy live vs mock + healthcheck) ----------

function IntegrationsTab() {
  const [data, setData] = useState<IntegrationsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<CodeBuddyHealthResponse | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [cacheDeleted, setCacheDeleted] = useState<number | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncResult, setSyncResult] = useState<{
    enqueued: number
    team_size: number
  } | null>(null)

  useEffect(() => {
    api.admin.integrations
      .get()
      .then(setData)
      .catch((e) => setError((e as Error).message))
  }, [])

  if (error) return <div className="text-sm text-rose-400">{error}</div>
  if (!data) return <div className="text-slate-500">Загрузка…</div>

  const toggleCodebuddy = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await api.admin.integrations.put({
        codebuddy_live: !data.codebuddy_live,
      })
      setData(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const runHealthcheck = async () => {
    setHealthBusy(true)
    setError(null)
    try {
      const r = await api.admin.codebuddy.healthcheck()
      setHealth(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setHealthBusy(false)
    }
  }

  const invalidateCache = async () => {
    setCacheBusy(true)
    setCacheDeleted(null)
    setError(null)
    try {
      const r = await api.admin.codebuddy.invalidateCache()
      setCacheDeleted(r.deleted)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCacheBusy(false)
    }
  }

  const runFullSync = async () => {
    if (
      !confirm(
        'Запустить полный синк проектов из CodeBuddy за всё время? ' +
          'Будет поставлена задача в очередь по каждому активному сотруднику. ' +
          'Может занять несколько минут.',
      )
    )
      return
    setSyncBusy(true)
    setSyncResult(null)
    setError(null)
    try {
      const r = await api.admin.codebuddy.syncProjectsFull()
      setSyncResult(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-slate-400">
        Управление подключёнными внешними системами. Если интеграция
        выключена — система использует моки из локальной БД.
      </p>

      <div className="space-y-3 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-medium">CodeBuddy External API</div>
            <p className="mt-1 text-sm text-slate-400">
              Источник данных для Dev-метрик и извлечённых компетенций.
              {data.codebuddy_live ? (
                <>
                  {' '}
                  Сейчас активен <span className="text-emerald-400">live</span>:
                  запросы идут в CodeBuddy с кэшированием в Redis.
                </>
              ) : (
                <>
                  {' '}
                  Сейчас активен <span className="text-amber-400">mock</span>:
                  данные читаются из таблиц `dev_metrics_snapshots` и
                  `extracted_competencies`.
                </>
              )}
            </p>
          </div>
          <button
            onClick={toggleCodebuddy}
            disabled={saving}
            className={
              'shrink-0 rounded-lg px-4 py-2 text-sm font-medium ring-1 disabled:opacity-50 ' +
              (data.codebuddy_live
                ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-bg-panel text-slate-300 ring-white/10 hover:text-accent')
            }
          >
            {saving ? '…' : data.codebuddy_live ? 'Включено' : 'Выключено'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
          <button
            onClick={runHealthcheck}
            disabled={healthBusy}
            className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent disabled:opacity-50"
          >
            {healthBusy ? 'Проверка…' : 'Проверить связь'}
          </button>
          <button
            onClick={invalidateCache}
            disabled={cacheBusy}
            className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent disabled:opacity-50"
          >
            {cacheBusy ? 'Сбрасываем…' : 'Сбросить кэш Redis'}
          </button>
          <button
            onClick={runFullSync}
            disabled={syncBusy || !data.codebuddy_live}
            title={
              !data.codebuddy_live
                ? 'Доступно только при включённой интеграции'
                : undefined
            }
            className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent disabled:opacity-50"
          >
            {syncBusy ? 'Ставим в очередь…' : 'Полный синк проектов (за всё время)'}
          </button>
          {cacheDeleted !== null && (
            <span className="text-xs text-slate-400">
              удалено ключей: {cacheDeleted}
            </span>
          )}
          {syncResult && (
            <span className="text-xs text-emerald-400">
              в очередь поставлено {syncResult.enqueued} из {syncResult.team_size}
            </span>
          )}
        </div>

        {health && (
          <div
            className={
              'rounded-lg p-3 text-sm ring-1 ' +
              (health.ok
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-rose-500/10 text-rose-300 ring-rose-500/30')
            }
          >
            <div className="font-medium">
              {health.ok ? '✓ CodeBuddy доступен' : '✗ CodeBuddy недоступен'}
              {health.status_code !== null && health.status_code !== undefined && (
                <span className="ml-2 text-xs opacity-70">
                  HTTP {health.status_code}
                </span>
              )}
            </div>
            {health.ok ? (
              <div className="mt-1 text-xs opacity-80">
                feature-catalog: {health.languages ?? 0} языков /{' '}
                {health.categories ?? 0} категорий / {health.features ?? 0}{' '}
                фичей
              </div>
            ) : (
              health.reason && (
                <div className="mt-1 text-xs opacity-80">{health.reason}</div>
              )
            )}
            <div className="mt-1 text-xs opacity-50">
              проверено: {new Date(health.checked_at).toLocaleString('ru-RU')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Tab: LLM (OpenAI-совместимый провайдер для AI-функций) ----------

function LlmTab() {
  const [data, setData] = useState<LLMConfigResponse | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [test, setTest] = useState<LLMTestResponse | null>(null)

  const load = (d: LLMConfigResponse) => {
    setData(d)
    setBaseUrl(d.base_url)
    setModel(d.model)
    setApiKey('')
  }

  useEffect(() => {
    api.admin.llm
      .get()
      .then(load)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    setSavedOk(false)
    setTest(null)
    try {
      const fresh = await api.admin.llm.put({
        base_url: baseUrl,
        model,
        api_key: apiKey || null,
      })
      load(fresh)
      setSavedOk(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTestBusy(true)
    setTest(null)
    setError(null)
    try {
      setTest(await api.admin.llm.test())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTestBusy(false)
    }
  }

  if (loading) return <div className="text-slate-500">Загрузка…</div>

  const dirty =
    !!data &&
    (baseUrl !== data.base_url || model !== data.model || apiKey !== '')

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-slate-400">
        OpenAI-совместимый провайдер для всех AI-функций (вопросы и задания
        к встречам, цифровой профиль, разборы performance, ИПР). Значения
        отсюда имеют приоритет над переменными окружения{' '}
        <code className="text-slate-300">AI_*</code> из{' '}
        <code className="text-slate-300">.env</code>.
      </p>

      <div className="space-y-4 rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            Base URL
          </label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            Модель
          </label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
            API-ключ
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              data?.api_key_set
                ? 'ключ задан — оставьте пустым, чтобы не менять'
                : 'ключ не задан'
            }
            className="w-full rounded bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5 outline-none focus:ring-accent"
          />
          <div className="mt-1 text-[11px] text-slate-600">
            {data?.api_key_set
              ? 'Ключ сохранён. Введите новый, чтобы заменить.'
              : 'Ключ не задан — AI-функции недоступны.'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            onClick={runTest}
            disabled={testBusy}
            className="rounded-lg bg-bg-panel px-3 py-2 text-sm text-slate-300 ring-1 ring-white/5 hover:text-accent disabled:opacity-50"
          >
            {testBusy ? 'Проверяем…' : 'Проверить подключение'}
          </button>
          {dirty && (
            <span className="text-xs text-amber-400">
              есть несохранённые изменения
            </span>
          )}
          {savedOk && !dirty && (
            <span className="text-xs text-emerald-400">сохранено</span>
          )}
        </div>

        {error && <div className="text-sm text-rose-400">{error}</div>}

        {test && (
          <div
            className={
              'rounded-lg px-3 py-2 text-sm ring-1 ' +
              (test.ok
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-rose-500/10 text-rose-300 ring-rose-500/30')
            }
          >
            <div className="font-medium">
              {test.ok
                ? `✓ Подключение работает (${test.model})`
                : '✗ Не удалось подключиться'}
            </div>
            {test.reason && (
              <div className="mt-1 text-xs opacity-80">{test.reason}</div>
            )}
            <div className="mt-1 text-xs opacity-50">
              проверено: {new Date(test.checked_at).toLocaleString('ru-RU')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
