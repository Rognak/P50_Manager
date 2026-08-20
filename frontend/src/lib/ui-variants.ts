import { TechnologyStatus } from '../api/client'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type SemanticStatus = 'primary' | 'success' | 'warning' | 'danger' | 'neutral'

const BUTTON_BASE = 'rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text disabled:ring-1 disabled:ring-disabled-border'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'text-ink-secondary hover:bg-surface-subtle hover:text-ink',
}

const STATUS_VARIANTS: Record<SemanticStatus, string> = {
  primary: 'semantic-status-primary',
  success: 'semantic-status-success',
  warning: 'semantic-status-warning',
  danger: 'semantic-status-danger',
  neutral: 'semantic-status-neutral',
}

export const TECHNOLOGY_STATUS_VARIANTS: Record<TechnologyStatus, string> = {
  adopt: STATUS_VARIANTS.success,
  trial: STATUS_VARIANTS.primary,
  assess: STATUS_VARIANTS.warning,
  hold: STATUS_VARIANTS.danger,
}

export function buttonClass(variant: ButtonVariant, extra = '') {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${extra}`.trim()
}

export function statusClass(status: SemanticStatus, extra = '') {
  return `rounded px-2 py-0.5 text-xs font-medium ${STATUS_VARIANTS[status]} ${extra}`.trim()
}
