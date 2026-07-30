import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0e1525',
          elevated: '#141d33',
          panel: '#1a2540',
        },
        accent: {
          DEFAULT: '#34d4c8',
          soft: '#1d8c86',
        },
      },
    },
  },
  plugins: [typography],
}
