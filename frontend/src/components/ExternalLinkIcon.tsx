/**
 * Иконка для квадрата «смежной системы». Подбирает SVG по ключевым словам
 * в названии или fallback к монограмме первой буквы с цветом по хэшу.
 */
import { ReactElement } from 'react'

type Tone = 'teal' | 'violet' | 'amber' | 'rose' | 'sky'

const TONE_STYLES: Record<Tone, { bg: string; ring: string; text: string }> = {
  teal: {
    bg: 'bg-emerald-500/15',
    ring: 'ring-emerald-500/30',
    text: 'text-emerald-300',
  },
  violet: {
    bg: 'bg-violet-500/15',
    ring: 'ring-violet-500/30',
    text: 'text-violet-300',
  },
  amber: {
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/30',
    text: 'text-amber-300',
  },
  rose: {
    bg: 'bg-rose-500/15',
    ring: 'ring-rose-500/30',
    text: 'text-rose-300',
  },
  sky: {
    bg: 'bg-sky-500/15',
    ring: 'ring-sky-500/30',
    text: 'text-sky-300',
  },
}

const TONES: Tone[] = ['teal', 'violet', 'amber', 'rose', 'sky']

function hashTone(s: string): Tone {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return TONES[Math.abs(h) % TONES.length]
}

// SVG-иконки для известных категорий — простые stroke-style 24x24.
// Каждая — функция, возвращающая jsx (чтобы цвет тёкс text-color).
const SVG_ICONS: Record<string, ReactElement> = {
  tracker: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
    </svg>
  ),
  code: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <path d="M8 6 2 12l6 6" />
      <path d="M16 6l6 6-6 6" />
      <path d="M14 4l-4 16" />
    </svg>
  ),
  chart: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <path d="M4 20V10" />
      <path d="M11 20V4" />
      <path d="M18 20v-7" />
      <path d="M2 20h20" />
    </svg>
  ),
  docs: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6M9 8h2" />
    </svg>
  ),
  bot: (
    // CodeBuddy → бот / помощник
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <rect x="4" y="7" width="16" height="12" rx="2.5" />
      <circle cx="9" cy="13" r="1.2" fill="currentColor" />
      <circle cx="15" cy="13" r="1.2" fill="currentColor" />
      <path d="M9 17h6" />
      <path d="M12 4v3" />
      <circle cx="12" cy="3.5" r="0.8" fill="currentColor" />
    </svg>
  ),
}

function pickIconKey(label: string): string | null {
  const low = label.toLowerCase()
  // Конкретные продукты с прицельным дизайном
  if (low.includes('codebuddy') || low.includes('buddy')) return 'bot'
  if (low.includes('dstracker') || low.includes('tracker')) return 'tracker'
  // Категории по ключевым словам
  if (low.includes('code') || low.includes('git') || low.includes('review'))
    return 'code'
  if (
    low.includes('analytic') ||
    low.includes('metric') ||
    low.includes('dashboard') ||
    low.includes('stat')
  )
    return 'chart'
  if (
    low.includes('docs') ||
    low.includes('wiki') ||
    low.includes('confluence') ||
    low.includes('notion')
  )
    return 'docs'
  return null
}

export function ExternalLinkIcon({ label }: { label: string }) {
  const iconKey = pickIconKey(label)
  const tone = hashTone(label)
  const styles = TONE_STYLES[tone]
  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${styles.bg} ${styles.ring} ${styles.text}`}
    >
      {iconKey ? (
        SVG_ICONS[iconKey]
      ) : (
        <span className="text-base font-semibold">
          {(label[0] || '?').toUpperCase()}
        </span>
      )}
    </div>
  )
}
