import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  DeveloperPerformance,
  PerformanceReview,
  ProductPerformanceResponse,
  ProductReviewResult,
  ProductTrends,
  TrendBucket,
  api,
} from '../../api/client'
import { InfoHint } from '../InfoHint'

const HEALTH_TONE: Record<string, string> = {
  healthy: 'text-emerald-400',
  attention: 'text-amber-400',
  critical: 'text-rose-400',
}
const HEALTH_LABEL: Record<string, string> = {
  healthy: 'здоровый',
  attention: 'требует внимания',
  critical: 'критично',
}
// Спокойный стиль: нейтральный фон + тонкая цветная полоса слева по severity.
const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-l-rose-500/70',
  warning: 'border-l-amber-500/60',
  info: 'border-l-slate-500/50',
}
const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-slate-500',
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

const QUALITY_HELP =
  'Quality — оценка качества PR от CodeBuddy (qualityScore, 0–100%). ' +
  'Композит из: соблюдение conventional commits, наличие описания PR, ' +
  'размер PR (мелкие проще ревьюить → выше). Здесь показано среднее по PR.'

/** Дельта-бейдж: ↑ зелёный / ↓ розовый. positiveGood=false инвертирует. */
function Delta({
  value,
  positiveGood = true,
  suffix = '',
  asPercent = false,
}: {
  value: number | null | undefined
  positiveGood?: boolean
  suffix?: string
  asPercent?: boolean
}) {
  if (value === null || value === undefined || value === 0) return null
  const good = positiveGood ? value > 0 : value < 0
  const shown = asPercent
    ? `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`
    : `${value > 0 ? '+' : ''}${value}${suffix}`
  return (
    <span
      className={
        'ml-1 text-[11px] ' + (good ? 'text-emerald-400' : 'text-rose-400')
      }
    >
      {value > 0 ? '↑' : '↓'} {shown}
    </span>
  )
}

