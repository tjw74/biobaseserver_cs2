"use client"

import { useMemo, useState } from "react"
import {
  Activity,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  Crosshair,
  DollarSign,
  Gauge,
  HeartPulse,
  ListChecks,
  MousePointer2,
  Radar,
  Shield,
  Target,
  Users,
  Zap,
} from "lucide-react"

type Status = "done" | "active" | "next" | "later"
type CategoryStatus = "ready" | "partial" | "planned"

interface RoadmapItem {
  title: string
  outcome: string
  status: Status
}

interface RoadmapPhase {
  id: string
  label: string
  title: string
  value: string
  status: Status
  items: RoadmapItem[]
}

interface PerformanceCategory {
  name: string
  icon: typeof Gauge
  status: CategoryStatus
  role: string
  metrics: string[]
}

const statusMeta: Record<Status, { label: string; dot: string; badge: string; text: string }> = {
  done: {
    label: "Done",
    dot: "bg-emerald-400",
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    text: "text-emerald-300",
  },
  active: {
    label: "Active",
    dot: "bg-amber-300",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    text: "text-amber-300",
  },
  next: {
    label: "Next",
    dot: "bg-sky-300",
    badge: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    text: "text-sky-300",
  },
  later: {
    label: "Later",
    dot: "bg-zinc-500",
    badge: "border-zinc-700 bg-zinc-900/60 text-zinc-400",
    text: "text-zinc-400",
  },
}

const categoryMeta: Record<CategoryStatus, { label: string; dot: string; badge: string }> = {
  ready: {
    label: "Ready",
    dot: "bg-emerald-400",
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  },
  partial: {
    label: "Partial",
    dot: "bg-amber-300",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  },
  planned: {
    label: "Planned",
    dot: "bg-zinc-500",
    badge: "border-zinc-700 bg-zinc-900/60 text-zinc-400",
  },
}

const phases: RoadmapPhase[] = [
  {
    id: "release-one",
    label: "Release 1",
    title: "Installable player client",
    value: "A CS2 player installs BioBase, connects, records or imports play, and sees useful performance feedback without operator help.",
    status: "active",
    items: [
      { title: "Windows desktop client", outcome: "Local CS2/demo workflow, overlay foundation, upload queue", status: "active" },
      { title: "Phone companion", outcome: "QR-linked glance display beside the monitor", status: "active" },
      { title: "Auto-update", outcome: "Player stays current without manual installers", status: "done" },
      { title: "Admin/server control", outcome: "Operator can manage maps, uploads, parser checks", status: "active" },
    ],
  },
  {
    id: "performance-review",
    label: "Core Value",
    title: "Single Performance Review cockpit",
    value: "The paid product becomes obvious when a player can see what cost rounds, what improved, and what to train next.",
    status: "next",
    items: [
      { title: "Top match summary", outcome: "Strength, weakness, costliest mistake, next improvement", status: "next" },
      { title: "Sticky category rail", outcome: "Movement → Biometrics visible without page switching", status: "next" },
      { title: "Expandable category sections", outcome: "Compact summaries first, deep detail only on demand", status: "next" },
      { title: "Replay-linked insights", outcome: "Every important metric can jump to tick/time context", status: "later" },
    ],
  },
  {
    id: "data-contract",
    label: "Data Contract",
    title: "Canonical metrics and confidence",
    value: "Each metric declares source, confidence, tick/time alignment, and whether it is observed or inferred.",
    status: "next",
    items: [
      { title: "12 category model", outcome: "Pro-player mental model is now canonical", status: "done" },
      { title: "Metric source map", outcome: "Demo parser, server telemetry, heuristic, biometric device", status: "next" },
      { title: "Movement + Aim first", outcome: "Foundational signals linked to replay and duel outcomes", status: "next" },
      { title: "Biometrics sync", outcome: "Body state aligned to round, duel, and tick context", status: "later" },
    ],
  },
  {
    id: "productization",
    label: "Scale",
    title: "Product hardening and server offering",
    value: "Move from lab-grade capability to a simple paid service with reliable install, support, and operational boundaries.",
    status: "later",
    items: [
      { title: "Signed release pipeline", outcome: "Trustworthy installs and updates", status: "later" },
      { title: "Account/device management", outcome: "Paid users, devices, sessions, entitlements", status: "later" },
      { title: "Self-hosted team server", outcome: "Optional package for teams that want their own instrumented CS2 server", status: "later" },
      { title: "Support/observability", outcome: "Fast diagnosis without bloating the app stack", status: "later" },
    ],
  },
]

