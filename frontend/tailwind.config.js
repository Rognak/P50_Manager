import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--color-surface) / <alpha-value>)',
          subtle: 'rgb(var(--color-surface-subtle) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        },
        outline: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          subtle: 'rgb(var(--color-border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
          active: 'rgb(var(--color-primary-active) / <alpha-value>)',
          soft: 'rgb(var(--color-primary-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--color-success) / <alpha-value>)',
          hover: 'rgb(var(--color-success-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--color-warning) / <alpha-value>)',
          hover: 'rgb(var(--color-warning-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-warning-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--color-danger) / <alpha-value>)',
          hover: 'rgb(var(--color-danger-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-danger-soft) / <alpha-value>)',
        },
        disabled: {
          DEFAULT: 'rgb(var(--color-disabled-bg) / <alpha-value>)',
          text: 'rgb(var(--color-disabled-text) / <alpha-value>)',
          border: 'rgb(var(--color-disabled-border) / <alpha-value>)',
        },
        data: {
          1: 'var(--data-1)',
          2: 'var(--data-2)',
          3: 'var(--data-3)',
          4: 'var(--data-4)',
          5: 'var(--data-5)',
          6: 'var(--data-6)',
        },
        bg: {
          DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated) / <alpha-value>)',
          panel: 'rgb(var(--color-bg-panel) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          soft: 'rgb(var(--color-accent-soft) / <alpha-value>)',
        },
        slate: {
          50: 'rgb(var(--color-slate-50) / <alpha-value>)',
          100: 'rgb(var(--color-slate-100) / <alpha-value>)',
          200: 'rgb(var(--color-slate-200) / <alpha-value>)',
          300: 'rgb(var(--color-slate-300) / <alpha-value>)',
          400: 'rgb(var(--color-slate-400) / <alpha-value>)',
          500: 'rgb(var(--color-slate-500) / <alpha-value>)',
          600: 'rgb(var(--color-slate-600) / <alpha-value>)',
          700: 'rgb(var(--color-slate-700) / <alpha-value>)',
          800: 'rgb(var(--color-slate-800) / <alpha-value>)',
          900: 'rgb(var(--color-slate-900) / <alpha-value>)',
        },
        emerald: {
          200: 'rgb(var(--color-success) / <alpha-value>)',
          300: 'rgb(var(--color-success) / <alpha-value>)',
          400: 'rgb(var(--color-success) / <alpha-value>)',
          500: 'rgb(var(--color-success) / <alpha-value>)',
          600: 'rgb(var(--color-success-hover) / <alpha-value>)',
        },
        teal: {
          300: 'rgb(var(--color-success) / <alpha-value>)',
          400: 'rgb(var(--color-success) / <alpha-value>)',
          500: 'rgb(var(--color-success) / <alpha-value>)',
        },
        amber: {
          200: 'rgb(var(--color-warning) / <alpha-value>)',
          300: 'rgb(var(--color-warning) / <alpha-value>)',
          400: 'rgb(var(--color-warning) / <alpha-value>)',
          500: 'rgb(var(--color-warning) / <alpha-value>)',
          600: 'rgb(var(--color-warning-hover) / <alpha-value>)',
        },
        rose: {
          200: 'rgb(var(--color-danger) / <alpha-value>)',
          300: 'rgb(var(--color-danger) / <alpha-value>)',
          400: 'rgb(var(--color-danger) / <alpha-value>)',
          500: 'rgb(var(--color-danger) / <alpha-value>)',
          600: 'rgb(var(--color-danger-hover) / <alpha-value>)',
        },
        red: {
          300: 'rgb(var(--color-danger) / <alpha-value>)',
          400: 'rgb(var(--color-danger) / <alpha-value>)',
          500: 'rgb(var(--color-danger) / <alpha-value>)',
          600: 'rgb(var(--color-danger-hover) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [typography],
}
