import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react'

import { CurrentUser, api } from '../api/client'
import { getToken } from './auth'

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  refresh: () => void
}

const AuthCtx = createContext<AuthContextValue>({
  user: null,
  loading: true,
  refresh: () => undefined,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [tick])

  return (
    <AuthCtx.Provider
      value={{ user, loading, refresh: () => setTick((t) => t + 1) }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useCurrentUser(): CurrentUser | null {
  return useContext(AuthCtx).user
}

export function useAuth(): AuthContextValue {
  return useContext(AuthCtx)
}

/** True если у текущего пользователя только read-only доступ. */
export function useReadOnly(): boolean {
  const u = useContext(AuthCtx).user
  return u?.role === 'core_team'
}