const categories: PerformanceCategory[] = [
  { name: "Movement", icon: Gauge, status: "partial", role: "How efficiently the player moves and preserves duel readiness.", metrics: ["Velocity", "Strafing", "Bunny hops", "Counter-strafes", "Jumps", "Air control", "Positioning", "Movement efficiency"] },
  { name: "Aim", icon: Crosshair, status: "planned", role: "Whether the crosshair is ready before the fight starts.", metrics: ["Crosshair placement", "Head-level %", "Flick accuracy", "Spray control", "Spray transfer", "Burst accuracy", "Tap accuracy", "First bullet accuracy", "Crosshair travel", "Target acquisition", "Time to first shot", "Reaction time"] },
  { name: "Combat", icon: Target, status: "partial", role: "Outcome layer for kills, deaths, damage, openings, trades, and clutches.", metrics: ["Kills", "Deaths", "Assists", "ADR", "Damage dealt", "Damage taken", "Headshot %", "Opening duels", "Trade kills", "Trade deaths", "Multi-kills", "Clutches", "Time to kill", "Survival time"] },
  { name: "Utility", icon: Zap, status: "planned", role: "Value created by grenades and timing.", metrics: ["Flash effectiveness", "Teammates flashed", "Enemies flashed", "Smoke effectiveness", "Molotov effectiveness", "HE damage", "Utility damage", "Utility value per round", "Utility timing", "Lineup success"] },
  { name: "Positioning", icon: Radar, status: "planned", role: "Where the player wins, dies, rotates, peeks, and exposes themselves.", metrics: ["Heatmaps", "Angle hold time", "Angle win rate", "Time in cover", "Time exposed", "Peek locations", "Death locations", "Kill locations", "Rotation paths", "Distance traveled"] },
  { name: "Decision Making", icon: Brain, status: "planned", role: "Timing and risk quality across rotate, save, entry, retake, and re-peek decisions.", metrics: ["Rotate timing", "Save decisions", "Retake participation", "Entry timing", "Re-peek frequency", "Aggression score", "Risk score", "Opportunity conversion", "Decision latency"] },
  { name: "Economy", icon: DollarSign, status: "planned", role: "How money turns into round impact.", metrics: ["Buy efficiency", "Equipment value", "Weapon value", "Economy impact", "Save success", "Upgrade timing", "Cost per kill", "Cost per damage"] },
  { name: "Teamplay", icon: Users, status: "planned", role: "Trade structure, spacing, support timing, and crossfire value.", metrics: ["Trade percentage", "Spacing", "Distance to teammates", "Support effectiveness", "Flash assists", "Crossfires", "Bait deaths", "Refrag timing", "Site support timing"] },
  { name: "Round Performance", icon: Shield, status: "planned", role: "Round-level contribution to winning, objective play, entry, clutch, and momentum.", metrics: ["Round impact score", "MVP rounds", "Win contribution", "Objective contribution", "Bomb plants", "Defuses", "Entry impact", "Clutch impact", "Momentum"] },
  { name: "Consistency", icon: Activity, status: "planned", role: "Trend, variance, confidence, fatigue, tilt, and repeatability.", metrics: ["Performance trend", "Round-to-round variance", "Aim consistency", "Movement consistency", "Decision consistency", "Utility consistency", "Confidence score", "Fatigue score", "Tilt indicator"] },
  { name: "Mechanical Execution", icon: MousePointer2, status: "planned", role: "Input discipline and weapon-handling habits that silently cost fights.", metrics: ["Reload timing", "Weapon switching", "Scope timing", "Accuracy recovery", "Weapon handling", "Input efficiency", "Idle time", "APM"] },
  { name: "BioBase Biometrics", icon: HeartPulse, status: "planned", role: "Body-state context synced to game clock: stress, fatigue, focus, and load.", metrics: ["Heart rate", "HRV", "Respiration", "Skin temperature", "Skin conductance", "Eye tracking", "Blink rate", "Pupil dilation", "Posture", "Hand tremor", "Muscle tension", "Fatigue", "Cognitive load", "Focus score", "Stress score"] },
]

