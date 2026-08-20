import { useTheme } from '../lib/theme-context'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'
  return <button
    type="button"
    onClick={toggleTheme}
    title={isLight ? 'Включить тёмную тему' : 'Включить светлую тему'}
    aria-label={isLight ? 'Включить тёмную тему' : 'Включить светлую тему'}
    className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-ink-secondary transition hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    {isLight ? '☾' : '☼'}
  </button>
}
