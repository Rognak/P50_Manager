import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  Competency,
  ProjectListItem,
  TechnologyCompetencyLink,
  TechnologyNewsItem,
  TechnologyNewsSource,
  TechnologyPackageMapping,
  TechnologySecuritySummary,
  api,
} from '../../api/client'
import { statusClass } from '../../lib/ui-variants'

type Tab = 'security' | 'news'

function vulnerabilityTone(severity: string) {
  const value = severity.toLowerCase()
  if (value === 'critical' || value === 'high') return statusClass('danger', 'uppercase')
  if (value === 'medium') return statusClass('warning', 'uppercase')
  return statusClass('neutral', 'uppercase')
}

export function TechnologyCompetenciesSection({ technologyId, isAdmin }: { technologyId: number; isAdmin: boolean }) {
  const [competencies, setCompetencies] = useState<TechnologyCompetencyLink[]>([])
  const [competencyCatalog, setCompetencyCatalog] = useState<Competency[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
        api.technologies.competencies.list(technologyId),
        api.mpk.competencies(),
      ])
      .then(([linked, catalog]) => {
      setCompetencies(linked)
      setCompetencyCatalog(catalog)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [technologyId])

  const saveCompetencies = async (items: TechnologyCompetencyLink[]) => {
    const result = await api.technologies.competencies.set(technologyId, items.map((item) => ({
      competency_id: item.competency_id,
      weight: item.weight,
      notes: item.notes,
    })))
    setCompetencies(result)
  }

  return <section>
    <h2 className="mb-3 font-semibold">Связанные компетенции</h2>
    <div className="rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
      {loading && <div className="text-sm text-slate-500">Загрузка компетенций…</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}
      {!loading && !error && <div className="space-y-4">
        {isAdmin && <CompetencyPicker catalog={competencyCatalog} linked={competencies} onAdd={(item) => saveCompetencies([...competencies, item])} />}
        {competencies.length ? <div className="flex flex-wrap gap-2">{competencies.map((item) => <span key={item.competency_id} className="flex items-center gap-2 rounded-lg bg-bg-panel px-3 py-2 text-sm">{item.competency_name}{isAdmin && <button title="Отвязать компетенцию" onClick={() => void saveCompetencies(competencies.filter((entry) => entry.competency_id !== item.competency_id))} className="ml-1 text-rose-400 hover:text-rose-300">×</button>}</span>)}</div> : <div className="text-sm text-slate-500">Связанные компетенции пока не указаны.</div>}
      </div>}
    </div>
  </section>
}