function StatusBadge({ status }: { status: Status }) {
  const meta = statusMeta[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

function CategoryBadge({ status }: { status: CategoryStatus }) {
  const meta = categoryMeta[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.badge}`}>
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

export function RoadmapSection() {
  const [openCategory, setOpenCategory] = useState("Movement")
  const counts = useMemo(() => {
    const items = phases.flatMap((phase) => phase.items)
    return {
      done: items.filter((item) => item.status === "done").length,
      active: items.filter((item) => item.status === "active").length,
      next: items.filter((item) => item.status === "next").length,
      later: items.filter((item) => item.status === "later").length,
      metrics: categories.reduce((n, c) => n + c.metrics.length, 0),
    }
  }, [])

  return (
    <div className="min-h-full bg-[#070a0f] text-zinc-100">
      <div className="border-b border-white/10 bg-[#0a0f17] px-4 py-4 md:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">Board roadmap</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">BioBase first release</h1>
            <p className="mt-1.5 text-sm leading-6 text-zinc-400">
              Installable CS2 performance review for serious players: local desktop client, companion display,
              replay-linked analytics, and a single low-cognitive-load cockpit for what to improve next.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] md:w-[360px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2"><div className="text-lg font-semibold tabular-nums">{counts.done}</div><div className="text-zinc-500">done</div></div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2"><div className="text-lg font-semibold tabular-nums">{counts.active}</div><div className="text-zinc-500">active</div></div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2"><div className="text-lg font-semibold tabular-nums">{counts.next}</div><div className="text-zinc-500">next</div></div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2"><div className="text-lg font-semibold tabular-nums">{counts.metrics}</div><div className="text-zinc-500">metrics</div></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 md:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-4">
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-sky-300" />
              <h2 className="text-sm font-semibold">Operating thesis</h2>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">Vision</div>
                <p className="mt-1 text-sm text-zinc-300">A coaching instrument that shows why rounds were won or lost and what to train next.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">Paid value</div>
                <p className="mt-1 text-sm text-zinc-300">Players pay for insight they cannot get from demos alone: movement, aim, decisions, teamplay, and biometrics in one timeline.</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">Design rule</div>
                <p className="mt-1 text-sm text-zinc-300">One Performance Review screen. Compact category summaries. Deep detail only when requested.</p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Release roadmap</h2>
              <span className="text-[11px] text-zinc-500">Checklist view</span>
            </div>
            {phases.map((phase) => {
              const meta = statusMeta[phase.status]
              return (
                <article key={phase.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                        <span>{phase.label}</span>
                        <span className={`size-1.5 rounded-full ${meta.dot}`} />
                        <span className={meta.text}>{meta.label}</span>
                      </div>
                      <h3 className="mt-1 text-base font-semibold">{phase.title}</h3>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">{phase.value}</p>
                    </div>
                    <StatusBadge status={phase.status} />
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {phase.items.map((item) => {
                      const done = item.status === "done"
                      return (
                        <div key={item.title} className="flex gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
                          {done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" /> : <Circle className="mt-0.5 size-4 shrink-0 text-zinc-600" />}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{item.title}</p>
                              <StatusBadge status={item.status} />
                            </div>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">{item.outcome}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </article>
              )
            })}
          </section>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-3 xl:self-start">
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Performance categories</h2>
              <span className="text-[11px] text-zinc-500">expandable</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              Canonical pro-player model. The app should keep these on one screen through the category rail, not force page switching.
            </p>
            <div className="mt-3 space-y-1.5">
              {categories.map((category) => {
                const Icon = category.icon
                const open = openCategory === category.name
                return (
                  <div key={category.name} className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenCategory(open ? "" : category.name)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.03]"
                    >
                      <Icon className="size-4 shrink-0 text-sky-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{category.name}</span>
                          <CategoryBadge status={category.status} />
                        </div>
                        <p className="truncate text-[11px] text-zinc-500">{category.role}</p>
                      </div>
                      <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                    {open ? (
                      <div className="border-t border-white/10 px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {category.metrics.map((metric) => (
                            <span key={metric} className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
                              {metric}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
