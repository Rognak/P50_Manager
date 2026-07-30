import { useEffect, useState } from 'react'

import { api } from '../../api/client'

/**
 * Просмотр резюме кандидата.
 * - .docx — рендерится в HTML через mammoth (бэк-эндпоинт /resume/viewer)
 * - .pdf  — байты грузятся в blob, встраивается через <iframe>
 */
export function ResumeViewer({
  candidateId,
  filename,
  uploadedAt,
}: {
  candidateId: number
  filename: string | null
  /** ISO-строка момента загрузки — используется для инвалидации кеша. */
  uploadedAt: string | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const lower = (filename || '').toLowerCase()
  const isPdf = lower.endsWith('.pdf')
  const isDocx = lower.endsWith('.docx')

  useEffect(() => {
    setError(null)
    setDocxHtml(null)
    setPdfUrl(null)
    setLoading(true)
    let cancelled = false
    let createdUrl: string | null = null

    if (isDocx) {
      api.candidates
        .fetchResumeHtml(candidateId)
        .then((html) => {
          if (!cancelled) setDocxHtml(html)
        })
        .catch((e) => {
          if (!cancelled) setError((e as Error).message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    } else if (isPdf) {
      api.candidates
        .fetchResumeBytes(candidateId)
        .then((buf) => {
          if (cancelled) return
          const blob = new Blob([buf], { type: 'application/pdf' })
          createdUrl = URL.createObjectURL(blob)
          setPdfUrl(createdUrl)
        })
        .catch((e) => {
          if (!cancelled) setError((e as Error).message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    } else {
      setError('Неподдерживаемый формат файла. Поддерживаются .docx и .pdf')
      setLoading(false)
    }

    return () => {
      cancelled = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [candidateId, isPdf, isDocx, uploadedAt])

  if (loading) return <div className="text-xs text-slate-500">Загрузка резюме…</div>
  if (error)
    return (
      <div className="text-xs text-rose-400">
        Ошибка отображения: {error}. Файл можно скачать кнопкой выше.
      </div>
    )

  if (isDocx && docxHtml) {
    return (
      <div className="max-h-[800px] overflow-auto rounded-xl bg-bg-panel/40 p-5 ring-1 ring-white/5">
        <div className="sr-viewer" dangerouslySetInnerHTML={{ __html: docxHtml }} />
      </div>
    )
  }

  if (isPdf && pdfUrl) {
    return (
      <div className="overflow-hidden rounded-xl ring-1 ring-white/5">
        <iframe
          src={pdfUrl}
          title="Резюме (PDF)"
          className="h-[800px] w-full bg-white"
        />
      </div>
    )
  }

  return null
}
