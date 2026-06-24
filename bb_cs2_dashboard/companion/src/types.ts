export interface LiveServerPlayer {
  userid: number
  name: string
  steamid: string | null
  ping: number
  state: string
}

export interface LiveServerStatus {
  ok: boolean
  map?: string | null
  hostname?: string | null
  players?: LiveServerPlayer[]
  polledAt?: string
  error?: string
  detail?: string
}

export interface LiveMovementKeys {
  w: boolean
  a: boolean
  s: boolean
  d: boolean
  crouch: boolean
  jump: boolean
}

export interface LiveMovementSample {
  player?: string
  steamid: string
  tick: number
  pos: [number, number, number]
  vel: [number, number, number]
  speed: number
  yaw?: number
  pitch?: number
  on_ground: boolean
  observedAt?: string
  counterStrafeScore?: number
  pathEfficiency?: number
  keys?: LiveMovementKeys
}

export interface LiveMovementStatus {
  ok: boolean
  polledAt?: string
  samples: LiveMovementSample[]
  tracked?: LiveMovementSample | null
  error?: string | null
}

export interface TimelineFrame {
  currentTick: number
  currentTimeSec: number
  movement: {
    speed: number
    counterStrafeScore: number
    pathEfficiency: number
    keys: LiveMovementKeys
  }
}

export interface CompanionResolve {
  ok: boolean
  code: string
  playerName: string
  steamid: string
}
