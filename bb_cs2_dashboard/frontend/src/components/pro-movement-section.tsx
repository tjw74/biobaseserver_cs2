"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  deleteDemoMovementAnnotation,
  fetchDemoMovement,
  fetchDemoMovementAnnotations,
  fetchDemoRender,
  fetchDemoSteamPlayback,
  fetchDemoMovementList,
  postDemoMovementAnnotation,
  postDemoMovementParse,
  postDemoRender,
  postDemoSteamPlayback,
  type DemoMovementAnnotation,
  type DemoRenderStatus,
  type DemoSteamPlaybackStatus,
  type DemoMovementPayload,
  type DemoMovementPlayer,
  type DemoMovementPoint,
  type UploadListItem,
} from "@/lib/dashboard-api"
import { ActivityIcon, FlagIcon, Loader2Icon, PauseIcon, PlayIcon, RefreshCwIcon, RouteIcon, SaveIcon, Trash2Icon } from "lucide-react"

type DemoRow = UploadListItem & { movement_parsed?: boolean }

type DraftLabel = {
  label: string
  intent: string
  phase: string
  quality: string
  note: string
  startTick?: number
  endTick?: number
}

function fmtInt(v: number | undefined | null): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "—"
  return Math.round(v).toLocaleString()
}

function fmtFixed(v: number | undefined | null, digits = 1): string {
  if (v === undefined || v === null || Number.isNaN(v)) return "—"
  return v.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function playerTickRange(players: DemoMovementPlayer[]): { min: number; max: number } {
  const ticks = players.flatMap((p) => [p.first_tick, p.last_tick, ...(p.points ?? []).map((pt) => pt.tick)]).filter((v) => Number.isFinite(v))
  return { min: Math.min(...ticks, 0), max: Math.max(...ticks, 1) }
}

function interpolatePoint(points: DemoMovementPoint[], tick: number): DemoMovementPoint | null {
  const pts = points.filter((p) => p.x !== null && p.y !== null).sort((a, b) => a.tick - b.tick)
  if (pts.length === 0) return null
  if (tick <= pts[0].tick) return pts[0]
  if (tick >= pts[pts.length - 1].tick) return pts[pts.length - 1]
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]
    const b = pts[i]
    if (tick <= b.tick) {
      const span = Math.max(1, b.tick - a.tick)
      const t = (tick - a.tick) / span
      return {
        tick,
        round_num: b.round_num ?? a.round_num,
        x: (a.x ?? 0) + ((b.x ?? 0) - (a.x ?? 0)) * t,
        y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t,
        z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
        health: b.health ?? a.health,
      }
    }
  }
  return pts[pts.length - 1]
}

