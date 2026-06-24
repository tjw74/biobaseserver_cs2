"use client"

import { useMemo, useState } from "react"
import {
  Activity,
  BarChart3,
  Brain,
  Crosshair,
  Database,
  HeartPulse,
  MessageSquare,
  PieChart,
  RadioTower,
  Shield,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react"

type DatasetStatus = "live" | "partial" | "planned"

type DatasetCategory = {
  id: string
  label: string
  status: DatasetStatus
  score: number
  trend: string
  icon: LucideIcon
  source: string
  value: string
  next: string
  metrics: string[]
  lenses: string[]
}

const statusLabel: Record<DatasetStatus, string> = {
  live: "Live",
  partial: "Partial",
  planned: "Planned",
}

const statusClass: Record<DatasetStatus, string> = {
  live: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  partial: "border-sky-400/35 bg-sky-400/10 text-sky-200",
  planned: "border-zinc-500/30 bg-zinc-500/10 text-zinc-300",
}

const categories: DatasetCategory[] = [
  {
    id: "movement",
    label: "Movement",
    status: "live",
    score: 72,
    trend: "+6",
    icon: Activity,
    source: "demo parser + live telemetry",
    value: "Counter-strafe, pathing, velocity control",
    next: "Promote existing Pro movement review into first paid-quality deep dive.",
    metrics: ["counter-strafe grade", "time-to-stop", "peek speed", "path efficiency", "air time", "silent time", "spawn route delta", "angle exposure"],
    lenses: ["entry timing", "duel readiness", "route discipline", "noise risk"],
  },
  {
    id: "aim",
    label: "Aim",
    status: "partial",
    score: 58,
    trend: "+2",
    icon: Crosshair,
    source: "demo events + derived crosshair context",
    value: "Shot quality, first-bullet value, target acquisition",
    next: "Define first-shot quality and miss-cost model before building raw spray charts.",
    metrics: ["first bullet hit", "time-to-damage", "headshot opportunity", "spray recovery", "crosshair placement", "flick distance", "micro-correction", "trade aim"],
    lenses: ["opening bullet", "correction cost", "target priority", "duel conversion"],
  },
  {
    id: "combat",
    label: "Combat",
    status: "partial",
    score: 61,
    trend: "+1",
    icon: Zap,
    source: "kills, damage, trade windows, round context",
    value: "Duel selection, damage value, trade impact",
    next: "Rank fights by cost to round outcome, not raw kill count.",
    metrics: ["opening duel value", "trade window", "damage before death", "multi-kill leverage", "assist value", "refrag availability", "duel isolation", "clutch pressure"],
    lenses: ["fight quality", "trade discipline", "round leverage", "survivable damage"],
  },
  {
    id: "survival",
    label: "Survival",
    status: "planned",
    score: 44,
    trend: "0",
    icon: Shield,
    source: "death events + exposure timeline",
    value: "Deaths that were avoidable, late, early, or high-cost",
    next: "Separate acceptable role deaths from repeated avoidable deaths.",
    metrics: ["avoidable death", "death timing", "isolation death", "post-plant life", "save correctness", "utility in hand", "low-impact death", "repeat location death"],
    lenses: ["life value", "timing risk", "role context", "repeat mistakes"],
  },
  {
    id: "economy",
    label: "Economy",
    status: "planned",
    score: 50,
    trend: "0",
    icon: Wallet,
    source: "round state + buys + equipment value",
    value: "Buy quality, save discipline, weapon value",
    next: "Model team economy decisions before exposing individual spend grades.",
    metrics: ["buy alignment", "force quality", "save value", "drop support", "weapon ROI", "armor discipline", "utility spend", "eco damage"],
    lenses: ["team buy", "risk budget", "weapon leverage", "save/force"],
  },
  {
    id: "objective",
    label: "Objective",
    status: "planned",
    score: 47,
    trend: "0",
    icon: Target,
    source: "bomb, plant, defuse, site control events",
    value: "Round-winning objective contribution",
    next: "Build site-control and post-plant timelines before broad scoring.",
    metrics: ["site entry", "plant support", "defuse denial", "retake value", "post-plant position", "bomb carrier safety", "rotation timing", "objective conversion"],
    lenses: ["site control", "post-plant", "retake", "conversion"],
  },
  {
    id: "utility",
    label: "Utility",
    status: "planned",
    score: 43,
    trend: "0",
    icon: RadioTower,
    source: "grenade throws + combat timing",
    value: "Utility that creates or protects value",
    next: "Score utility by outcome window instead of counting throws.",
    metrics: ["flash assist", "enemy blinded time", "smoke gap", "molotov delay", "nade damage", "execute timing", "retake utility", "wasted utility"],
    lenses: ["creation", "denial", "timing", "waste"],
  },
  {
    id: "teamplay",
    label: "Teamplay",
    status: "planned",
    score: 55,
    trend: "0",
    icon: Users,
    source: "proximity, trades, role timing, team events",
    value: "Spacing, support, trading, coordinated pressure",
    next: "Use pair/trio windows; avoid generic teamwork scores.",
    metrics: ["trade spacing", "bait risk", "support timing", "crossfire setup", "swing sync", "lurk timing", "pack spacing", "assist chain"],
    lenses: ["spacing", "support", "coordination", "role fit"],
  },
  {
    id: "communication",
    label: "Communication",
    status: "planned",
    score: 35,
    trend: "0",
    icon: MessageSquare,
    source: "future voice/comms review + event correlation",
    value: "Information timing and callout usefulness",
    next: "Keep out of first release unless capture/consent pipeline is explicit.",
    metrics: ["callout timing", "info accuracy", "silence cost", "repeat call", "clutch comms", "utility call", "rotation call", "death info"],
    lenses: ["info value", "timing", "clarity", "comms load"],
  },
  {
    id: "cognition",
    label: "Cognition",
    status: "planned",
    score: 46,
    trend: "0",
    icon: Brain,
    source: "derived decision model + round state",
    value: "Decision quality under pressure and uncertainty",
    next: "Start with explainable decision flags, not black-box cognitive score.",
    metrics: ["rotation choice", "risk selection", "time awareness", "man-advantage play", "clutch option", "re-peek discipline", "utility recall", "pattern adaptation"],
    lenses: ["decision cost", "pressure", "adaptation", "awareness"],
  },
  {
    id: "consistency",
    label: "Consistency",
    status: "partial",
    score: 63,
    trend: "+3",
    icon: TrendingUp,
    source: "session history + quantiles",
    value: "Repeatability, volatility, streaks, regression risk",
    next: "Prioritize quantile-ranked rarity over raw averages.",
    metrics: ["session volatility", "map-to-map delta", "role repeatability", "warmup decay", "tilt signal", "metric floor", "metric ceiling", "historical percentile"],
    lenses: ["floor", "ceiling", "volatility", "rarity"],
  },
  {
    id: "biometrics",
    label: "Biometrics",
    status: "planned",
    score: 29,
    trend: "0",
    icon: HeartPulse,
    source: "future bio/EMG sync",
    value: "Physiology tied to round, duel, and pressure windows",
    next: "Treat as differentiator after game-performance loop is valuable alone.",
    metrics: ["arousal window", "recovery time", "stress spike", "breathing stability", "fatigue drift", "EMG timing", "pressure response", "bio-to-error link"],
    lenses: ["pressure", "fatigue", "recovery", "signal confidence"],
  },
]

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-200"
  if (score >= 55) return "text-sky-200"
  if (score >= 40) return "text-amber-200"
  return "text-zinc-300"
}

