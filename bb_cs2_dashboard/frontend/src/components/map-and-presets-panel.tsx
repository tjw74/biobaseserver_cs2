"use client"

import { useId, useState } from "react"

import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/context/auth-context"
import { postChangeMap } from "@/lib/dashboard-api"
import { toast } from "sonner"

/** Common stock maps (competitive pool + usual rotation). Workshop maps: use digits below. */
const STOCK_MAPS = [
  "de_ancient",
  "de_anubis",
  "de_dust2",
  "de_inferno",
  "de_mirage",
  "de_nuke",
  "de_overpass",
  "de_vertigo",
] as const

const SELECT_CUSTOM = "__custom__"

function mapToSelectValue(raw: string): string {
  const t = raw.trim()
  if (!t) {
    return ""
  }
  if ((STOCK_MAPS as readonly string[]).includes(t)) {
    return t
  }
  return SELECT_CUSTOM
}

export function MapAndPresetsPanel() {
  const mapSelectId = useId()
  const [mapValue, setMapValue] = useState("")
  const [busy, setBusy] = useState(false)
  const { refresh } = useAuth()

  const selectValue = mapToSelectValue(mapValue)

  async function applyMap() {
    const m = mapValue.trim()
    if (!m) {
      toast.error("Enter a map name or workshop id")
      return
    }
    setBusy(true)
    try {
      const d = await postChangeMap(m)
      if (d.httpStatus === 401) {
        await refresh()
        toast.error(d.error?.trim() || "Session expired — sign in again")
        return
      }
      if (d.httpStatus === 403) {
        toast.error(d.error ?? "You don't have permission to change the map (forbidden).")
        return
      }
      if (d.ok) {
        toast.success(d.message ?? "Map change sent")
      } else {
        toast.error(
          d.error ??
            (d.httpStatus === 502
              ? "Control service error — check CS2_CONTROL_TOKEN / BB_CS2_CONTROL_TOKEN matches bb_cs2_control."
              : "Map change failed"),
        )
      }
    } catch {
      toast.error("Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card size="sm" className="ring-foreground/10">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 pb-2">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-sm">Map & presets</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Change the live map via RCON (<code className="text-muted-foreground">changelevel</code>{" "}
            or{" "}
            <code className="text-muted-foreground">host_workshop_map</code> on the game server).
          </CardDescription>
        </div>
        <Badge variant="outline" className="shrink-0 text-[0.65rem]">
          Map live
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4 pt-0 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={mapSelectId} className="text-xs">
            Map
          </Label>
          <Select
            value={selectValue === "" ? undefined : selectValue}
            onValueChange={(v) => {
              if (v == null || v === SELECT_CUSTOM) {
                setMapValue("")
                return
              }
              setMapValue(v)
            }}
          >
            <SelectTrigger id={mapSelectId} size="sm" className="h-8 w-full min-w-0 text-sm" disabled={busy}>
              <SelectValue placeholder="Choose a map…" />
            </SelectTrigger>
            <SelectContent>
              {STOCK_MAPS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
              <SelectItem value={SELECT_CUSTOM}>Custom / workshop ID (use field below)</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor="map-input" className="text-muted-foreground text-[0.65rem]">
            Or type map name / workshop ID
          </Label>
          <Input
            id="map-input"
            placeholder="e.g. de_dust2 or 123456789012345"
            value={mapValue}
            onChange={(e) => setMapValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void applyMap()
            }}
            disabled={busy}
            className="h-8 text-sm"
          />
          <p className="text-muted-foreground text-[0.65rem] leading-snug">
            Workshop ids: 6–20 digits. Stock maps: letters, digits, underscores (max 64).
          </p>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-7"
            disabled={busy}
            onClick={() => void applyMap()}
          >
            Apply map
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="text-xs">Warmup</Label>
            <Badge variant="secondary" className="text-[0.65rem]">
              Soon
            </Badge>
          </div>
          <Select disabled>
            <SelectTrigger className="h-8 text-sm opacity-80" aria-disabled>
              <SelectValue placeholder="No preset API yet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scrim">Scrim</SelectItem>
              <SelectItem value="exec">Exec</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-[0.65rem] leading-snug">
            Server warmup/exec bundles need matching control endpoints; not implemented in this repo
            yet.
          </p>
          <Button type="button" disabled variant="secondary" size="sm" className="h-7">
            Load preset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
