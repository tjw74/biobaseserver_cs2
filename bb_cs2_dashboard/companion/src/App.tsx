import { useEffect, useMemo, useState } from "react"
import { MovementPanel, ServerPanel, ShootingPanel } from "./components/Panels"
import {
  buildFrame,
  enrichSample,
  fetchLiveMovement,
  fetchLiveStatus,
  loadSavedWatch,
  parseRouteCode,
  resolveCompanionCode,
  saveWatch,
} from "./lib/api"
import type { LiveMovementStatus, LiveServerStatus } from "./types"
import "./styles.css"

type WatchTarget = {
  code?: string
  player: string
  steamid?: string
}

function initialTarget(): WatchTarget | null {
  const routeCode = parseRouteCode()
  const saved = loadSavedWatch()
  if (routeCode) return { code: routeCode, player: saved.player ?? "", steamid: saved.steamid }
  if (saved.player) return { code: saved.code, player: saved.player, steamid: saved.steamid }
  return null
}

export default function App() {
  const [target, setTarget] = useState<WatchTarget | null>(() => initialTarget())
  const [status, setStatus] = useState<LiveServerStatus | null>(null)
  const [movement, setMovement] = useState<LiveMovementStatus | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)

  const applyTarget = (next: WatchTarget) => {
    saveWatch(next)
    setTarget(next)
    if (next.code) window.history.replaceState({}, "", `/companion/c/${next.code}`)
    else window.history.replaceState({}, "", "/companion/")
  }

  useEffect(() => {
    const code = parseRouteCode() ?? loadSavedWatch().code
    if (!code) return
    let active = true
    void resolveCompanionCode(code)
      .then((resolved) => {
        if (!active) return
        applyTarget({ code: resolved.code, player: resolved.playerName, steamid: resolved.steamid || undefined })
      })
      .catch(() => { if (active) setBootError("Companion link expired or not found.") })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const poll = async () => {
      try { const next = await fetchLiveStatus(); if (active) setStatus(next) }
      catch { if (active) setStatus({ ok: false, error: "network_error" }) }
    }
    poll()
    const timer = window.setInterval(poll, 2000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!target?.player && !target?.steamid) return
    let active = true
    const poll = async () => {
      try {
        const next = await fetchLiveMovement(target.player, target.steamid)
        if (next.tracked) next.tracked = enrichSample(next.tracked)
        if (active) setMovement(next)
      } catch { if (active) setMovement({ ok: false, samples: [], error: "network_error" }) }
    }
    poll()
    const timer = window.setInterval(poll, 500)
    return () => { active = false; window.clearInterval(timer) }
  }, [target?.player, target?.steamid])

  const tracked = movement?.tracked ?? movement?.samples?.[0] ?? null
  const frame = useMemo(() => buildFrame(status, tracked), [status, tracked])
  const live = Boolean(movement?.ok && tracked)
  const playerName = target?.player || tracked?.player || ""

  const pickPlayer = (name: string) => {
    const steamid = status?.players?.find((p) => p.name === name)?.steamid ?? undefined
    applyTarget({ player: name, steamid: steamid ?? undefined })
    setBootError(null)
  }

  if (!target?.player && !target?.code) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="topbar-brand">Biobase</div>
          <span className="topbar-sub">Companion</span>
        </header>
        <main className="content">
          <p className="lead">Scan the QR from Biobase on your PC, or pick a player below.</p>
          <ServerPanel mapName={status?.map} players={status?.players ?? []} onPickPlayer={pickPlayer} />
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="topbar-brand">Biobase</div>
          <span className="topbar-sub">{playerName || "Connecting…"}</span>
        </div>
        {live && <span className="live-pill">LIVE</span>}
      </header>

      {bootError && <p className="error">{bootError}</p>}
      {!live && movement?.error && !bootError && (
        <p className="warn">Waiting for movement data from {playerName || "player"}…</p>
      )}

      <main className="content">
        <div className="grid">
          <MovementPanel frame={frame} live={live} />
          <ServerPanel
            mapName={status?.map}
            players={status?.players ?? []}
            activePlayer={playerName}
            onPickPlayer={pickPlayer}
          />
          <div className="grid-full">
            <ShootingPanel />
          </div>
        </div>
      </main>
    </div>
  )
}
