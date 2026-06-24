import { DashboardShell } from "@/components/dashboard-shell"
import { LoginPage } from "@/components/login-page"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AuthProvider, useAuth } from "@/context/auth-context"
import { Loader2Icon } from "lucide-react"

function AppGate() {
  const { me, loading } = useAuth()

  if (loading || me === null) {
    return (
      <div
        className="bg-background text-muted-foreground flex min-h-svh flex-col items-center justify-center gap-3"
        aria-busy="true"
        aria-label="Loading"
      >
        <Loader2Icon className="size-8 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (me.login_required && !me.authenticated) {
    return <LoginPage />
  }

  return (
    <TooltipProvider>
      <div className="min-h-svh w-full">
        <DashboardShell />
      </div>
    </TooltipProvider>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppGate />
      <Toaster position="top-center" richColors />
    </AuthProvider>
  )
}

export default App