function MovementMap({
  payload,
  selectedSteamid,
  currentTick,
  annotations,
}: {
  payload: DemoMovementPayload
  selectedSteamid?: string
  currentTick?: number
  annotations?: DemoMovementAnnotation[]
}) {
  const bounds = payload.summary?.bounds ?? {}
  const players = payload.players ?? []
  const visible = selectedSteamid ? players.filter((p) => p.steamid === selectedSteamid) : players.slice(0, 10)
  const xMin = bounds.x_min ?? 0
  const xMax = bounds.x_max ?? 1
  const yMin = bounds.y_min ?? 0
  const yMax = bounds.y_max ?? 1
  const w = 900
  const h = 520
  const colors = ["#38bdf8", "#f97316", "#a78bfa", "#22c55e", "#f43f5e", "#eab308", "#14b8a6", "#fb7185", "#60a5fa", "#c084fc"]
  const sx = (x: number | null | undefined) => (x === null || x === undefined || xMax === xMin ? 0 : ((x - xMin) / (xMax - xMin)) * w)
  const sy = (y: number | null | undefined) => (y === null || y === undefined || yMax === yMin ? 0 : h - ((y - yMin) / (yMax - yMin)) * h)
  const activeAnnotations = (annotations ?? []).filter((a) => currentTick !== undefined && currentTick >= a.start_tick && currentTick <= a.end_tick)

  return (
    <div className="rounded-lg border bg-muted/10 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[420px] w-full rounded bg-background" role="img" aria-label="Player movement playback">
        <rect x="0" y="0" width={w} height={h} fill="transparent" />
        <g opacity="0.16" stroke="currentColor" strokeWidth="1">
          {Array.from({ length: 7 }).map((_, i) => <line key={`v-${i}`} x1={(i * w) / 6} y1="0" x2={(i * w) / 6} y2={h} />)}
          {Array.from({ length: 5 }).map((_, i) => <line key={`h-${i}`} x1="0" y1={(i * h) / 4} x2={w} y2={(i * h) / 4} />)}
        </g>
        {visible.map((player, idx) => {
          const pts = (player.points ?? []).filter((p) => p.x !== null && p.y !== null)
          const trail = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)} ${sy(p.y)}`).join(" ")
          const elapsed = currentTick === undefined ? [] : pts.filter((p) => p.tick <= currentTick)
          const elapsedTrail = elapsed.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)} ${sy(p.y)}`).join(" ")
          const color = colors[idx % colors.length]
          const first = pts[0]
          const last = pts[pts.length - 1]
          const current = currentTick === undefined ? null : interpolatePoint(pts, currentTick)
          return (
            <g key={player.steamid}>
              <path d={trail} fill="none" stroke={color} strokeWidth={selectedSteamid ? 1.4 : 1} opacity={selectedSteamid ? 0.34 : 0.22} />
              {elapsedTrail ? <path d={elapsedTrail} fill="none" stroke={color} strokeWidth={selectedSteamid ? 2 : 1.45} opacity={selectedSteamid ? 0.95 : 0.72} /> : null}
              {first ? <circle cx={sx(first.x)} cy={sy(first.y)} r="2.5" fill={color} opacity="0.8" /> : null}
              {last ? <circle cx={sx(last.x)} cy={sy(last.y)} r="3.5" fill="none" stroke={color} strokeWidth="1.4" opacity="0.75" /> : null}
              {current ? <circle cx={sx(current.x)} cy={sy(current.y)} r={selectedSteamid ? 6 : 4} fill={color} stroke="hsl(var(--background))" strokeWidth="2" /> : null}
            </g>
          )
        })}
        {activeAnnotations.map((a, i) => {
          const p = visible.find((x) => x.steamid === a.player_steamid) ?? visible[0]
          const pt = p ? interpolatePoint(p.points, currentTick ?? a.start_tick) : null
          return pt ? (
            <g key={a.id ?? i}>
              <circle cx={sx(pt.x)} cy={sy(pt.y)} r="12" fill="none" stroke="#facc15" strokeWidth="2" opacity="0.9" />
              <text x={sx(pt.x) + 14} y={sy(pt.y) - 10} fill="#facc15" fontSize="18" fontWeight="600">{a.label}</text>
            </g>
          ) : null
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {visible.map((p, idx) => <span key={p.steamid} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }} />{p.name}</span>)}
      </div>
    </div>
  )
}

