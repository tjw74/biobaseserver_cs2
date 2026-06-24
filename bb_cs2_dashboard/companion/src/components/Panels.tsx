import type { TimelineFrame } from "../types"

function Key({ label, active }: { label: string; active: boolean }) {
  return <span className={active ? "key active" : "key"}>{label}</span>
}

function StatCell({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`stat-cell${accent ? " accent" : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Badge({ status }: { status: "live" | "soon" | "idle" | "online" | "offline" }) {
  const label = status === "live" ? "live" : status === "online" ? "online" : status === "soon" ? "soon" : status === "offline" ? "offline" : "waiting"
  return <span className={`badge badge--${status}`}>{label}</span>
}

export function MovementPanel({ frame, live }: { frame: TimelineFrame; live: boolean }) {
  const m = frame.movement
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Movement</h2>
        <Badge status={live ? "live" : "idle"} />
      </div>
      <div className="stat-grid">
        <StatCell label="speed" value={m.speed} accent={m.speed > 200} />
        <StatCell label="counter-strafe" value={m.counterStrafeScore.toFixed(2)} />
        <StatCell label="path efficiency" value={m.pathEfficiency.toFixed(2)} />
        <StatCell label="tick" value={frame.currentTick} />
      </div>
      <div className="keys-row">
        <Key label="W" active={m.keys.w} />
        <Key label="A" active={m.keys.a} />
        <Key label="S" active={m.keys.s} />
        <Key label="D" active={m.keys.d} />
        <Key label="JUMP" active={m.keys.jump} />
        <Key label="DUCK" active={m.keys.crouch} />
      </div>
    </section>
  )
}

export function ServerPanel({ mapName, players, activePlayer, onPickPlayer }: {
  mapName?: string | null
  players: Array<{ userid: number; name: string; steamid: string | null; ping: number }>
  activePlayer?: string
  onPickPlayer: (name: string) => void
}) {
  const humans = players.filter((p) => p.steamid && p.steamid !== "BOT")
  const bots = players.length - humans.length
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Server</h2>
        <Badge status={mapName ? "online" : "offline"} />
      </div>
      <div className="server-meta">
        <span className="server-map">{mapName ?? "offline"}</span>
        {mapName && <span className="server-count">{humans.length} player{humans.length !== 1 ? "s" : ""}{bots > 0 ? ` · ${bots} bot${bots !== 1 ? "s" : ""}` : ""}</span>}
      </div>
      <div className="player-list">
        {humans.length === 0 && <p className="empty">No players on server.</p>}
        {humans.map((p) => (
          <button
            key={`${p.userid}-${p.name}`}
            type="button"
            className={activePlayer === p.name ? "player-row selected" : "player-row"}
            onClick={() => onPickPlayer(p.name)}
          >
            <span>{p.name}</span>
            <em>{p.ping}ms</em>
          </button>
        ))}
      </div>
    </section>
  )
}

export function ShootingPanel() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Shooting</h2>
        <Badge status="soon" />
      </div>
      <p className="panel-placeholder">Accuracy, spray control, and crosshair placement — coming in a future update.</p>
    </section>
  )
}