export function TechnologyIntelligencePanel({ technologyId, isAdmin }: { technologyId: number; isAdmin: boolean }) {
  const [tab, setTab] = useState<Tab>('security')
  const [security, setSecurity] = useState<TechnologySecuritySummary | null>(null)
  const [news, setNews] = useState<TechnologyNewsItem[]>([])
  const [newsSources, setNewsSources] = useState<TechnologyNewsSource[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [securitySummary, feed, sources] = await Promise.all([
        api.technologies.security(technologyId),
        api.technologies.news.list(technologyId),
        api.technologies.news.sources(technologyId),
      ])
      setSecurity(securitySummary)
      setNews(feed)
      setNewsSources(sources)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [technologyId])

  if (loading) return <div className="text-sm text-slate-500">Загрузка данных технологии…</div>
  return <section className="rounded-2xl bg-bg-elevated ring-1 ring-white/5">
    <div className="flex flex-wrap gap-1 border-b border-white/5 p-2">
      {([['security', 'Security'], ['news', 'Новости']] as [Tab, string][]).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${tab === value ? 'bg-primary-soft text-primary' : 'text-ink-secondary hover:bg-surface-subtle hover:text-ink'}`}>{label}</button>)}
    </div>
    {error && <div className="m-4 text-sm text-red-400">{error}</div>}
    {tab === 'security' && security && <SecurityPanel technologyId={technologyId} isAdmin={isAdmin} summary={security} onChange={setSecurity} />}
    {tab === 'news' && <NewsPanel technologyId={technologyId} isAdmin={isAdmin} items={news} sources={newsSources} onChange={load} />}
  </section>
}

function CompetencyPicker({ catalog, linked, onAdd }: { catalog: Competency[]; linked: TechnologyCompetencyLink[]; onAdd: (item: TechnologyCompetencyLink) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const linkedIds = new Set(linked.map((item) => item.competency_id))
  const options = catalog.filter((item) => !linkedIds.has(item.id) && (`${item.code} ${item.name}`).toLowerCase().includes(query.toLowerCase())).slice(0, 30)
  return <div className="relative max-w-2xl">
    <button onClick={() => setOpen((value) => !value)} className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent">+ Связать компетенцию</button>
    {open && <div className="absolute z-20 mt-2 w-full rounded-xl bg-bg-elevated p-3 shadow-xl ring-1 ring-white/10">
      <div className="flex gap-2"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Начните вводить название или код" className="min-w-0 flex-1 rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" /><button onClick={() => setOpen(false)} className="px-2 text-slate-400">×</button></div>
      <div className="mt-2 max-h-64 overflow-auto">{options.length ? options.map((item) => <button key={item.id} onClick={async () => { await onAdd({ competency_id: item.id, competency_name: item.name, weight: 3, notes: null }); setQuery(''); setOpen(false) }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-bg-panel"><span className="text-slate-500">{item.code}</span> {item.name}</button>) : <div className="p-3 text-sm text-slate-500">Совпадений нет.</div>}</div>
    </div>}
  </div>
}

function SecurityPanel({ technologyId, isAdmin, summary, onChange }: { technologyId: number; isAdmin: boolean; summary: TechnologySecuritySummary; onChange: (value: TechnologySecuritySummary) => void }) {
  const [packages, setPackages] = useState<TechnologyPackageMapping[]>([])
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [ecosystem, setEcosystem] = useState('PyPI')
  const [packageName, setPackageName] = useState('')
  const [mappingId, setMappingId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [version, setVersion] = useState('')
  const [query, setQuery] = useState('')
  const [product, setProduct] = useState('')
  const [project, setProject] = useState('')
  const [severity, setSeverity] = useState('')
  const [affectedOnly, setAffectedOnly] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = async () => onChange(await api.technologies.security(technologyId))
  const loadReferences = async () => {
    const [packageList, projectList] = await Promise.all([api.technologies.packages.list(technologyId), api.projects.list()])
    setPackages(packageList)
    setProjects(projectList)
    if (!mappingId && packageList[0]) setMappingId(String(packageList[0].id))
    if (!projectId && projectList[0]) setProjectId(String(projectList[0].id))
  }
  useEffect(() => { void loadReferences().catch((err: Error) => setMessage(err.message)) }, [technologyId])

  const productOptions = [...new Set(summary.evidence.map((item) => item.product_name).filter(Boolean) as string[])]
  const projectOptions = [...new Set(summary.evidence.map((item) => item.project_name))]
  const filtered = useMemo(() => summary.evidence.filter((item) => {
    const haystack = `${item.package_name} ${item.version} ${item.project_name} ${item.product_name || ''}`.toLowerCase()
    return (!query || haystack.includes(query.toLowerCase())) && (!product || item.product_name === product) && (!project || item.project_name === project) && (!severity || item.vulnerabilities.some((v) => v.affected && v.severity === severity)) && (!affectedOnly || item.vulnerabilities.some((v) => v.affected))
  }), [summary, query, product, project, severity, affectedOnly])

  const addPackage = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    try { await api.technologies.packages.add(technologyId, { ecosystem, package_name: packageName }); setPackageName(''); await loadReferences() } catch (err) { setMessage((err as Error).message) }
  }
  const addVersion = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    try { await api.technologies.versions.add(technologyId, { package_mapping_id: Number(mappingId), project_id: Number(projectId), version, source: 'manual' }); setVersion(''); await refresh() } catch (err) { setMessage((err as Error).message) }
  }
  const scan = async (evidenceId: number) => {
    setBusy(evidenceId); setMessage(null)
    try {
      const result = await api.technologies.osvScan(technologyId, evidenceId)
      const row = result.evidence.find((item) => item.id === evidenceId)
      onChange(result)
      setMessage(`OSV: проверка завершена, найдено уязвимостей: ${row?.vulnerabilities.length || 0}`)
    } catch (err) { setMessage((err as Error).message) } finally { setBusy(null) }
  }

  return <div className="space-y-5 p-5">
    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">{[['Critical', summary.critical], ['High', summary.high], ['Medium', summary.medium], ['Low', summary.low], ['KEV', summary.kev], ['Продукты', summary.affected_products]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-bg-panel p-3"><div className="text-lg font-semibold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>)}</div>
    {isAdmin && <div className="grid gap-3 rounded-xl bg-bg-panel p-4 lg:grid-cols-2">
      <form onSubmit={addPackage} className="space-y-2"><h3 className="text-sm font-medium">1. Package mapping</h3><div className="flex gap-2"><select value={ecosystem} onChange={(event) => setEcosystem(event.target.value)} className="rounded-lg bg-bg-elevated px-3 py-2 text-sm">{['PyPI', 'npm', 'NuGet', 'Maven', 'Go', 'crates.io', 'Packagist', 'RubyGems'].map((item) => <option key={item}>{item}</option>)}</select><input required value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="Имя пакета" className="min-w-0 flex-1 rounded-lg bg-bg-elevated px-3 py-2 text-sm" /><button className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent">Добавить</button></div><div className="flex flex-wrap gap-2">{packages.map((item) => <span key={item.id} className="rounded bg-bg-elevated px-2 py-1 text-xs">{item.ecosystem}: {item.package_name} <button title="Удалить mapping и его версии" onClick={async () => { if (confirm(`Удалить ${item.package_name} и все связанные версии?`)) { await api.technologies.packages.remove(technologyId, item.id); await loadReferences(); await refresh() } }} type="button" className="ml-1 text-rose-400">×</button></span>)}</div></form>
      <form onSubmit={addVersion} className="space-y-2"><h3 className="text-sm font-medium">2. Версия в репозитории</h3><div className="grid grid-cols-2 gap-2"><select required value={mappingId} onChange={(event) => setMappingId(event.target.value)} className="rounded-lg bg-bg-elevated px-3 py-2 text-sm"><option value="">Выберите пакет</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.package_name} ({item.ecosystem})</option>)}</select><select required value={projectId} onChange={(event) => setProjectId(event.target.value)} className="rounded-lg bg-bg-elevated px-3 py-2 text-sm"><option value="">Выберите репозиторий</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ''}</option>)}</select><input required value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Версия, например 0.95.0" className="rounded-lg bg-bg-elevated px-3 py-2 text-sm" /><button disabled={!packages.length || !projects.length} className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent disabled:opacity-40">Зафиксировать версию</button></div></form>
    </div>}
    {message && <div className={`text-sm ${message.startsWith('OSV:') ? 'text-success' : 'text-danger'}`}>{message}</div>}
    <div><h3 className="font-medium">Используемые версии по проектам и репозиториям</h3><div className="mt-3 grid gap-2 md:grid-cols-3 lg:grid-cols-5"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пакет, версия, проект" className="rounded-lg bg-bg-panel px-3 py-2 text-sm" /><select value={product} onChange={(event) => setProduct(event.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все продукты</option>{productOptions.map((item) => <option key={item}>{item}</option>)}</select><select value={project} onChange={(event) => setProject(event.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Все репозитории</option>{projectOptions.map((item) => <option key={item}>{item}</option>)}</select><select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg bg-bg-panel px-3 py-2 text-sm"><option value="">Любая критичность</option>{['critical', 'high', 'medium', 'low', 'unknown'].map((item) => <option key={item}>{item}</option>)}</select><label className="flex items-center gap-2 rounded-lg bg-bg-panel px-3 py-2 text-sm"><input type="checkbox" checked={affectedOnly} onChange={(event) => setAffectedOnly(event.target.checked)} /> Только с уязвимостями</label></div></div>
    {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-surface-subtle text-xs text-ink-muted"><tr><th className="p-2">Пакет / версия</th><th className="p-2">Продукт</th><th className="p-2">Репозиторий</th><th className="p-2">Источник</th><th className="p-2">Уязвимости</th><th className="p-2"></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-t border-outline-subtle"><td className="p-2"><div className="font-medium">{item.package_name}@{item.version}</div><div className="text-xs text-ink-muted">{item.ecosystem} · {new Date(item.detected_at).toLocaleDateString('ru-RU')}</div></td><td className="p-2">{item.product_name || '—'}</td><td className="p-2"><Link to={`/projects/${item.project_id}`} className="text-primary hover:text-primary-hover">{item.project_name}</Link></td><td className="p-2">{item.source}</td><td className="p-2">{item.vulnerabilities.length ? item.vulnerabilities.map((v) => <div key={v.id} className="mb-2"><span className={`mr-2 ${vulnerabilityTone(v.severity)}`}>{v.severity}</span>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="text-primary hover:text-primary-hover">{v.advisory_id}</a> : v.advisory_id}<div className="mt-1 max-w-xl text-xs text-ink-muted">{v.summary}</div></div>) : <span className="text-xs text-success">Уязвимости не найдены или OSV ещё не запускался</span>}</td><td className="p-2 text-right">{isAdmin && <div className="flex justify-end gap-3"><button disabled={busy === item.id} onClick={() => void scan(item.id)} className="text-xs text-primary disabled:text-disabled-text">{busy === item.id ? 'Проверка…' : 'Проверить OSV'}</button><button onClick={async () => { const next = prompt('Новая версия', item.version); if (next && next !== item.version) { await api.technologies.versions.update(technologyId, item.id, { version: next }); await refresh() } }} className="text-xs text-ink-secondary">Изменить</button><button onClick={async () => { if (confirm('Удалить эту версию из реестра?')) { await api.technologies.versions.remove(technologyId, item.id); await refresh() } }} className="text-xs text-danger hover:text-danger-hover">Удалить</button></div>}</td></tr>)}</tbody></table></div> : <div className="text-sm text-slate-500">По выбранным фильтрам версии не найдены. Администратор может сначала добавить package mapping, затем связать версию с репозиторием.</div>}
  </div>
}

function NewsPanel({ technologyId, isAdmin, items, sources, onChange }: { technologyId: number; isAdmin: boolean; items: TechnologyNewsItem[]; sources: TechnologyNewsSource[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [busySource, setBusySource] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const addSource = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try { await api.technologies.news.addSource(technologyId, { name, feed_url: feedUrl }); setName(''); setFeedUrl(''); await onChange() }
    catch (err) { setError((err as Error).message) }
  }
  const sync = async (sourceId: number) => {
    setBusySource(sourceId); setError(null)
    try { await api.technologies.news.fetchSource(technologyId, sourceId); await onChange() }
    catch (err) { setError((err as Error).message) }
    finally { setBusySource(null) }
  }
  const addManual = async () => {
    const title = prompt('Заголовок новости'); const url = prompt('URL новости')
    if (!title || !url) return
    const summary = prompt('Краткое описание (необязательно)')
    await api.technologies.news.add(technologyId, { title, url, source: 'Вручную', published_at: new Date().toISOString(), summary }); await onChange()
  }
  return <div className="space-y-5 p-5">
    <div><div className="mb-2 flex items-center justify-between"><div><h3 className="font-medium">Источники RSS / Atom</h3><p className="mt-0.5 text-xs text-slate-500">Например: GitHub Releases Atom feed проекта.</p></div>{isAdmin && <button onClick={addManual} className="text-sm text-accent">+ Новость вручную</button>}</div>
      {isAdmin && <form onSubmit={addSource} className="mb-3 flex flex-wrap gap-2"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Название источника" className="rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" /><input required type="url" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://github.com/org/repo/releases.atom" className="min-w-[320px] flex-1 rounded-lg bg-bg-panel px-3 py-2 text-sm ring-1 ring-white/5" /><button className="rounded-lg bg-accent/15 px-3 py-2 text-sm text-accent">Добавить источник</button></form>}
      {sources.length ? <div className="space-y-2">{sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-bg-panel p-3"><div className="min-w-0 flex-1"><div className="font-medium">{source.name}</div><div className="truncate text-xs text-slate-500">{source.feed_url}</div></div><div className="text-xs text-slate-500">{source.last_fetched_at ? `Обновлено ${new Date(source.last_fetched_at).toLocaleString('ru-RU')}` : 'Ещё не загружался'}</div>{isAdmin && <><button disabled={busySource === source.id} onClick={() => void sync(source.id)} className="rounded bg-accent/15 px-3 py-1.5 text-xs text-accent disabled:opacity-50">{busySource === source.id ? 'Загрузка…' : 'Синхронизировать'}</button><button onClick={async () => { if (confirm('Удалить источник? Загруженные новости останутся.')) { await api.technologies.news.removeSource(technologyId, source.id); await onChange() } }} className="text-xs text-rose-400">Удалить</button></>}</div>)}</div> : <div className="text-sm text-slate-500">Источники пока не настроены.</div>}
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </div>
    <div><h3 className="mb-2 font-medium">Лента</h3>{items.length ? <div className="space-y-2">{items.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="block rounded-xl bg-bg-panel p-4 hover:ring-1 hover:ring-accent/30"><div className="font-medium">{item.title} ↗</div><div className="mt-1 text-xs text-slate-500">{item.source} · {new Date(item.published_at).toLocaleDateString('ru-RU')}</div>{item.summary && <div className="mt-2 line-clamp-3 text-sm text-slate-400">{item.summary.replace(/<[^>]+>/g, ' ')}</div>}</a>)}</div> : <div className="text-sm text-slate-500">Новостей пока нет. Добавьте источник и нажмите «Синхронизировать».</div>}</div>
  </div>
}
