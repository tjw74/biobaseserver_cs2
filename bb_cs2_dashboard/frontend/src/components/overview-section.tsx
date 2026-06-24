"use client"

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react"

import type { DashboardSection } from "@/components/biobase-sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/context/auth-context"
import {
  fetchServerCapabilities,
  type CapabilityTriState,
  type DemoParserCapability,
  type ServerCapabilitiesResponse,
} from "@/lib/dashboard-api"
import {
  Activity,
  Blocks,
  Cable,
  Film,
  Layers,
  Loader2,
  Mountain,
  RefreshCw,
  Server,
  ShieldAlert,
  Trophy,
} from "lucide-react"

type OverviewSectionProps = {
  onNavigate: (section: DashboardSection) => void
}

const overviewNavPillClass =
  "rounded-full border-border bg-muted/25 text-foreground shadow-none hover:border-primary hover:bg-primary hover:text-primary-foreground"

function TriBadge({ state }: { state: CapabilityTriState }) {
  if (state === "enabled") {
    return (
      <Badge
        variant="outline"
        className="h-5 shrink-0 border-emerald-500/60 px-1.5 py-0 text-[0.6rem] text-emerald-400"
      >
        Enabled
      </Badge>
    )
  }
  if (state === "disabled") {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground h-5 shrink-0 border-border px-1.5 py-0 text-[0.6rem]"
      >
        Disabled
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="h-5 shrink-0 border-amber-500/50 px-1.5 py-0 text-[0.6rem] text-amber-200/90"
    >
      Unknown
    </Badge>
  )
}

function CapabilityIconRow({
  icon: Icon,
  label,
  right,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  right: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div
        className="text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/25"
        aria-hidden
      >
        <Icon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="text-foreground text-sm font-medium">{label}</span>
        {right}
      </div>
    </div>
  )
}

function formatCheckedAt(iso: string | undefined): string {
  if (!iso) {
    return "—"
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return iso
  }
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
  })
}

function normalizeTri(raw: string | undefined): CapabilityTriState {
  if (raw === "enabled" || raw === "disabled" || raw === "unknown") {
    return raw
  }
  return "unknown"
}

function demoParserChipLabel(row: Pick<DemoParserCapability, "id" | "tool">): string {
  switch (row.id) {
    case "awpy":
      return "Awpy"
    case "demoparser2":
      return "demoparser2"
    case "demoinfocs_golang":
      return "demoinfocs (Go)"
    default:
      return row.tool
  }
}

