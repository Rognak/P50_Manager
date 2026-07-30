import { FormEvent, ReactNode, useEffect, useState } from 'react'

import { AIDifficulty, AIFormat, AIGenParams, AIGenType, api, Competency } from '../../api/client'

type Kind = 'questions' | 'tasks'

const TYPE_LABEL: Record<AIGenType, string> = {
  theoretical: 'Теоретические',
  practical: 'Практические',
  case: 'Кейсовые',
  code_review: 'Code review',
  mixed: 'Смешанные',
}

const DIFFICULTY_LABEL: Record<AIDifficulty, string> = {
  current: 'Текущий уровень сотрудника',
  target: 'Требуемый (по профилю роль/грейд)',
  above_target: 'На шаг выше требуемого',
  custom: 'Конкретный уровень',
}

const FORMAT_LABEL: Record<AIFormat, string> = {
  discussion: 'Устное обсуждение',
  code: 'Написание кода',
  diagram: 'Схема/диаграмма',
  written: 'Письменный ответ',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm text-slate-400">{label}</div>
      {children}
    </label>
  )
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Record<T, string>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
    >
      {(Object.entries(options) as [T, string][]).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  )
}

export function AiGenerateModal({
  kind,
  onClose,
  onSubmit,
}: {
  kind: Kind
  onClose: () => void
  onSubmit: (params: AIGenParams) => Promise<void>
}) {
  const [competencies, setCompetencies] = useState<Competency[] | null>(null)
  const [selectedComps, setSelectedComps] = useState<Set<number>>(new Set())

  const [count, setCount] = useState(3)
  const [type, setType] = useState<AIGenType>(kind === 'tasks' ? 'practical' : 'mixed')
  const [difficulty, setDifficulty] = useState<AIDifficulty>('target')
  const [customLevel, setCustomLevel] = useState(3)
  const [format, setFormat] = useState<AIFormat>(
    kind === 'tasks' ? 'code' : 'discussion',
  )
  const [timeBudget, setTimeBudget] = useState(kind === 'tasks' ? 30 : 15)
  const [custom, setCustom] = useState('')

  const [keyOnly, setKeyOnly] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.mpk
      .competencies()
      .then(setCompetencies)
      .catch((e) => setError((e as Error).message))
  }, [])

  const toggle = (id: number) =>
    setSelectedComps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        competency_ids: [...selectedComps],
        count,
        type,
        difficulty,
        custom_level: difficulty === 'custom' ? customLevel : null,
        format,
        time_budget_min: timeBudget,
        custom_constraints: custom.trim(),
        key_only: keyOnly,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const title = kind === 'questions' ? 'Сгенерировать вопросы' : 'Сгенерировать задания'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-bg-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Количество">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value))))}
                  className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
                />
              </Field>
              <Field label="Бюджет времени (мин)">
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={timeBudget}
                  onChange={(e) =>
                    setTimeBudget(Math.max(5, Math.min(60, Number(e.target.value))))
                  }
                  className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
                />
              </Field>
              <Field label="Тип">
                <Select value={type} onChange={setType} options={TYPE_LABEL} />
              </Field>
              <Field label="Сложность">
                <Select value={difficulty} onChange={setDifficulty} options={DIFFICULTY_LABEL} />
              </Field>
              {difficulty === 'custom' && (
                <Field label="Уровень (0..5)">
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={customLevel}
                    onChange={(e) =>
                      setCustomLevel(Math.max(0, Math.min(5, Number(e.target.value))))
                    }
                    className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
                  />
                </Field>
              )}
              <Field label="Формат ответа">
                <Select value={format} onChange={setFormat} options={FORMAT_LABEL} />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={keyOnly}
                onChange={(e) => setKeyOnly(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              <span>
                Только ключевые компетенции роли{' '}
                <span className="text-xs text-slate-500">
                  (отмечены ★ в справочнике МПК)
                </span>
              </span>
            </label>

            <Field label="Дополнительные инструкции (опционально)">
              <textarea
                rows={2}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Например: «упор на асинхронность», «без фреймворков», «на примере нашего проекта X»"
                className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
              />
            </Field>

            <Field
              label={
                selectedComps.size === 0
                  ? 'Компетенции (не выбрано — возьму компетенции с гэпом)'
                  : `Компетенции (выбрано: ${selectedComps.size})`
              }
            >
              {!competencies ? (
                <div className="text-sm text-slate-500">Загрузка…</div>
              ) : (
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-lg bg-bg-panel/50 p-2">
                  {competencies.map((c) => {
                    const on = selectedComps.has(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggle(c.id)}
                        className={`rounded px-2 py-1 text-xs ring-1 transition ${
                          on
                            ? 'bg-accent/20 text-accent ring-accent/40'
                            : 'text-slate-400 ring-white/5 hover:text-slate-200'
                        }`}
                      >
                        {c.name.slice(0, 40)}
                        {c.name.length > 40 && '…'}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>
          </div>

          {error && (
            <div className="border-t border-white/5 bg-red-500/5 px-6 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-white/5 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-slate-400 hover:text-slate-200"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
            >
              {saving ? 'Генерируем…' : 'Сгенерировать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
