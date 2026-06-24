import type { CompanionResolve, LiveMovementSample, LiveMovementStatus, LiveServerStatus, TimelineFrame } from "../types"

const API_BASE = "/admin"

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) {
    throw new Error(`http_${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchLiveStatus() {
  return fetchJson<LiveServerStatus>("/api/client/live/status")
}

export function fetchLiveMovement(player?: string, steamid?: string) {
  const params = new URLSearchParams()
  if (steamid?.trim()) params.set("steamid", steamid.trim())
  else if (player?.trim()) params.set("player", player.trim())
  const query = params.toString()
  return fetchJson<LiveMovementStatus>(
    `/api/client/live/movement${query ? `?${query}` : ""}`,
  )
}

export function resolveCompanionCode(code: string) {
  return fetchJson<CompanionResolve>(
    `/api/client/companion/resolve/${encodeURIComponent(code.trim().toUpperCase())}`,
  )
}

const historyBySteam = new Map<string, LiveMovementSample[]>()

function historyKey(sample: LiveMovementSample): string {
  return sample.steamid || sample.player || "unknown"
}

function remember(sample: LiveMovementSample): LiveMovementSample[] {
  const key = historyKey(sample)
  const next = [...(historyBySteam.get(key) ?? []), sample].slice(-24)
  historyBySteam.set(key, next)
  return next
}

function angleDiff(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360
  if (diff > 180) diff = 360 - diff
  return diff
}

function velocityHeading(vel: [number, number, number]): number | null {
  const [vx, vy] = vel
  if (Math.hypot(vx, vy) < 8) return null
  return (Math.atan2(vy, vx) * 180) / Math.PI
}

function inferKeys(sample: LiveMovementSample): LiveMovementSample["keys"] {
  const heading = velocityHeading(sample.vel)
  const yaw = sample.yaw ?? 0
  const speed2d = Math.hypot(sample.vel[0], sample.vel[1])
  if (heading === null) {
    return { w: false, a: false, s: false, d: false, crouch: false, jump: !sample.on_ground }
  }
  const rel = angleDiff(heading, yaw)
  return {
    w: rel <= 45 && speed2d > 8,
    s: rel >= 135 && speed2d > 8,
    a: rel > 45 && rel < 135 && sample.vel[0] < 0 && speed2d > 8,
    d: rel > 45 && rel < 135 && sample.vel[0] > 0 && speed2d > 8,
    crouch: false,
    jump: !sample.on_ground,
  }
}

function counterScore(history: LiveMovementSample[]): number {
  if (history.length < 2) return 0.5
  const current = history[history.length - 1]
  const previous = history[history.length - 2]
  const currentSpeed = Math.hypot(current.vel[0], current.vel[1])
  const previousSpeed = Math.hypot(previous.vel[0], previous.vel[1])
  if (currentSpeed < 40 || previousSpeed < 40) return 0.55
  const dot = current.vel[0] * previous.vel[0] + current.vel[1] * previous.vel[1]
  if (dot >= 0) return 0.45
  const alignment = Math.min(1, -dot / (currentSpeed * previousSpeed))
  return Number(Math.min(0.98, 0.55 + alignment * 0.4).toFixed(2))
}

function pathEfficiency(history: LiveMovementSample[]): number {
  if (history.length < 3) return 0.7
  const first = history[0]
  const last = history[history.length - 1]
  const straight = Math.hypot(last.pos[0] - first.pos[0], last.pos[1] - first.pos[1])
  let path = 0
  for (let i = 1; i < history.length; i += 1) {
    path += Math.hypot(history[i].pos[0] - history[i - 1].pos[0], history[i].pos[1] - history[i - 1].pos[1])
  }
  if (path <= 1) return 0.7
  return Number(Math.min(0.99, Math.max(0.2, straight / path)).toFixed(2))
}

export function enrichSample(sample: LiveMovementSample): LiveMovementSample {
  const history = remember(sample)
  return {
    ...sample,
    counterStrafeScore: counterScore(history),
    pathEfficiency: pathEfficiency(history),
    keys: inferKeys(sample),
  }
}

export function buildFrame(
  _status: LiveServerStatus | null,
  movement: LiveMovementSample | null | undefined,
): TimelineFrame {
  if (!movement) {
    return {
      currentTick: 0,
      currentTimeSec: 0,
      movement: {
        speed: 0,
        counterStrafeScore: 0,
        pathEfficiency: 0,
        keys: { w: false, a: false, s: false, d: false, crouch: false, jump: false },
      },
    }
  }
  const enriched = enrichSample(movement)
  const tick = enriched.tick ?? 0
  return {
    currentTick: tick,
    currentTimeSec: tick / 64,
    movement: {
      speed: Math.round(enriched.speed ?? 0),
      counterStrafeScore: enriched.counterStrafeScore ?? 0.5,
      pathEfficiency: enriched.pathEfficiency ?? 0.7,
      keys: enriched.keys ?? { w: false, a: false, s: false, d: false, crouch: false, jump: false },
    },
  }
}

const STORAGE_CODE = "biobase.companion.code"
const STORAGE_PLAYER = "biobase.companion.player"
const STORAGE_STEAMID = "biobase.companion.steamid"

export function loadSavedWatch(): { code?: string; player?: string; steamid?: string } {
  try {
    return {
      code: localStorage.getItem(STORAGE_CODE) ?? undefined,
      player: localStorage.getItem(STORAGE_PLAYER) ?? undefined,
      steamid: localStorage.getItem(STORAGE_STEAMID) ?? undefined,
    }
  } catch {
    return {}
  }
}

export function saveWatch(target: { code?: string; player?: string; steamid?: string }) {
  try {
    if (target.code) localStorage.setItem(STORAGE_CODE, target.code)
    else localStorage.removeItem(STORAGE_CODE)
    if (target.player) localStorage.setItem(STORAGE_PLAYER, target.player)
    else localStorage.removeItem(STORAGE_PLAYER)
    if (target.steamid) localStorage.setItem(STORAGE_STEAMID, target.steamid)
    else localStorage.removeItem(STORAGE_STEAMID)
  } catch {
    // ignore private mode
  }
}

export function parseRouteCode(): string | null {
  const match = window.location.pathname.match(/\/companion\/c\/([^/]+)/i)
  if (match?.[1]) return match[1].toUpperCase()
  const params = new URLSearchParams(window.location.search)
  const queryCode = params.get("code")
  return queryCode ? queryCode.toUpperCase() : null
}
