"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/auth-context"
import { authLoginUrl } from "@/lib/dashboard-api"

const USERNAME_STORAGE_KEY = "bb_cs2_dashboard_username"

function readStoredUsername(): string {
  if (typeof window === "undefined") {
    return "admin"
  }
  return localStorage.getItem(USERNAME_STORAGE_KEY)?.trim() || "admin"
}

async function tryStorePasswordInBrowser(username: string, password: string): Promise<void> {
  if (typeof window === "undefined" || !navigator.credentials?.store) {
    return
  }
  const PasswordCredentialCtor = (
    window as Window & {
      PasswordCredential?: new (data: {
        id: string
        password: string
        name?: string
      }) => Credential
    }
  ).PasswordCredential
  if (!PasswordCredentialCtor) {
    return
  }
  try {
    await navigator.credentials.store(
      new PasswordCredentialCtor({ id: username, password, name: username }),
    )
  } catch {
    // Browser may decline; session cookie still keeps you signed in.
  }
}

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState(readStoredUsername)
  const [password, setPassword] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const user = username.trim()
    const ok = await login(user, password)
    if (ok) {
      localStorage.setItem(USERNAME_STORAGE_KEY, user)
      await tryStorePasswordInBrowser(user, password)
    } else {
      setErr("Invalid username or password.")
    }
    setBusy(false)
  }

  return (
    <div className="bg-background flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>BioBase · CS2 admin</CardTitle>
          <CardDescription>
            Shared team login. After a successful sign-in you stay logged in for 30 days on this
            browser. Firefox can also save the password when prompted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            action={authLoginUrl()}
            autoComplete="on"
            onSubmit={(e) => void onSubmit(e)}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="dash-user">Username</Label>
              <Input
                id="dash-user"
                type="text"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
              />
              <p className="text-muted-foreground text-[0.7rem] leading-snug">
                If the server sets no fixed username, any username is accepted; the password is still
                required.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dash-pass">Password</Label>
              <Input
                id="dash-pass"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <p className="text-muted-foreground text-[0.7rem] leading-snug">
                This is the shared dashboard secret (<code className="text-muted-foreground">BB_CS2_DASHBOARD_TOKEN</code>
                ).
              </p>
            </div>
            {err ? <p className="text-destructive text-sm">{err}</p> : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
