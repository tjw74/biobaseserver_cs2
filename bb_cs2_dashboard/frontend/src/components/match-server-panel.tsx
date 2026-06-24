"use client"

import { useCallback, useEffect, useState } from "react"

import { BotControlPanel } from "@/components/bot-control-panel"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/context/auth-context"
import { fetchStatus, type StatusResponse } from "@/lib/dashboard-api"

function display(v: string | number | null | undefined) {
  if (v === null || v === undefined) {
    return "—"
  }
  return String(v)
}

const labelClass =
  "text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wider"

export function MatchServerPanel() {
  const [data, setData] = useState<StatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const { refresh } = useAuth()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { httpStatus, data: next } = await fetchStatus()
      if (httpStatus === 401) {
        await refresh()
        return
      }
      setData(next)
    } finally {
      setLoading(false)
    }
  }, [refresh])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [load])

  const shellClass =
    "rounded-xl border border-border bg-card/40 p-3 shadow-xs ring-1 ring-foreground/10"

  if (loading && !data) {
    return (
      <div className={shellClass}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[3.25rem] rounded-md" />
          ))}
        </div>
        <div className="mt-3 border-t border-border pt-2.5">
          <Skeleton className="h-7 w-full max-w-[11rem] rounded-md sm:ml-auto" />
        </div>
      </div>
    )
  }

  const d = data ?? {}
  const ok = d.rcon_ok !== false && !d.error

  return (
    <div className={shellClass}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-4 lg:gap-x-6">
        <div className="min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <span className={labelClass}>Status</span>
            <Badge
              variant={ok ? "outline" : "destructive"}
              className={
                ok
                  ? "h-4 shrink-0 border-border px-1.5 py-0 text-[0.6rem] text-foreground"
                  : "h-4 shrink-0 px-1.5 py-0 text-[0.6rem]"
              }
            >
              {ok ? "OK" : "Err"}
            </Badge>
          </div>
          <p className="line-clamp-2 text-xs leading-tight font-semibold">{display(d.headline)}</p>
        </div>
        <div className="min-w-0 space-y-0.5">
          <span className={labelClass}>Humans</span>
          <p className="font-semibold text-lg leading-none tabular-nums">{display(d.humans)}</p>
        </div>
        <div className="min-w-0 space-y-0.5">
          <span className={labelClass}>Bots</span>
          <p className="font-semibold text-lg leading-none tabular-nums">{display(d.bots)}</p>
        </div>
        <div className="min-w-0 space-y-0.5">
          <span className={labelClass}>Map</span>
          <p className="break-all text-xs leading-tight font-semibold">{display(d.map)}</p>
          <p className="text-muted-foreground line-clamp-1 text-[0.65rem] leading-tight">
            {display(d.hostname)}
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-2.5">
        <BotControlPanel embed="toolbar" />
      </div>
    </div>
  )
}