function HealthTile({
  label,
  value,
  hint,
  delta,
}: {
  label: React.ReactNode
  value: string | number
  hint?: React.ReactNode
  delta?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-accent">
        {value}
        {delta}
      </div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

/** Горизонтальный мини-бар разбивки composite-score. */
function ScoreBreakdownBar({ d }: { d: DeveloperPerformance }) {
  const b = d.breakdown
  const parts = [
    { label: 'quality', v: b.quality, w: 0.35, color: 'bg-emerald-500/70' },
    { label: 'tests', v: b.tests, w: 0.2, color: 'bg-sky-500/70' },
    { label: 'review', v: b.review, w: 0.15, color: 'bg-violet-500/70' },
    { label: 'low-rework', v: b.low_rework, w: 0.15, color: 'bg-amber-500/70' },
    { label: 'volume', v: b.volume, w: 0.15, color: 'bg-slate-400/70' },
  ]
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-panel">
      {parts.map((p) => (
        <div
          key={p.label}
          className={p.color}
          style={{ width: `${p.v * p.w * 100}%` }}
          title={`${p.label}: ${Math.round(p.v * 100)}% (вес ${Math.round(p.w * 100)}%)`}
        />
      ))}
    </div>
  )
}

const SCORE_AXES: {
  key: keyof DeveloperPerformance['breakdown']
  label: string
  weight: number
  color: string
}[] = [
  { key: 'quality', label: 'quality', weight: 0.35, color: 'bg-emerald-500/70' },
  { key: 'tests', label: 'тесты', weight: 0.2, color: 'bg-sky-500/70' },
  { key: 'review', label: 'review', weight: 0.15, color: 'bg-violet-500/70' },
  {
    key: 'low_rework',
    label: 'low-rework',
    weight: 0.15,
    color: 'bg-amber-500/70',
  },
  { key: 'volume', label: 'объём', weight: 0.15, color: 'bg-slate-400/70' },
]

const AXIS_HEX: Record<string, string> = {
  quality: '#34d399',
  tests: '#38bdf8',
  review: '#a78bfa',
  low_rework: '#fbbf24',
  volume: '#94a3b8',
}

function DevDetail({
  d,
  onProfile,
}: {
  d: DeveloperPerformance
  onProfile: () => void
}) {
  // Вклад каждой оси в итоговый score: value × weight × 100.
  const axes = SCORE_AXES.map((ax) => {
    const v = d.breakdown[ax.key]
    return {
      ...ax,
      v,
      contribution: v * ax.weight * 100,
      maxContribution: ax.weight * 100,
    }
  })

  return (
    <div className="space-y-4 bg-bg-panel/30 px-4 py-4">
      {/* разбивка score — единый stacked-бар вклада */}
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          Из чего сложился score {d.composite_score} / 100
        </div>
        <div className="flex h-4 w-full overflow-hidden rounded-md bg-bg-panel">
          {axes.map((ax) => (
            <div
              key={ax.key}
              style={{
                width: `${ax.contribution}%`,
                backgroundColor: AXIS_HEX[ax.key],
              }}
              title={`${ax.label}: +${ax.contribution.toFixed(1)}`}
            />
          ))}
        </div>
        {/* таблица осей — формула «значение × вес = вклад» */}
        <table className="mt-2 w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-600">
              <th className="py-1 text-left font-normal">Ось</th>
              <th className="py-1 text-right font-normal">Значение</th>
              <th className="py-1 text-center font-normal"></th>
              <th className="py-1 text-right font-normal">Вес оси</th>
              <th className="py-1 text-center font-normal"></th>
              <th className="py-1 text-right font-normal">Вклад в score</th>
            </tr>
          </thead>
          <tbody>
            {axes.map((ax) => (
              <tr key={ax.key} className="border-t border-white/5">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: AXIS_HEX[ax.key] }}
                    />
                    <span className="text-slate-300">{ax.label}</span>
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono text-slate-300">
                  {Math.round(ax.v * 100)}%
                </td>
                <td className="py-1.5 text-center font-mono text-slate-600">
                  ×
                </td>
                <td className="py-1.5 text-right font-mono text-slate-500">
                  {Math.round(ax.weight * 100)}%
                </td>
                <td className="py-1.5 text-center font-mono text-slate-600">
                  =
                </td>
                <td className="py-1.5 text-right font-mono font-semibold text-slate-200">
                  +{ax.contribution.toFixed(1)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-white/10">
              <td className="py-1.5 font-medium text-slate-300" colSpan={5}>
                Итого (сумма вкладов)
              </td>
              <td className="py-1.5 text-right font-mono font-semibold text-accent">
                {d.composite_score}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
          <div>
            <span className="font-mono text-slate-400">вклад</span> = значение
            оси × её вес. Например quality:{' '}
            <span className="font-mono">
              {Math.round(axes[0].v * 100)}% × {Math.round(axes[0].weight * 100)}
              % = {axes[0].contribution.toFixed(1)}
            </span>
            .
          </div>
          <div>
            <span style={{ color: AXIS_HEX.quality }}>quality</span> — средний
            quality PR;{' '}
            <span style={{ color: AXIS_HEX.tests }}>тесты</span> — доля PR с
            тестами;{' '}
            <span style={{ color: AXIS_HEX.review }}>review</span> — активность
            в code-review (норм. к лучшему в команде);{' '}
            <span style={{ color: AXIS_HEX.low_rework }}>low-rework</span> —
            1 − доля PR с переделками;{' '}
            <span style={{ color: AXIS_HEX.volume }}>объём</span> — число PR
            (норм. к самому активному).
          </div>
        </div>
      </div>

      {/* доп. метрики */}
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          Подробные метрики за период
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-[12px] sm:grid-cols-2">
          <Metric
            label="PR merged / open / closed"
            value={`${d.prs_merged} / ${d.prs_open} / ${d.prs_closed}`}
          />
          <Metric label="С описанием" value={pct(d.description_pct)} />
          <Metric label="Переделки (rework)" value={pct(d.rework_pct)} />
          <Metric
            label="Среднее time-to-merge"
            value={d.avg_ttm_hours !== null ? `${d.avg_ttm_hours} ч` : '—'}
          />
          <Metric
            label="Строк добавлено / удалено"
            value={`+${d.lines_added.toLocaleString('ru-RU')} / −${d.lines_removed.toLocaleString('ru-RU')}`}
          />
          <Metric
            label="Комментарии: дал / получил / от AI"
            value={`${d.comments_written} / ${d.comments_received} / ${d.ai_comments_received}`}
          />
        </div>
      </div>

      <button
        onClick={onProfile}
        className="text-[12px] text-accent hover:underline"
      >
        → полный профиль сотрудника
      </button>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 pb-1">
      <span className="text-slate-500">{label}</span>
      <span className="shrink-0 font-mono text-slate-300">{value}</span>
    </div>
  )
}

function DeveloperRow({
  d,
  rank,
  onProfile,
}: {
  d: DeveloperPerformance
  rank: number
  onProfile: () => void
}) {
  const [open, setOpen] = useState(false)
  const scoreTone =
    d.composite_score >= 60
      ? 'text-emerald-400'
      : d.composite_score >= 35
        ? 'text-amber-400'
        : 'text-rose-400'
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-t border-white/5 hover:bg-bg-panel/40"
      >
        <td className="px-3 py-2.5 text-center text-slate-500">
          {open ? '▾' : rank}
        </td>
        <td className="px-3 py-2.5">
          <div className="font-medium text-slate-200">{d.full_name}</div>
          <div className="text-[11px] text-slate-500">
            {d.role_name || '—'} {d.grade_code || ''}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-baseline gap-1">
            <span className={'font-mono text-lg font-semibold ' + scoreTone}>
              {d.composite_score}
            </span>
            <Delta value={d.score_delta} />
          </div>
          <div className="mt-1 w-32">
            <ScoreBreakdownBar d={d} />
          </div>
        </td>
        <td className="px-3 py-2.5 text-center">
          <span className="font-mono">{d.mr_count}</span>
          <Delta value={d.mr_count_delta} />
          <div className="text-[10px] text-slate-500">
            {d.prs_merged}m · {d.prs_open}o
          </div>
        </td>
        <td className="px-3 py-2.5 text-center">
          <span
            className={
              d.avg_quality >= 0.7
                ? 'text-emerald-400'
                : d.avg_quality >= 0.5
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }
          >
            {pct(d.avg_quality)}
          </span>
          <Delta value={d.quality_delta} asPercent />
        </td>
        <td className="px-3 py-2.5 text-center text-slate-400">
          {pct(d.tests_pct)}
        </td>
        <td className="px-3 py-2.5 text-center text-slate-400">
          {d.avg_iterations.toFixed(1)}
        </td>
        <td className="px-3 py-2.5 text-center text-slate-400">
          <span className="text-emerald-400/80">{d.comments_written}</span>
          <span className="text-slate-600"> дал · </span>
          <span className="text-sky-400/80">{d.comments_received}</span>
          <span className="text-slate-600"> получ.</span>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-white/5">
          <td colSpan={7} className="p-0">
            <DevDetail d={d} onProfile={onProfile} />
          </td>
        </tr>
      )}
    </>
  )
}