export function OverviewSection({ onNavigate }: OverviewSectionProps) {
  const [capData, setCapData] = useState<ServerCapabilitiesResponse | null>(null)
  const [capLoading, setCapLoading] = useState(true)
  const [capFetchError, setCapFetchError] = useState<string | null>(null)
  const [capHttpStatus, setCapHttpStatus] = useState<number | null>(null)
  const { refresh } = useAuth()

  const loadCaps = useCallback(async () => {
    setCapLoading(true)
    setCapFetchError(null)
    try {
      const { httpStatus, data } = await fetchServerCapabilities()
      setCapHttpStatus(httpStatus)
      if (httpStatus === 401) {
        await refresh()
        return
      }
      setCapData(data)
    } catch (err) {
      setCapHttpStatus(null)
      setCapFetchError(err instanceof Error ? err.message : "Failed to load server capabilities.")
    } finally {
      setCapLoading(false)
    }
  }, [refresh])

  useEffect(() => {
    const handle = window.requestAnimationFrame(() => {
      void loadCaps()
    })
    return () => window.cancelAnimationFrame(handle)
  }, [loadCaps])

  const plugs = capData?.plugins
  const rconReach = capData?.rcon?.reachable === true
  const controlOk = capData?.control_http_ok !== false && !capData?.error
  const rconTri: CapabilityTriState = rconReach
    ? "enabled"
    : capData?.rcon?.reachable === false
      ? "disabled"
      : "unknown"
  const cheatsState = capData?.cheats?.state
  const cheatsBadge: CapabilityTriState =
    cheatsState === "on" ? "enabled" : cheatsState === "off" ? "disabled" : "unknown"

  const launchCheats = capData?.cheats?.launch_env
  const launchHint =
    launchCheats?.known === true
      ? `Compose / image boot: CS2_CHEATS=${launchCheats.value ?? "—"}`
      : "Compose / boot: CS2_CHEATS not mirrored on control (set on bb_cs2_control to show)"

  const showCapsSkeleton =
    capLoading &&
    capData === null &&
    !capFetchError &&
    capHttpStatus !== 404 &&
    capHttpStatus !== 401

  return (
    <div className="space-y-3">
      <Card size="sm" className="bg-card/80 ring-foreground/10">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-sm">Server profile & plugins</CardTitle>
            <p className="text-muted-foreground text-xs leading-snug">
              Live RCON hints for MetaMod, CounterStrikeSharp, MatchZy, CS2KZ, BioBase — plus boot
              profile and cheats.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 border-border"
            disabled={capLoading}
            onClick={() => void loadCaps()}
          >
            {capLoading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {capFetchError ? (
            <div className="space-y-2 rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2.5">
              <p className="text-destructive text-sm font-medium">Could not reach capabilities API</p>
              <p className="text-muted-foreground font-mono text-xs break-all">{capFetchError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit gap-1.5"
                onClick={() => void loadCaps()}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Try again
              </Button>
            </div>
          ) : capHttpStatus === 404 ? (
            <div className="text-muted-foreground space-y-1.5 rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 text-sm">
              <p className="text-foreground font-medium">Capabilities endpoint missing (404)</p>
              <p className="text-xs leading-snug">
                Expected <span className="font-mono">GET …/admin/api/server-capabilities</span> on this host.
                Rebuild bb_cs2_dashboard (and bb_cs2_control for live data), redeploy, and ensure the SPA base path
                matches your reverse proxy.
              </p>
            </div>
          ) : capHttpStatus === 401 ? (
            <div className="text-muted-foreground flex items-center gap-2 rounded-md border border-border/80 bg-muted/20 px-3 py-2.5 text-sm">
              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" aria-hidden />
              <span>Refreshing session…</span>
            </div>
          ) : showCapsSkeleton ? (
            <div className="space-y-2">
              <Skeleton className="h-10 rounded-md" />
              <Skeleton className="h-10 rounded-md" />
              <Skeleton className="h-10 rounded-md" />
            </div>
          ) : (
            <>
              <CapabilityIconRow
                icon={Server}
                label="Control API"
                right={<TriBadge state={controlOk ? "enabled" : "unknown"} />}
              />
              <CapabilityIconRow
                icon={Cable}
                label="RCON from control"
                right={<TriBadge state={rconTri} />}
              />

              <div className="border-border/80 flex flex-wrap items-center gap-2 border-y border-dashed py-2">
                <span className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wider">
                  Profile
                </span>
                <Badge
                  variant="outline"
                  className="h-5 border-border px-2 py-0 text-[0.65rem] font-normal"
                >
                  {capData?.server_profile?.value ?? "unknown"}
                </Badge>
                {capData?.server_profile?.source ? (
                  <span className="text-muted-foreground text-[0.65rem]">
                    ({capData.server_profile.source})
                  </span>
                ) : null}
              </div>

              {capData?.demo_parsers && capData.demo_parsers.length > 0 ? (
                <div className="border-border/70 bg-muted/12 rounded-md border px-2 py-1.5">
                  <div className="text-muted-foreground flex items-center gap-1.5 text-[0.6rem] font-medium tracking-wider uppercase">
                    <Film className="size-3 shrink-0 opacity-90" aria-hidden />
                    Demo parsers
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[0.62rem] leading-snug">
                    Source: POST parse preview / compare routes
                  </p>
                  <div className="text-foreground mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[0.68rem] leading-tight">
                    {capData.demo_parsers.map((p) => (
                      <span key={p.id} className="inline-flex items-baseline gap-1">
                        <span className="font-medium">{demoParserChipLabel(p)}</span>
                        <span className="text-muted-foreground">{p.version_or_probe}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <CapabilityIconRow
                icon={ShieldAlert}
                label="sv_cheats (live)"
                right={<TriBadge state={cheatsBadge} />}
              />
              <p className="text-muted-foreground -mt-1 text-[0.65rem] leading-snug">{launchHint}</p>

              <div className="space-y-2.5">
                <p className="text-muted-foreground text-[0.65rem] font-medium uppercase tracking-wider">
                  Plugins (from meta / CSS lists)
                </p>
                <CapabilityIconRow
                  icon={Blocks}
                  label="MetaMod"
                  right={<TriBadge state={normalizeTri(plugs?.metamod?.state)} />}
                />
                <CapabilityIconRow
                  icon={Layers}
                  label="CounterStrikeSharp"
                  right={<TriBadge state={normalizeTri(plugs?.counterstrikesharp?.state)} />}
                />
                <CapabilityIconRow
                  icon={Trophy}
                  label="MatchZy"
                  right={<TriBadge state={normalizeTri(plugs?.matchzy?.state)} />}
                />
                <CapabilityIconRow
                  icon={Mountain}
                  label="CS2KZ"
                  right={<TriBadge state={normalizeTri(plugs?.kz?.state)} />}
                />
                <CapabilityIconRow
                  icon={Activity}
                  label="BioBase positions"
                  right={<TriBadge state={normalizeTri(plugs?.biobase_pos?.state)} />}
                />
              </div>

              <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-[0.65rem]">
                <span>Last check: {formatCheckedAt(capData?.checked_at)}</span>
                {capData?.error ? (
                  <span className="text-destructive max-w-full truncate" title={capData.detail}>
                    {capData.error}
                    {capData.detail ? ` — ${capData.detail}` : ""}
                  </span>
                ) : (
                  <span className="line-clamp-1 max-w-[min(100%,18rem)] sm:max-w-xs">
                    {capData?.rcon?.status?.headline ?? ""}
                    {capData?.rcon?.status?.map ? ` · ${capData.rcon.status.map}` : ""}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm" className="bg-card/80 ring-foreground/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">BioBase CS2</CardTitle>
          <p className="text-muted-foreground text-xs leading-snug">
            Bot matches, server status, clip upload, and Grafana when configured.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 pt-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={overviewNavPillClass}
            onClick={() => onNavigate("match_server")}
          >
            Match & server
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={overviewNavPillClass}
            onClick={() => onNavigate("practice_tools")}
          >
            Practice
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={overviewNavPillClass}
            onClick={() => onNavigate("upload")}
          >
            Upload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={overviewNavPillClass}
            onClick={() => onNavigate("observability")}
          >
            Observability
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
