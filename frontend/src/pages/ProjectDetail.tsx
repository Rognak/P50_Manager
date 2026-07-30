import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Project, PullRequestPublic, api } from '../api/client'
import { CodeBuddyErrorBanner } from '../components/CodeBuddyErrorBanner'

const STATE_TONE: Record<string, string> = {
  merged: 'bg-emerald-500/15 text-emerald-300',
  open: 'bg-amber-500/15 text-amber-300',
  closed: 'bg-slate-500/15 text-slate-400',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
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

/**
 * Карточка отдельного репозитория. Видна как drill-down с карточки продукта.
 * Содержит только информацию про этот репо: dev-метрики и список PR-ов.
 *
 * Состав команды, тех.стек, ротации, AI-извлечённые компетенции — всё
 * это переехало на /products/:id и здесь не отображается.
 */
export function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const projectId = Number(id)

  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prs, setPrs] = useState<PullRequestPublic[] | null>(null)
  const [prError, setPrError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const p = await api.projects.get(projectId)
      setProject(p)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [projectId])

  useEffect(() => {
    refresh()
    api.projects
      .pullRequests(projectId, { limit: 100 })
      .then(setPrs)
      .catch((e) => setPrError((e as Error).message))
  }, [projectId, refresh])

  if (error)
    return <div className="text-sm text-red-400">Ошибка: {error}</div>
  if (!project) return <div className="text-slate-500">Загрузка…</div>

  // Tiles считаем из PR-списка (CodeBuddy не отдаёт snapshot per-repo).
  const stats = (() => {
    if (!prs) return null
    let totalAdd = 0
    let totalDel = 0
    let qualitySum = 0
    let qualityN = 0
    let merged = 0
    let open = 0
    for (const p of prs) {
      totalAdd += p.additions
      totalDel += p.deletions
      qualitySum += p.quality_ratio
      qualityN += 1
      if (p.state === 'merged') merged += 1
      else if (p.state === 'open') open += 1
    }
    return {
      total: prs.length,
      lines_added: totalAdd,
      lines_removed: totalDel,
      avg_quality: qualityN ? qualitySum / qualityN : 0,
      merged,
      open,
    }
  })()

  return (
    <div className="space-y-8">
      <div>
        {project.product_id ? (
          <button
            onClick={() => navigate(`/products/${project.product_id}`)}
            className="mb-4 text-sm text-slate-400 hover:text-slate-200"
          >
            ← К продукту
          </button>
        ) : (
          <button
            onClick={() => navigate('/products')}
            className="mb-4 text-sm text-slate-400 hover:text-slate-200"
          >
            ← Продукты
          </button>
        )}

        <h1 className="text-2xl font-semibold">
          {project.name}
          {project.code && (
            <span className="ml-3 text-base font-normal text-slate-500">
              {project.code}
            </span>
          )}
        </h1>
        {project.gitlab_group && (
          <div className="mt-1 text-xs text-slate-500">
            📁 GitLab-группа:{' '}
            <span className="font-mono text-slate-300">
              {project.gitlab_group}
            </span>
            {project.gitlab_project_id && (
              <span className="ml-3 text-slate-600">
                · project_id:{' '}
                <span className="font-mono">{project.gitlab_project_id}</span>
              </span>
            )}
          </div>
        )}
        <p className="mt-2 max-w-3xl text-xs text-slate-500">
          Это карточка <span className="text-slate-300">отдельного репозитория</span>.
          Команда, тех.стек, ротации и AI-извлечённые компетенции находятся на
          уровне продукта.
        </p>
      </div>

      {/* tiles */}
      {stats && (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Tile
            label="PR-ов за 90 дней"
            value={stats.total}
            hint={`${stats.merged} merged · ${stats.open} open`}
          />
          <Tile
            label="Средний quality"
            value={
              stats.total
                ? `${Math.round(stats.avg_quality * 100)}%`
                : '—'
            }
          />
          <Tile
            label="Строк добавлено"
            value={`+${stats.lines_added.toLocaleString('ru-RU')}`}
            hint={`−${stats.lines_removed.toLocaleString('ru-RU')}`}
          />
          <Tile
            label="С тестами"
            value={
              prs
                ? `${prs.filter((p) => p.signals?.has_tests).length} / ${prs.length}`
                : '—'
            }
            hint="по сигналу has_tests"
          />
        </section>
      )}

      {/* PR list */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          PR-ы репозитория
        </h2>
        {prError ? (
          <CodeBuddyErrorBanner error={prError} />
        ) : !prs ? (
          <div className="text-slate-500">Загрузка…</div>
        ) : prs.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            За последние 90 дней нет PR-ов в этом репозитории.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2 text-center">Размер</th>
                  <th className="px-3 py-2 text-center">+ / −</th>
                  <th className="px-3 py-2 text-center">Итераций</th>
                  <th className="px-3 py-2 text-center">Quality</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Создан</th>
                </tr>
              </thead>
              <tbody>
                {prs.map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="px-3 py-2">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-1 max-w-md hover:text-accent"
                          title={p.title}
                        >
                          {p.title}
                        </a>
                      ) : (
                        <span className="line-clamp-1 max-w-md" title={p.title}>
                          {p.title}
                        </span>
                      )}
                      <div className="text-[10px] text-slate-500">
                        {p.url ? (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-accent"
                          >
                            !{p.external_id}
                          </a>
                        ) : (
                          <>!{p.external_id}</>
                        )}
                      </div>
                      {p.feature_keys && p.feature_keys.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.feature_keys.slice(0, 5).map((fk) => (
                            <span
                              key={fk}
                              className="rounded bg-bg-panel/60 px-1 py-0.5 text-[9px] font-mono text-slate-400 ring-1 ring-white/5"
                            >
                              {fk}
                            </span>
                          ))}
                          {p.feature_keys.length > 5 && (
                            <span className="text-[9px] text-slate-600">
                              +{p.feature_keys.length - 5}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">
                      {p.size_bucket}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-slate-400">
                      <span className="text-emerald-400">+{p.additions}</span>
                      {' / '}
                      <span className="text-rose-400">−{p.deletions}</span>
                    </td>
                    <td className="px-3 py-2 text-center">{p.iterations}</td>
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
                    <td className="px-3 py-2">
                      <span
                        className={
                          'rounded px-2 py-0.5 ' +
                          (STATE_TONE[p.state] ||
                            'bg-slate-500/15 text-slate-400')
                        }
                      >
                        {p.state}
                      </span>
                    </td>
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
    </div>
  )
}
