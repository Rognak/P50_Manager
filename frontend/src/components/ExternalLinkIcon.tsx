/**
 * Иконка для квадрата «смежной системы». Подбирает SVG по ключевым словам
 * в названии или fallback к монограмме первой буквы с цветом по хэшу.
 */
import { ReactElement } from 'react'

type Tone = 'data1' | 'data2' | 'data3' | 'data4' | 'data5'

const TONE_STYLES: Record<Tone, { bg: string; ring: string; text: string }> = {
  data1: {
    bg: 'bg-surface-subtle',
    ring: 'ring-outline-subtle',
    text: 'text-data-1',
  },
  data2: {
    bg: 'bg-surface-subtle',
    ring: 'ring-outline-subtle',
    text: 'text-data-2',
  },
  data3: {
    bg: 'bg-surface-subtle',
    ring: 'ring-outline-subtle',
    text: 'text-data-3',
  },
  data4: {
    bg: 'bg-surface-subtle',
    ring: 'ring-outline-subtle',
    text: 'text-data-4',
  },
  data5: {
    bg: 'bg-surface-subtle',
    ring: 'ring-outline-subtle',
    text: 'text-data-5',
  },
}

const TONES: Tone[] = ['data1', 'data2', 'data3', 'data4', 'data5']

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
