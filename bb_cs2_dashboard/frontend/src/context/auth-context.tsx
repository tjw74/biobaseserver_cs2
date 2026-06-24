"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { fetchAuthMe, postLogin, postLogout } from "@/lib/dashboard-api"

export type AuthMe = {
  authenticated: boolean
  login_required: boolean
}

type AuthContextValue = {
  me: AuthMe | null
  loading: boolean
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AuthMe | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setMe(await fetchAuthMe())
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") {
        void refresh()
      }
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [refresh])

  const login = useCallback(
    async (username: string, password: string) => {
      const ok = await postLogin(username, password)
      if (ok) {
        await refresh()
      }
      return ok
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    await postLogout()
    await refresh()
  }, [refresh])

  const value = useMemo(
    () => ({ me, loading, refresh, login, logout }),
    [me, loading, refresh, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const c = useContext(AuthContext)
  if (!c) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return c
}
