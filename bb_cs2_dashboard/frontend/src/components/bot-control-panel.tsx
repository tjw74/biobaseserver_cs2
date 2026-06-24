"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/context/auth-context"
import { postBots } from "@/lib/dashboard-api"
import { toast } from "sonner"

type BotControlPanelProps = {
  /** Card: full row. Toolbar: compact strip for use beside metrics. */
  embed?: "card" | "toolbar"
}

export function BotControlPanel({ embed = "card" }: BotControlPanelProps) {
  const [busy, setBusy] = useState(false)
  const { refresh } = useAuth()

  async function run(action: "start" | "stop") {
    setBusy(true)
    try {
      const d = action === "start" ? await postBots("start") : await postBots("stop")
      if (d.httpStatus === 401) {
        await refresh()
        toast.error("Session expired — sign in again")
        return
      }
      if (d.ok) {
        toast.success(d.message ?? "OK")
      } else {
        toast.error(d.error ?? "Failed")
      }
    } catch {
      toast.error("Request failed")
    } finally {
      setBusy(false)
    }
  }

  const actions = (
    <div className="flex shrink-0 gap-1.5">
      <Button
        type="button"
        size="sm"
        className="h-7"
        disabled={busy}
        onClick={() => void run("start")}
      >
        Start
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7"
        disabled={busy}
        onClick={() => void run("stop")}
      >
        Stop
      </Button>
    </div>
  )

  if (embed === "toolbar") {
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <span className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
          Bot match
        </span>
        {actions}
      </div>
    )
  }

  return (
    <Card size="sm" className="ring-foreground/10">
      <CardHeader className="gap-2 space-y-0 pb-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm">Bot match</CardTitle>
            <CardDescription className="text-xs leading-snug">
              <code className="text-muted-foreground">BB_CS2_CONTROL_TOKEN</code> must match the
              control service when that env is set.
            </CardDescription>
          </div>
          {actions}
        </div>
      </CardHeader>
    </Card>
  )
}
