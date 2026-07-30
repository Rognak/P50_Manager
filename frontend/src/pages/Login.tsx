import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import { setToken } from '../lib/auth'
import { useAuth } from '../lib/auth-context'

export function Login() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { access_token } = await api.login(email.trim().toLowerCase(), password)
      setToken(access_token)
      refresh()
      navigate('/')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <form
        onSubmit={onSubmit}
        className="w-80 space-y-4 rounded-2xl bg-bg-elevated p-8 shadow-xl"
      >
        <div className="text-center text-lg font-semibold text-accent">Прогресс 50 Менеджмент</div>
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        <input
          type="password"
          required
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg bg-bg-panel px-3 py-2 ring-1 ring-white/5 outline-none focus:ring-accent"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-accent py-2 font-medium text-bg hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