export function ProMovementSection() {
  const [demos, setDemos] = useState<DemoRow[]>([])
  const [selected, setSelected] = useState("")
  const [payload, setPayload] = useState<DemoMovementPayload | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<string | undefined>(undefined)
  const [parseMaxMb, setParseMaxMb] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<DemoMovementAnnotation[]>([])
  const [renderStatus, setRenderStatus] = useState<DemoRenderStatus | null>(null)
  const [steamStatus, setSteamStatus] = useState<DemoSteamPlaybackStatus | null>(null)
  const [renderBusy, setRenderBusy] = useState(false)
  const [steamBusy, setSteamBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentTick, setCurrentTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [draft, setDraft] = useState<DraftLabel>({ label: "", intent: "", phase: "", quality: "good", note: "" })

  const selectedDemo = useMemo(() => demos.find((d) => d.name === selected), [demos, selected])
  const players = payload?.players ?? []
  const tickRange = useMemo(() => playerTickRange(players), [players])
  const selectedPlayerRow = useMemo(() => players.find((p) => p.steamid === selectedPlayer), [players, selectedPlayer])
  const currentRound = useMemo(() => {
    const source = selectedPlayerRow ?? players[0]
    return source ? interpolatePoint(source.points, currentTick)?.round_num : undefined
  }, [currentTick, players, selectedPlayerRow])

  const loadAnnotations = useCallback(async (name: string) => {
    const r = await fetchDemoMovementAnnotations(name)
    setAnnotations(r.httpStatus === 200 ? r.data.annotations ?? [] : [])
  }, [])

  const loadRender = useCallback(async (name: string) => {
    const r = await fetchDemoRender(name)
    setRenderStatus(r.data)
    const s = await fetchDemoSteamPlayback(name)
    setSteamStatus(s.data)
  }, [])

  const loadList = useCallback(async () => {
    const r = await fetchDemoMovementList()
    const rows = r.data.demos ?? []
    setDemos(rows)
    setParseMaxMb(r.data.parse_max_mb)
    if (!selected && rows[0]) setSelected(rows[0].name)
  }, [selected])

  const loadExisting = useCallback(async (name: string) => {
    if (!name) return
    setStatus(null)
    setPlaying(false)
    const r = await fetchDemoMovement(name)
    if (r.httpStatus === 200 && r.data.ok) {
      setPayload(r.data)
      const firstPlayer = r.data.players?.[0]
      setSelectedPlayer(firstPlayer?.steamid ?? undefined)
      const range = playerTickRange(r.data.players ?? [])
      setCurrentTick(range.min)
      setStatus("Loaded parsed movement artifact.")
      await loadAnnotations(name)
      await loadRender(name)
    } else if (r.httpStatus === 404) {
      setPayload(null)
      setSelectedPlayer(undefined)
      setAnnotations([])
      await loadRender(name)
      setStatus("Not parsed yet — run Parse movement.")
    } else {
      setStatus(r.data.detail ?? r.data.error ?? `Could not load movement (HTTP ${r.httpStatus}).`)
    }
  }, [loadAnnotations, loadRender])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (selected) void loadExisting(selected) }, [selected, loadExisting])

  useEffect(() => {
    if (!playing || !payload) return
    const range = Math.max(1, tickRange.max - tickRange.min)
    const step = Math.max(1, Math.round((range / 900) * speed))
    const id = window.setInterval(() => {
      setCurrentTick((t) => {
        const next = t + step
        if (next >= tickRange.max) {
          window.setTimeout(() => setPlaying(false), 0)
          return tickRange.max
        }
        return next
      })
    }, 50)
    return () => window.clearInterval(id)
  }, [playing, payload, speed, tickRange.max, tickRange.min])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement | null)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return
      if (!payload) return
      if (e.code === "Space") { e.preventDefault(); setPlaying((v) => !v) }
      if (e.key.toLowerCase() === "m") { e.preventDefault(); setDraft((d) => ({ ...d, startTick: currentTick, endTick: currentTick })) }
      if (e.key === "[") setDraft((d) => ({ ...d, startTick: currentTick }))
      if (e.key === "]") setDraft((d) => ({ ...d, endTick: currentTick }))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [currentTick, payload])

  async function parse(force = false) {
    if (!selected) return
    setBusy(true)
    setStatus("Parsing demo movement on ClarionCore…")
    try {
      const r = await postDemoMovementParse({ clipStorageName: selected, force, maxPointsPerPlayer: 900 })
      if (r.httpStatus === 200 && r.data.ok) {
        setPayload(r.data)
        setSelectedPlayer(r.data.players?.[0]?.steamid ?? undefined)
        const range = playerTickRange(r.data.players ?? [])
        setCurrentTick(range.min)
        setStatus(`${r.data.cached ? "Loaded cached" : "Parsed"} movement in ${fmtFixed(r.data.meta?.parse_elapsed_sec, 2)}s.`)
        await loadAnnotations(selected)
        await loadList()
      } else {
        setStatus(r.data.detail ?? r.data.error ?? `Parse failed (HTTP ${r.httpStatus}).`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function renderDemo(force = false) {
    if (!selected) return
    setRenderBusy(true)
    setStatus("Requesting full demo render…")
    try {
      const r = await postDemoRender(selected, force)
      setRenderStatus(r.data)
      if (r.httpStatus === 200 && r.data.rendered) {
        setStatus(r.data.cached ? "Loaded cached full render." : "Full render complete.")
      } else {
        setStatus(r.data.detail ?? r.data.error ?? `Render unavailable (HTTP ${r.httpStatus}).`)
      }
    } finally {
      setRenderBusy(false)
    }
  }

  async function openInSteamSession() {
    if (!selected) return
    setSteamBusy(true)
    setStatus("Handing demo to player Steam session…")
    try {
      const r = await postDemoSteamPlayback(selected)
      setSteamStatus(r.data)
      if (r.httpStatus === 200 && r.data.ok) {
        setStatus("Demo handed to the logged-in Steam/CS2 session.")
      } else {
        setStatus(r.data.detail ?? r.data.stderr ?? r.data.error ?? `Steam playback unavailable (HTTP ${r.httpStatus}).`)
      }
    } finally {
      setSteamBusy(false)
    }
  }

  function syncTickFromVideo() {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    const ratio = Math.max(0, Math.min(1, v.currentTime / v.duration))
    setCurrentTick(Math.round(tickRange.min + ratio * (tickRange.max - tickRange.min)))
  }

  async function saveAnnotation() {
    if (!selected || !draft.label.trim()) return
    const start = draft.startTick ?? currentTick
    const end = draft.endTick ?? currentTick
    setBusy(true)
    try {
      const r = await postDemoMovementAnnotation({
        clip_storage_name: selected,
        player_steamid: selectedPlayer ?? null,
        player_name: selectedPlayerRow?.name ?? null,
        start_tick: Math.min(start, end),
        end_tick: Math.max(start, end),
        label: draft.label,
        intent: draft.intent || null,
        phase: draft.phase || null,
        quality: draft.quality || null,
        note: draft.note || null,
      })
      if (r.httpStatus === 200 && r.data.ok) {
        setAnnotations(r.data.annotations ?? [])
        setDraft({ label: "", intent: "", phase: "", quality: draft.quality || "good", note: "" })
        setStatus("Saved manual playback label.")
      } else {
        setStatus(r.data.detail ?? r.data.error ?? `Label save failed (HTTP ${r.httpStatus}).`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function removeAnnotation(id: string) {
    if (!selected) return
    const r = await deleteDemoMovementAnnotation(selected, id)
    if (r.httpStatus === 200 && r.data.ok) setAnnotations(r.data.annotations ?? [])
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><RouteIcon className="size-5" /> Pro movement review</CardTitle>
              <CardDescription>Render full CS2 demo video, play it back, and save tick-range labels for pro review.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">parse cap {parseMaxMb ? `${parseMaxMb} MB` : "—"}</Badge>
              {payload?.cached ? <Badge variant="secondary">cached</Badge> : null}
              {annotations.length ? <Badge variant="secondary">{annotations.length} labels</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="movement-demo">Uploaded demo</Label>
              <Select value={selected || undefined} onValueChange={(v) => setSelected(v ?? "")} disabled={busy || demos.length === 0}>
                <SelectTrigger id="movement-demo"><SelectValue placeholder="Choose uploaded .dem" /></SelectTrigger>
                <SelectContent>{demos.map((d) => <SelectItem key={d.name} value={d.name}>{d.display_name} · {fmtInt(d.bytes)} bytes{d.movement_parsed ? " · parsed" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => void parse(false)} disabled={!selected || busy}>{busy ? <Loader2Icon className="size-4 animate-spin" /> : <ActivityIcon className="size-4" />} Parse movement</Button>
            <Button variant="outline" onClick={() => void parse(true)} disabled={!selected || busy}><RefreshCwIcon className="size-4" /> Re-parse</Button>
          </div>
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
          {selectedDemo ? <p className="text-xs text-muted-foreground">Source: {selectedDemo.display_name}</p> : null}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Full demo playback</CardTitle>
                <CardDescription>Open the demo in the player-owned Steam/CS2 session, or render an MP4 for browser playback. Labels use the synced tick estimate.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void openInSteamSession()} disabled={steamBusy || !selected}>{steamBusy ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />} Open in player Steam</Button>
                <Button variant="outline" onClick={() => void renderDemo(false)} disabled={renderBusy || !selected}>{renderBusy ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />} Render MP4</Button>
                <Button variant="outline" onClick={() => void renderDemo(true)} disabled={renderBusy || !selected}><RefreshCwIcon className="size-4" /> Re-render</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {steamStatus?.viewer_url ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Live Steam/CS2 desktop</span>
                  <a className="underline underline-offset-2" href={steamStatus.viewer_url} target="_blank" rel="noreferrer">Open full viewer</a>
                </div>
                <iframe
                  title="Biobase Steam CS2 playback desktop"
                  className="aspect-video w-full rounded-md border bg-black"
                  src={steamStatus.viewer_url}
                />
              </div>
            ) : renderStatus?.rendered && renderStatus.video_url ? (
              <video
                ref={videoRef}
                className="aspect-video w-full rounded-md border bg-black"
                src={renderStatus.video_url}
                controls
                onTimeUpdate={syncTickFromVideo}
                onSeeked={syncTickFromVideo}
              />
            ) : (
              <div className="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
                {renderStatus?.detail ?? "No full render MP4 yet. Click Render demo after a render worker is configured."}
              </div>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant={renderStatus?.rendered ? "secondary" : "outline"}>{renderStatus?.status ?? "render status unknown"}</Badge>
              <Badge variant={steamStatus?.steam_playback_configured ? "secondary" : "outline"}>{steamStatus?.status ?? "steam session unknown"}</Badge>
              <span>tick sync: {fmtInt(currentTick)} / {fmtInt(tickRange.max)}</span>
              {renderStatus?.bytes ? <span>{fmtInt(renderStatus.bytes)} bytes</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {payload?.summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Tick rows</p><p className="text-2xl font-semibold tabular-nums">{fmtInt(payload.summary.tick_rows)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Movement rows</p><p className="text-2xl font-semibold tabular-nums">{fmtInt(payload.summary.movement_rows)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Players</p><p className="text-2xl font-semibold tabular-nums">{fmtInt(payload.summary.players)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Labels</p><p className="text-2xl font-semibold tabular-nums">{fmtInt(annotations.length)}</p></CardContent></Card>
        </div>
      ) : null}

      {payload?.summary ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-base">Movement sync</CardTitle>
                <CardDescription>Secondary tick sync for labels. Use the full render video as the primary playback.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={selectedPlayer ?? "all"} onValueChange={(v) => setSelectedPlayer(!v || v === "all" ? undefined : v)}>
                  <SelectTrigger className="w-52"><SelectValue placeholder="All top players" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Top players overlay</SelectItem>{players.map((p) => <SelectItem key={p.steamid} value={p.steamid}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant={playing ? "secondary" : "default"} onClick={() => setPlaying((v) => !v)}>{playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}{playing ? "Pause" : "Play"}</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <MovementMap payload={payload} selectedSteamid={selectedPlayer} currentTick={currentTick} annotations={annotations} />
            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              <Input type="range" min={tickRange.min} max={tickRange.max} value={currentTick} onChange={(e) => setCurrentTick(Number(e.target.value))} />
              <div className="text-sm tabular-nums text-muted-foreground">tick {fmtInt(currentTick)} / {fmtInt(tickRange.max)}</div>
              <div className="text-sm text-muted-foreground">round {fmtInt(currentRound)}</div>
              <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="0.5">0.5x</SelectItem><SelectItem value="1">1x</SelectItem><SelectItem value="2">2x</SelectItem><SelectItem value="4">4x</SelectItem></SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {payload?.summary ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Manual label</CardTitle><CardDescription>Capture the current tick or a start/end range.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-5">
                <Input placeholder="Move label" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
                <Input placeholder="Intent" value={draft.intent} onChange={(e) => setDraft((d) => ({ ...d, intent: e.target.value }))} />
                <Input placeholder="Phase" value={draft.phase} onChange={(e) => setDraft((d) => ({ ...d, phase: e.target.value }))} />
                <Select value={draft.quality} onValueChange={(v) => setDraft((d) => ({ ...d, quality: v ?? "good" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="good">good</SelectItem><SelectItem value="mistake">mistake</SelectItem><SelectItem value="interesting">interesting</SelectItem><SelectItem value="team-dependent">team-dependent</SelectItem></SelectContent></Select>
                <Input placeholder="Note" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, startTick: currentTick }))}><FlagIcon className="size-4" /> Set start {draft.startTick ? fmtInt(draft.startTick) : ""}</Button>
                <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, endTick: currentTick }))}><FlagIcon className="size-4" /> Set end {draft.endTick ? fmtInt(draft.endTick) : ""}</Button>
                <Button onClick={() => void saveAnnotation()} disabled={!draft.label.trim() || busy}><SaveIcon className="size-4" /> Save label</Button>
                <span className="text-xs text-muted-foreground">Player: {selectedPlayerRow?.name ?? "overlay"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Saved labels</CardTitle><CardDescription>Click a label to jump playback to its start tick.</CardDescription></CardHeader>
            <CardContent>
              <div className="max-h-[260px] space-y-2 overflow-auto">
                {annotations.length === 0 ? <p className="text-sm text-muted-foreground">No labels yet.</p> : annotations.map((a) => (
                  <div key={a.id} className="rounded-md border p-2 text-sm hover:bg-muted/40" onClick={() => setCurrentTick(a.start_tick)}>
                    <div className="flex items-start justify-between gap-2"><div className="font-medium">{a.label}</div><Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); void removeAnnotation(a.id) }}><Trash2Icon className="size-4" /></Button></div>
                    <div className="text-xs text-muted-foreground">{a.player_name ?? "all players"} · {fmtInt(a.start_tick)}–{fmtInt(a.end_tick)} · {[a.intent, a.phase, a.quality].filter(Boolean).join(" · ")}</div>
                    {a.note ? <div className="mt-1 text-xs">{a.note}</div> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {players.length > 0 ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Player movement table</CardTitle><CardDescription>Ranked by estimated 3D travel units from sampled tick positions.</CardDescription></CardHeader>
          <CardContent>
            <div className="max-h-[420px] overflow-auto rounded-md border">
              <Table><TableHeader><TableRow><TableHead>Player</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Travel</TableHead><TableHead className="text-right">Ticks</TableHead><TableHead className="text-right">Trail points</TableHead></TableRow></TableHeader>
                <TableBody>{players.map((p: DemoMovementPlayer) => <TableRow key={p.steamid} className={selectedPlayer === p.steamid ? "bg-muted/40" : undefined} onClick={() => setSelectedPlayer(p.steamid)}><TableCell className="font-medium">{p.name}</TableCell><TableCell className="text-right tabular-nums">{fmtInt(p.rows)}</TableCell><TableCell className="text-right tabular-nums">{fmtFixed(p.travel_units, 0)}</TableCell><TableCell className="text-right tabular-nums">{fmtInt(p.first_tick)}–{fmtInt(p.last_tick)}</TableCell><TableCell className="text-right tabular-nums">{fmtInt(p.points?.length)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