export function PerformanceDatasetsSection({ onOpenMovement }: { onOpenMovement?: () => void }) {
  const [active, setActive] = useState(categories[0].id)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ movement: true, aim: true, combat: true })

  const activeCategory = useMemo(
    () => categories.find((category) => category.id === active) ?? categories[0],
    [active],
  )

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <section className="min-h-full bg-[#070a0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 md:px-5 md:py-5">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/25">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
                <Database className="size-3.5" /> Performance datasets
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-white">First-release analytics cockpit</h2>
              <p className="max-w-3xl text-sm leading-6 text-zinc-400">
                One operating view for the twelve BioBase datasets. Each category is a dashboard lens, not a separate product surface.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-right text-xs md:min-w-72">
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-lg font-semibold text-white">12</div>
                <div className="text-zinc-500">datasets</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-lg font-semibold text-white">121</div>
                <div className="text-zinc-500">target metrics</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-lg font-semibold text-emerald-200">1</div>
                <div className="text-zinc-500">screen</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3">
              <div className="text-xs text-emerald-200/70">Primary wedge</div>
              <div className="mt-1 text-sm font-medium text-emerald-100">Movement → Aim → Combat</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-500">Current focus</div>
              <div className="mt-1 text-sm font-medium text-zinc-100">Performance Review loop</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-500">Measurement standard</div>
              <div className="mt-1 text-sm font-medium text-zinc-100">Context + quantile + cost</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-500">Product rule</div>
              <div className="mt-1 text-sm font-medium text-zinc-100">No raw-stat card soup</div>
            </div>
          </div>
        </div>

        <div className="sticky top-0 z-10 -mx-3 border-y border-white/10 bg-[#070a0f]/95 px-3 py-2 backdrop-blur md:-mx-5 md:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {categories.map((category) => {
              const Icon = category.icon
              const isActive = category.id === active
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActive(category.id)}
                  className={`flex min-w-36 items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    isActive
                      ? "border-sky-300/50 bg-sky-400/15 text-white"
                      : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-100"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{category.label}</span>
                    <span className="block text-[11px] text-zinc-500">{statusLabel[category.status]} · {category.score}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            {categories.map((category) => {
              const Icon = category.icon
              const isExpanded = !!expanded[category.id]
              return (
                <article
                  key={category.id}
                  id={`dataset-${category.id}`}
                  className={`rounded-xl border bg-white/[0.025] transition ${
                    active === category.id ? "border-sky-300/35" : "border-white/10"
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => {
                      setActive(category.id)
                      toggle(category.id)
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <Icon className="size-5 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-base font-semibold text-white">{category.label}</h3>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass[category.status]}`}>
                          {statusLabel[category.status]}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-zinc-400">{category.value}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-semibold tabular-nums ${scoreTone(category.score)}`}>{category.score}</div>
                      <div className="text-[11px] text-zinc-500">trend {category.trend}</div>
                    </div>
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-white/10 px-4 pb-4 pt-3">
                      <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Initial metric lens</div>
                            <div className="text-xs text-zinc-500">{category.source}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {category.metrics.map((metric) => (
                              <span key={metric} className="rounded-md border border-white/10 bg-white/[0.035] px-2 py-1 text-xs text-zinc-300">
                                {metric}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                          <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Decision lenses</div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {category.lenses.map((lens) => (
                              <div key={lens} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-2 text-xs text-zinc-300">
                                {lens}
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-md border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100/80">
                            {category.next}
                          </div>
                          {category.id === "movement" && onOpenMovement ? (
                            <button
                              type="button"
                              onClick={onOpenMovement}
                              className="mt-3 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-300/15"
                            >
                              Open movement deep dive
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          <aside className="h-fit rounded-xl border border-white/10 bg-white/[0.03] p-4 lg:sticky lg:top-20">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BarChart3 className="size-4" /> Active lens
            </div>
            <div className="mt-4 flex items-start gap-3">
              <activeCategory.icon className="mt-1 size-5 text-sky-200" />
              <div>
                <div className="text-lg font-semibold text-white">{activeCategory.label}</div>
                <div className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${statusClass[activeCategory.status]}`}>
                  {statusLabel[activeCategory.status]}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <div>
                <div className="text-xs text-zinc-500">Why it matters</div>
                <p className="mt-1 leading-6">{activeCategory.value}</p>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Next build decision</div>
                <p className="mt-1 leading-6">{activeCategory.next}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>Score</span>
                  <PieChart className="size-3.5" />
                </div>
                <div className={`mt-1 text-3xl font-semibold tabular-nums ${scoreTone(activeCategory.score)}`}>
                  {activeCategory.score}
                </div>
                <div className="mt-1 text-xs text-zinc-500">Placeholder readiness score until live dataset coverage is wired.</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
