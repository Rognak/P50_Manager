import { AIJob, AIJobKind, api } from '../api/client'

const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 5 * 60 * 1000

export class JobError extends Error {
  constructor(public job: AIJob) {
    super(job.error || 'Задача завершилась с ошибкой')
    this.name = 'JobError'
  }
}

export class JobAborted extends Error {
  constructor() {
    super('aborted')
    this.name = 'JobAborted'
  }
}

async function sleepCancelable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new JobAborted()
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new JobAborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Поллит ai-job до завершения. Возвращает финальный AIJob с status='done'.
 * Бросает JobError при status='error'. JobAborted при отмене. Error при таймауте.
 *
 * onUpdate вызывается при каждом изменении статуса.
 */
export async function pollJob(
  employeeId: number,
  jobId: number,
  onUpdate?: (job: AIJob) => void,
  signal?: AbortSignal,
): Promise<AIJob> {
  const start = Date.now()
  let lastStatus = ''
  for (;;) {
    if (signal?.aborted) throw new JobAborted()
    const job = await api.aiJobs.get(employeeId, jobId)
    if (job.status !== lastStatus) {
      lastStatus = job.status
      onUpdate?.(job)
    }
    if (job.status === 'done') return job
    if (job.status === 'error') throw new JobError(job)
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error('Таймаут ожидания задачи (5 минут)')
    }
    await sleepCancelable(POLL_INTERVAL_MS, signal)
  }
}

/**
 * Найти активную (queued|running) задачу указанного типа для контекста.
 * Возвращает самую свежую (id desc) или null.
 */
export async function findActiveJob(
  employeeId: number,
  kind: AIJobKind | AIJobKind[],
  targetId?: number,
): Promise<AIJob | null> {
  const kindParam = Array.isArray(kind) ? kind.join(',') : kind
  const list = await api.aiJobs.list(employeeId, {
    status: 'queued,running',
    kind: kindParam,
    target_id: targetId,
    limit: 1,
  })
  return list[0] || null
}