// Тон риска по severity — рамка слева, точка, подпись.
const RISK_TONE: Record<
  string,
  { border: string; dot: string; label: string }
> = {
  critical: {
    border: 'border-l-rose-500/70',
    dot: 'bg-rose-400',
    label: 'критично',
  },
  warning: {
    border: 'border-l-amber-500/60',
    dot: 'bg-amber-400',
    label: 'внимание',
  },
  info: {
    border: 'border-l-slate-500/50',
    dot: 'bg-slate-500',
    label: 'к сведению',
  },
}

/** Структурированный AI-разбор: summary, вердикт, топ, риски, действия. */
function AiReviewResult({ r }: { r: ProductReviewResult }) {
  const sevOrder: Record<string, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  const risks = [...r.risks].sort(
    (a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9),
  )

  return (
    <div className="mt-4 space-y-4">
      {/* общая оценка + вердикт по здоровью */}
      <div className="rounded-xl bg-bg-panel/60 p-4 ring-1 ring-white/5">
        <div className="text-[13px] leading-relaxed text-slate-200">
          {r.summary}
        </div>
        {r.health_verdict && (
          <div className="mt-2.5 flex items-baseline gap-2 border-t border-white/5 pt-2.5 text-[12px]">
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
              Здоровье
            </span>
            <span className="text-slate-300">{r.health_verdict}</span>
          </div>
        )}
      </div>

      {/* сильные исполнители */}
      {r.top_performers.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            Сильные исполнители
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {r.top_performers.map((p, i) => (
              <div
                key={i}
                className="rounded-lg bg-bg-panel/50 p-3 ring-1 ring-emerald-500/15"
              >
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-100">
                  <span className="text-emerald-400">★</span>
                  {p.name}
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-slate-400">
                  {p.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* зоны риска */}
      {risks.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            Зоны риска
          </div>
          <div className="space-y-1.5">
            {risks.map((rk, i) => {
              const tone = RISK_TONE[rk.severity] || RISK_TONE.info
              return (
                <div
                  key={i}
                  className={
                    'flex items-baseline gap-2.5 rounded-lg border-l-2 bg-bg-panel/50 px-3 py-2 ring-1 ring-white/5 ' +
                    tone.border
                  }
                >
                  <span
                    className={
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full ' + tone.dot
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-medium text-slate-200">
                        {rk.name || 'Уровень продукта'}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-600">
                        {tone.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] leading-relaxed text-slate-400">
                      {rk.text}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* рекомендованные действия */}
      {r.actions.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            Что делать (по приоритету)
          </div>
          <ol className="space-y-1.5">
            {r.actions.map((a, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-lg bg-bg-panel/50 px-3 py-2 ring-1 ring-white/5"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-slate-200">
                    {a.title}
                  </div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-slate-400">
                    {a.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function AiReviewBlock({ productId }: { productId: number }) {
  const [review, setReview] = useState<PerformanceReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    api.products
      .performanceReview(productId)
      .then((r) => {
        setReview(r)
        if (r && (r.status === 'queued' || r.status === 'running')) {
          startPoll()
        }
      })
      .catch(() => undefined)
    return stopPoll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  const startPoll = () => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.products.performanceReview(productId)
        setReview(r)
        if (r && (r.status === 'done' || r.status === 'error')) {
          stopPoll()
        }
      } catch {
        stopPoll()
      }
    }, 3000)
  }

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.products.createPerformanceReview(productId)
      setReview(r)
      startPoll()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const inProgress =
    review?.status === 'queued' || review?.status === 'running'

  return (
    <section className="rounded-2xl bg-bg-elevated p-5 ring-1 ring-white/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            ⚡ AI-разбор performance
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            LLM анализирует здоровье, рейтинг и сигналы — даёт связный обзор
            и рекомендации руководителю.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={busy || inProgress}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {busy || inProgress
            ? 'Генерация…'
            : review
              ? 'Перегенерировать'
              : 'AI-разбор'}
        </button>
      </div>
      {error && (
        <div className="mt-3 text-sm text-rose-400">{error}</div>
      )}
      {review?.status === 'error' && (
        <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30">
          Ошибка генерации: {review.error}
        </div>
      )}
      {inProgress && (
        <div className="mt-3 text-sm text-slate-500">
          AI анализирует данные продукта… (обычно 10–30 сек)
        </div>
      )}
      {review?.status === 'done' && review.content_json && (
        <div>
          <AiReviewResult r={review.content_json} />
          <div className="mt-3 text-[11px] text-slate-600">
            {review.model} ·{' '}
            {new Date(review.created_at).toLocaleString('ru-RU')}
            {review.period_from && review.period_to && (
              <> · период {review.period_from} — {review.period_to}</>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

const MONTHS_RU = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
]

function monthLabel(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS_RU[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/** Интерактивный line-chart по окнам с hover-тултипом и подписями. */
function TrendCard({
  title,
  buckets,
  value,
  color,
  picker,
  goodWhenUp = true,
}: {
  title: string
  buckets: TrendBucket[]
  value: (b: TrendBucket) => number | null
  color: string
  picker: (v: number) => string
  goodWhenUp?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const series = buckets.map(value)
  const last = [...series].reverse().find((v) => v !== null)
  const firstIdx = series.findIndex((v) => v !== null)
  const first = firstIdx >= 0 ? series[firstIdx] : null
  const trend =
    last !== undefined && last !== null && first !== null
      ? last - first
      : null

  const W = 240
  const H = 88
  const padX = 10
  const padY = 14
  const nums = series.filter((v): v is number => v !== null)
  const max = nums.length ? Math.max(...nums) : 1
  const min = nums.length ? Math.min(...nums, 0) : 0
  const span = max - min || 1
  const stepX =
    series.length > 1 ? (W - 2 * padX) / (series.length - 1) : 0
  const pts = series.map((v, i) => {
    if (v === null) return null
    const x = padX + i * stepX
    const y = padY + (1 - (v - min) / span) * (H - 2 * padY)
    return { x, y, v, i }
  })
  // непрерывные сегменты линии (разрыв на null)
  const segs: string[] = []
  let cur: string[] = []
  for (const p of pts) {
    if (p === null) {
      if (cur.length) segs.push(cur.join(' '))
      cur = []
    } else cur.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  }
  if (cur.length) segs.push(cur.join(' '))

  const hp = hover !== null ? pts[hover] : null

  return (
    <div className="relative rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500">{title}</span>
        <span className="text-sm font-semibold text-slate-200">
          {last !== undefined && last !== null ? picker(last) : '—'}
          {trend !== null && trend !== 0 && (
            <span
              className={
                'ml-1 text-[11px] ' +
                ((trend > 0) === goodWhenUp
                  ? 'text-emerald-400'
                  : 'text-rose-400')
              }
            >
              {trend > 0 ? '↑' : '↓'}{' '}
              {picker(Math.abs(trend))}
            </span>
          )}
        </span>
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {/* нижняя ось */}
          <line
            x1={padX}
            y1={H - padY}
            x2={W - padX}
            y2={H - padY}
            stroke="currentColor"
            className="text-white/5"
            strokeWidth={1}
          />
          {segs.map((s, i) => (
            <polyline
              key={i}
              points={s}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hp && (
            <line
              x1={hp.x}
              y1={padY}
              x2={hp.x}
              y2={H - padY}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.5}
            />
          )}
          {/* подпись значения над каждой точкой */}
          {pts.map((p) =>
            p ? (
              <text
                key={`t${p.i}`}
                x={p.x}
                y={Math.max(p.y - 6, 9)}
                textAnchor="middle"
                className="fill-slate-400"
                style={{ fontSize: '9px' }}
              >
                {picker(p.v)}
              </text>
            ) : null,
          )}
          {pts.map((p) =>
            p ? (
              <circle
                key={p.i}
                cx={p.x}
                cy={p.y}
                r={hover === p.i ? 4 : 2.8}
                fill={color}
              />
            ) : null,
          )}
          {/* увеличенная прозрачная hit-зона для hover */}
          {pts.map((p) =>
            p ? (
              <rect
                key={`h${p.i}`}
                x={p.x - stepX / 2}
                y={0}
                width={stepX || W}
                height={H}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHover(p.i)}
                onMouseLeave={() => setHover(null)}
              />
            ) : null,
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-bg-panel px-2 py-1 text-[11px] text-slate-200 shadow-lg ring-1 ring-white/10"
            style={{
              left: `${(hp.x / W) * 100}%`,
              top: 0,
            }}
          >
            <div className="font-semibold">{picker(hp.v)}</div>
            <div className="text-[10px] text-slate-500">
              {monthLabel(buckets[hp.i].period_to)}
            </div>
          </div>
        )}
      </div>
      {/* подписи окон */}
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{monthLabel(buckets[0].period_to)}</span>
        <span>{monthLabel(buckets[buckets.length - 1].period_to)}</span>
      </div>
    </div>
  )
}

function TrendsBlock({ productId }: { productId: number }) {
  const [trends, setTrends] = useState<ProductTrends | null>(null)

  useEffect(() => {
    let cancelled = false
    api.products
      .performanceTrends(productId, 6, 30)
      .then((r) => {
        if (!cancelled) setTrends(r)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [productId])

  if (!trends || !trends.enabled || trends.buckets.length === 0) return null
  const b = trends.buckets
  const span = `${b[0].period_from} — ${b[b.length - 1].period_to}`

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Динамика ({trends.bucket_days}-дневные окна)
      </h3>
      <div className="mb-3 text-[11px] text-slate-600">{span}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TrendCard
          title="PR-ов за окно"
          buckets={b}
          value={(x) => x.total_prs}
          color="#38bdf8"
          picker={(v) => String(Math.round(v))}
        />
        <TrendCard
          title="Merged за окно"
          buckets={b}
          value={(x) => x.prs_merged}
          color="#34d399"
          picker={(v) => String(Math.round(v))}
        />
        <TrendCard
          title="Средний quality"
          buckets={b}
          value={(x) => x.avg_quality}
          color="#fbbf24"
          picker={(v) => `${Math.round(v * 100)}%`}
        />
        <TrendCard
          title="Зависшие PR"
          buckets={b}
          value={(x) => x.stale_open_count}
          color="#fb7185"
          picker={(v) => String(Math.round(v))}
          goodWhenUp={false}
        />
      </div>
    </section>
  )
}

function SignalRow({
  signal,
  onEmployee,
}: {
  signal: import('../../api/client').PerfSignal
  onEmployee: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const hasEvidence = signal.evidence.length > 0
  return (
    <div
      className={
        'rounded-lg border-l-2 bg-bg-elevated text-sm text-slate-300 ring-1 ring-white/5 ' +
        (SEVERITY_BORDER[signal.severity] || 'border-l-slate-600')
      }
    >
      <button
        onClick={() => hasEvidence && setOpen((v) => !v)}
        disabled={!hasEvidence}
        className={
          'flex w-full items-baseline gap-2.5 px-3 py-2 text-left ' +
          (hasEvidence
            ? 'cursor-pointer hover:bg-bg-panel/40'
            : 'cursor-default')
        }
      >
        <span
          className={
            'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
            (SEVERITY_DOT[signal.severity] || 'bg-slate-600')
          }
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-200">{signal.title}</div>
          <div className="text-[12px] text-slate-500">{signal.detail}</div>
        </div>
        {hasEvidence && (
          <span className="shrink-0 text-[11px] text-slate-600">
            {signal.evidence.length} {open ? '▴' : '▾'}
          </span>
        )}
      </button>
      {open && hasEvidence && (
        <ul className="space-y-1 border-t border-white/5 px-3 py-2">
          {signal.evidence.map((ev, j) => (
            <li
              key={j}
              className="flex items-baseline gap-2 text-[12px]"
            >
              <span className="shrink-0 text-slate-700">•</span>
              {ev.url ? (
                <a
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-slate-300 hover:text-accent hover:underline"
                  title={ev.label}
                >
                  {ev.label}
                </a>
              ) : (
                <span
                  className="min-w-0 flex-1 truncate text-slate-300"
                  title={ev.label}
                >
                  {ev.label}
                </span>
              )}
              {ev.detail && (
                <span className="shrink-0 text-[11px] text-slate-500">
                  {ev.detail}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {signal.employee_id && (
        <div className="border-t border-white/5 px-3 py-1.5">
          <button
            onClick={() => onEmployee(signal.employee_id!)}
            className="text-[11px] text-slate-500 hover:text-accent hover:underline"
          >
            → открыть профиль {signal.employee_name}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Период (`periodDays`) — controlled-проп: единый фильтр периода на странице
 * продукта управляет и performance, и списком PR, и компетенциями. Своего
 * селектора у панели больше нет.
 */
export function PerformancePanel({
  productId,
  periodDays,
}: {
  productId: number
  periodDays: number
}) {
  const navigate = useNavigate()
  const [data, setData] = useState<ProductPerformanceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.products
      .performance(productId, periodDays)
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, periodDays])

  if (loading && !data)
    return <div className="text-slate-500">Считаем performance…</div>
  if (error)
    return (
      <div className="rounded-2xl bg-rose-500/10 px-5 py-4 text-sm text-rose-200 ring-1 ring-rose-500/30">
        {error}
      </div>
    )
  if (!data) return null

  if (!data.enabled) {
    return (
      <div className="rounded-2xl bg-bg-elevated px-5 py-4 text-sm text-slate-400">
        Интеграция CodeBuddy выключена — performance-аналитика недоступна.
        Включите её в админ-панели (раздел «Интеграции»).
      </div>
    )
  }

  const h = data.health

  return (
    <div className="space-y-6">
      <div className="text-xs text-slate-500">
        {data.period_from} — {data.period_to} · сравнение с предыдущим
        окном такой же длины
      </div>

      {/* health */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Здоровье продукта
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-bg-elevated p-4 ring-1 ring-white/5">
            <div className="text-xs text-slate-500">Статус</div>
            <div
              className={
                'mt-1 text-2xl font-semibold ' +
                (HEALTH_TONE[h.health_status] || 'text-slate-400')
              }
            >
              {HEALTH_LABEL[h.health_status] || h.health_status}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              health-score {h.health_score} / 100
            </div>
          </div>
          <HealthTile
            label="PR-ов за период"
            value={h.total_prs}
            delta={<Delta value={h.total_prs_delta} />}
            hint={`${h.prs_merged} merged · ${h.prs_open} open · ${h.prs_closed} closed`}
          />
          <HealthTile
            label={
              <>
                Средний quality <InfoHint text={QUALITY_HELP} />
              </>
            }
            value={pct(h.avg_quality)}
            delta={<Delta value={h.avg_quality_delta} asPercent />}
            hint={`с тестами: ${pct(h.with_tests_pct)}`}
          />
          <HealthTile
            label="WIP / зависших"
            value={`${h.wip_count} / ${h.stale_count}`}
            hint={
              h.avg_ttm_hours !== null
                ? `time-to-merge ${h.avg_ttm_hours} ч`
                : undefined
            }
          />
          <HealthTile
            label="Дефицит компетенций"
            value={h.coverage_gap}
            hint="суммарный гэп ★-компетенций"
          />
          <HealthTile
            label="Bus-factor"
            value={h.bus_factor_count}
            hint="уникальных носителей ★-компетенций"
          />
          <HealthTile
            label="Активны"
            value={`${h.active_developers} / ${h.team_size}`}
            hint={
              h.workload_top_share !== null
                ? `топ-вклад: ${Math.round(h.workload_top_share * 100)}% PR`
                : undefined
            }
          />
          <HealthTile
            label="Ревьюеров"
            value={`${h.reviewers_count} / ${h.team_size}`}
            hint="пишут code-review"
          />
        </div>
      </section>

      {/* тренды */}
      <TrendsBlock productId={productId} />

      {/* signals */}
      {data.signals.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Сигналы для внимания ({data.signals.length})
          </h3>
          <div className="space-y-1.5">
            {data.signals.map((s, i) => (
              <SignalRow
                key={i}
                signal={s}
                onEmployee={(id) => navigate(`/employees/${id}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* AI-разбор */}
      <AiReviewBlock productId={productId} />

      {/* рейтинг разработчиков */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Рейтинг разработчиков
        </h3>
        {data.developers.length === 0 ? (
          <div className="rounded-2xl bg-bg-elevated px-6 py-6 text-center text-sm text-slate-500">
            Нет данных по разработчикам за период.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-bg-elevated">
            <table className="w-full text-left text-sm">
              <thead className="bg-bg-panel text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-center">#</th>
                  <th className="px-3 py-2">Разработчик</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2 text-center">PR-ов</th>
                  <th className="px-3 py-2 text-center">
                    Quality <InfoHint text={QUALITY_HELP} />
                  </th>
                  <th className="px-3 py-2 text-center">Тесты</th>
                  <th className="px-3 py-2 text-center">Итер.</th>
                  <th className="px-3 py-2 text-center">
                    Ревью{' '}
                    <InfoHint
                      text={
                        'Code-review активность. Слева — сколько комментариев ' +
                        'сотрудник написал к чужим PR (дал ревью). Справа — ' +
                        'сколько комментариев получил к своим PR.'
                      }
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.developers.map((d, i) => (
                  <DeveloperRow
                    key={d.employee_id}
                    d={d}
                    rank={i + 1}
                    onProfile={() => navigate(`/employees/${d.employee_id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 text-[11px] text-slate-600">
          Score = quality·35% + тесты·20% + review·15% + low-rework·15% +
          объём·15%. Наведите на полоску разбивки, чтобы увидеть вклад каждой
          оси.
        </div>
      </section>
    </div>
  )
}
