"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/context/auth-context"
import {
  fetchDemoExtractableFields,
  fetchUploadsList,
  postDemoParsePreview,
  postDemoParserCompare,
  type DemoFieldCatalogResponse,
  type DemoParsePreviewDiscovered,
  type DemoParsePreviewResponse,
  type ParserCompareParserResult,
  type ParserCompareResponse,
  type UploadListItem,
} from "@/lib/dashboard-api"
import {
  BoxIcon,
  CircleHelpIcon,
  FileSearchIcon,
  GitCompareIcon,
  Link2Icon,
  Loader2Icon,
  PackageIcon,
  RefreshCwIcon,
  ScanSearchIcon,
  ServerIcon,
  UploadIcon,
} from "lucide-react"

const EMPTY_DISCOVERY_ROWS: NonNullable<DemoParsePreviewResponse["discovery_rows"]> = []

const EMPTY_CATALOG_FIELDS: NonNullable<DemoFieldCatalogResponse["fields"]> = []

function DemoInputRow({
  icon: Icon,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <div
        className="text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/25"
        aria-hidden
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  )
}

function formatSampleCell(v: unknown): string {
  if (v === null || v === undefined) {
    return "—"
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false"
  }
  if (typeof v === "number") {
    return String(v)
  }
  return String(v)
}

function DemoDiscoveredStructuredView({ discovered }: { discovered: DemoParsePreviewDiscovered }) {
  const samples = discovered.header_field_samples
  const sampleEntries = samples ? Object.entries(samples) : []
  const gameEvents = discovered.list_game_events ?? []
  const updatedFields = discovered.list_updated_fields ?? []
  const evCols = discovered.event_columns_from_parse_event ?? {}
  const awpyEvents = discovered.awpy_events_tables ?? {}
  const derived = discovered.derived_tables ?? {}
  const tickCols = discovered.ticks_columns ?? []
  const roundCols = discovered.rounds_columns ?? []
  const grenCols = discovered.grenades_columns ?? []

  return (
    <div className="space-y-2">
      <details className="text-muted-foreground rounded-md border border-dashed border-border/70 bg-muted/10 text-xs">
        <summary className="hover:text-foreground cursor-pointer px-2 py-1.5 leading-snug select-none">
          Tables and columns from your last parse — tap for tips
        </summary>
        <div className="border-border border-t px-2 py-2 leading-relaxed">
          Header rows show truncated scalar previews. Other sections list names from awpy / demoparser2 parse
          output (events, ticks, grenades, etc.).
        </div>
      </details>

      {sampleEntries.length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Header fields (sample values, {sampleEntries.length} keys)
          </summary>
          <div className="border-border max-h-60 overflow-auto border-t">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[28%] text-xs">Key</TableHead>
                  <TableHead className="text-xs">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sampleEntries.map(([k, v]) => (
                  <TableRow key={k}>
                    <TableCell className="font-mono text-xs break-all">{k}</TableCell>
                    <TableCell className="text-muted-foreground text-xs break-all">
                      {formatSampleCell(v)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ) : null}

      {gameEvents.length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Game events (list_game_events) — {gameEvents.length}
          </summary>
          <div className="border-border max-h-48 overflow-auto border-t p-3">
            <ul className="font-mono text-xs leading-relaxed break-all space-y-0.5">
              {gameEvents.map((ev) => (
                <li key={ev}>{ev}</li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {updatedFields.length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Updated entity fields (list_updated_fields) — {updatedFields.length}
          </summary>
          <div className="border-border max-h-48 overflow-auto border-t p-3">
            <ul className="font-mono text-xs leading-relaxed break-all space-y-0.5">
              {updatedFields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {Object.keys(evCols).length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            parse_event columns (per game event)
          </summary>
          <div className="border-border max-h-72 space-y-2 overflow-auto border-t p-3">
            {Object.entries(evCols).map(([ev, cols]) => (
              <details key={ev} className="bg-background/40 rounded border border-border/80">
                <summary className="cursor-pointer px-2 py-1.5 font-mono text-xs select-none">{ev}</summary>
                <div className="max-h-36 overflow-auto border-t border-border/60 p-2">
                  {"error" in (cols as object) && (cols as { error?: string }).error ? (
                    <p className="text-destructive text-xs">{(cols as { error: string }).error}</p>
                  ) : (
                    <ul className="text-muted-foreground font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                      {(cols as string[]).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        </details>
      ) : null}

      {Object.keys(awpyEvents).length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            awpy events tables (post-parse DataFrames)
          </summary>
          <div className="border-border max-h-72 space-y-2 overflow-auto border-t p-3">
            {Object.entries(awpyEvents).map(([name, cols]) => (
              <details key={name} className="bg-background/40 rounded border border-border/80">
                <summary className="cursor-pointer px-2 py-1.5 font-mono text-xs select-none">
                  {name} ({cols.length} columns)
                </summary>
                <div className="max-h-36 overflow-auto border-t border-border/60 p-2">
                  <ul className="text-muted-foreground font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                    {cols.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </details>
      ) : null}

      {tickCols.length + roundCols.length + grenCols.length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Ticks / rounds / grenades columns
          </summary>
          <div className="border-border grid gap-3 border-t p-3 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground mb-1 text-[0.65rem] font-medium uppercase tracking-wide">
                ticks
              </p>
              <ul className="font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                {tickCols.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-[0.65rem] font-medium uppercase tracking-wide">
                rounds
              </p>
              <ul className="font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                {roundCols.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-muted-foreground mb-1 text-[0.65rem] font-medium uppercase tracking-wide">
                grenades
              </p>
              <ul className="font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                {grenCols.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      ) : null}

      {Object.keys(derived).length > 0 ? (
        <details className="bg-muted/15 border-border rounded-md border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Derived awpy tables
          </summary>
          <div className="border-border max-h-72 space-y-2 overflow-auto border-t p-3">
            {Object.entries(derived).map(([name, payload]) => (
              <details key={name} className="bg-background/40 rounded border border-border/80">
                <summary className="cursor-pointer px-2 py-1.5 font-mono text-xs select-none">{name}</summary>
                <div className="max-h-36 overflow-auto border-t border-border/60 p-2">
                  {payload.error ? (
                    <p className="text-destructive text-xs">{payload.error}</p>
                  ) : (
                    <ul className="text-muted-foreground font-mono text-[0.7rem] leading-relaxed break-all space-y-0.5">
                      {(payload.columns ?? []).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function isDemUploadItem(row: UploadListItem): boolean {
  const n = row.name.toLowerCase()
  const d = row.display_name.toLowerCase()
  return n.endsWith(".dem") || d.endsWith(".dem")
}

const PARSER_COMPARE_KEYS = ["awpy", "demoparser2", "demoinfocs_golang"] as const

function formatJsonPreview(v: unknown, cap = 12_000): string {
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > cap ? `${s.slice(0, cap)}\n… (truncated)` : s
  } catch {
    return String(v)
  }
}

function ParserCompareResultPane({ row }: { row: ParserCompareParserResult | undefined }) {
  if (!row) {
    return <p className="text-muted-foreground text-xs">No result for this parser.</p>
  }
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={row.skipped ? "outline" : row.ok ? "secondary" : "outline"}
          className="h-6 font-mono text-[0.65rem]"
        >
          {row.skipped ? "skipped" : row.ok ? "ok" : "error"}
        </Badge>
        {row.duration_ms != null ? (
          <span className="text-muted-foreground">{row.duration_ms.toFixed(1)} ms</span>
        ) : null}
        {row.exit_code != null ? (
          <span className="text-muted-foreground font-mono">exit {row.exit_code}</span>
        ) : null}
      </div>
      {row.error ? (
        <p className="text-destructive break-all leading-snug">
          {row.error}
          {row.hint ? ` — ${row.hint}` : ""}
        </p>
      ) : null}
      {row.summary && Object.keys(row.summary).length > 0 ? (
        <details className="rounded border border-border/70 bg-muted/15" open>
          <summary className="cursor-pointer px-2 py-1.5 font-medium select-none">Summary (JSON)</summary>
          <pre className="border-border max-h-48 overflow-auto border-t p-2 font-mono text-[0.7rem] leading-snug break-all whitespace-pre-wrap">
            {formatJsonPreview(row.summary)}
          </pre>
        </details>
      ) : null}
      <details className="rounded border border-border/60 bg-background/50">
        <summary className="text-muted-foreground cursor-pointer px-2 py-1.5 select-none">
          Raw stdout JSON / text
        </summary>
        <pre className="border-border max-h-40 overflow-auto border-t p-2 font-mono text-[0.65rem] break-all whitespace-pre-wrap">
          {row.stdout_json ? formatJsonPreview(row.stdout_json) : row.stdout_text || "—"}
        </pre>
      </details>
      {row.stderr_tail ? (
        <details className="rounded border border-destructive/35 bg-destructive/5">
          <summary className="cursor-pointer px-2 py-1.5 text-destructive select-none">stderr (tail)</summary>
          <pre className="text-muted-foreground max-h-32 overflow-auto border-t border-destructive/15 p-2 font-mono text-[0.65rem] whitespace-pre-wrap">
            {row.stderr_tail}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function DiscoveredFromDemoPanel({ authBlocked }: { authBlocked: boolean }) {
  const { refresh } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [clipStorageName, setClipStorageName] = useState("")
  const [demoUrl, setDemoUrl] = useState("")
  const [eventScanMax, setEventScanMax] = useState(80)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<DemoParsePreviewResponse | null>(null)
  const [previewStatus, setPreviewStatus] = useState(0)
  const [filter, setFilter] = useState("")
  const [demClips, setDemClips] = useState<UploadListItem[]>([])
  const [clipsBusy, setClipsBusy] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compare, setCompare] = useState<ParserCompareResponse | null>(null)
  const [compareHttp, setCompareHttp] = useState(0)

  const loadDemClips = useCallback(async () => {
    setClipsBusy(true)
    try {
      const d = await fetchUploadsList()
      if (d.httpStatus === 401) {
        await refresh()
        setDemClips([])
        return
      }
      if (d.ok && Array.isArray(d.items)) {
        setDemClips(d.items.filter(isDemUploadItem))
      } else {
        setDemClips([])
      }
    } finally {
      setClipsBusy(false)
    }
  }, [refresh])

  useEffect(() => {
    if (!authBlocked) {
      queueMicrotask(() => {
        void loadDemClips()
      })
    }
  }, [authBlocked, loadDemClips])

  const rows = preview?.discovery_rows ?? EMPTY_DISCOVERY_ROWS
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) {
      return rows
    }
    return rows.filter((r) => {
      return (
        r.group.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        (r.detail ?? "").toLowerCase().includes(q)
      )
    })
  }, [rows, filter])

  async function runParse() {
    const clip = clipStorageName.trim()
    const hasFile = Boolean(file)
    const hasUrl = demoUrl.trim().length > 0
    const n = (clip ? 1 : 0) + (hasFile ? 1 : 0) + (hasUrl ? 1 : 0)
    if (n === 0) {
      setPreview({
        error: "missing_input",
        detail: "Choose a clip on the server, upload a .dem, or enter demo_url.",
      })
      setPreviewStatus(400)
      return
    }
    if (n > 1) {
      setPreview({
        error: "too_many_inputs",
        detail: "Use only one of: server clip, file upload, or demo_url.",
      })
      setPreviewStatus(400)
      return
    }
    setBusy(true)
    setPreview(null)
    setPreviewStatus(0)
    try {
      const { httpStatus, data } = await postDemoParsePreview({
        clipStorageName: clip || undefined,
        file: !clip && hasFile ? file : undefined,
        demoUrl: !clip && !hasFile && hasUrl ? demoUrl : undefined,
        eventScanMax,
      })
      setPreview(data)
      setPreviewStatus(httpStatus)
    } finally {
      setBusy(false)
    }
  }

  async function runCompare() {
    const clip = clipStorageName.trim()
    const hasFile = Boolean(file)
    const hasUrl = demoUrl.trim().length > 0
    const n = (clip ? 1 : 0) + (hasFile ? 1 : 0) + (hasUrl ? 1 : 0)
    if (n === 0) {
      setCompare({
        error: "missing_input",
        detail: "Choose a clip on the server, upload a .dem, or enter demo_url.",
      })
      setCompareHttp(400)
      return
    }
    if (n > 1) {
      setCompare({
        error: "too_many_inputs",
        detail: "Use only one of: server clip, file upload, or demo_url.",
      })
      setCompareHttp(400)
      return
    }
    setCompareBusy(true)
    setCompare(null)
    setCompareHttp(0)
    try {
      const { httpStatus, data } = await postDemoParserCompare({
        clipStorageName: clip || undefined,
        file: !clip && hasFile ? file : undefined,
        demoUrl: !clip && !hasFile && hasUrl ? demoUrl : undefined,
      })
      setCompare(data)
      setCompareHttp(httpStatus)
    } finally {
      setCompareBusy(false)
    }
  }

  if (authBlocked) {
    return null
  }

  const m = preview?.meta
  const structured = preview?.discovered

  return (
    <Card size="sm" className="bg-card/80 ring-foreground/10">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-sm">Discovered from demo</CardTitle>
          <Tooltip>
            <TooltipTrigger
              className="text-muted-foreground hover:text-foreground inline-flex shrink-0 rounded-sm border-0 bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="About discovered fields"
            >
              <CircleHelpIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-xs text-left leading-snug">
              Runs awpy against one .dem to list header keys, events, and column names exposed by that file.
              Use the flat table below as a searchable index.
            </TooltipContent>
          </Tooltip>
        </div>
        <CardDescription className="text-xs leading-snug">
          Pick one demo source — server clip, upload, or URL — then parse.
        </CardDescription>
        <details className="text-xs">
          <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none underline-offset-2 hover:underline">
            Limits & setup
          </summary>
          <div className="text-muted-foreground mt-2 space-y-1.5 border-border border-l-2 pl-3 leading-relaxed">
            <p>
              Uses the same clips folder as the <span className="text-foreground">Upload</span> tab.{" "}
              <code className="text-foreground rounded bg-muted px-1 py-0.5 text-[0.65rem]">demo_url</code> only works
              when the server enables URL fetch (<span className="font-mono">BB_DEMO_PARSE_ALLOW_URL_FETCH</span>).
            </p>
            <p>
              <span className="font-mono text-foreground">event_scan_max</span> caps how many game events are scanned
              for <code className="text-foreground rounded bg-muted px-0.5 text-[0.65rem]">parse_event</code> columns
              (maximum 200). Default upload size ceiling is driven by{" "}
              <span className="font-mono">BB_DEMO_PARSE_MAX_MB</span>.
            </p>
          </div>
        </details>
      </CardHeader>
      <CardContent className="space-y-4">
        <DemoInputRow icon={ServerIcon}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="demo-clip-server" className="text-foreground flex items-center gap-1 text-xs font-medium">
                Server clip
                <Tooltip>
                  <TooltipTrigger
                    className="text-muted-foreground inline-flex shrink-0 rounded-sm border-0 bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="About server clips"
                  >
                    <CircleHelpIcon className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs leading-snug">
                    Uploaded <code className="text-background rounded px-1">.dem</code> files in the clips volume.
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Select
                value={clipStorageName || undefined}
                onValueChange={(v) => {
                  setClipStorageName(v ?? "")
                  setFile(null)
                  setFileInputKey((k) => k + 1)
                }}
              >
                <SelectTrigger
                  id="demo-clip-server"
                  size="sm"
                  className="h-8 w-full min-w-[12rem] text-xs"
                  disabled={busy || compareBusy}
                >
                  <SelectValue placeholder="Choose uploaded demo…" />
                </SelectTrigger>
                <SelectContent>
                  {demClips.length === 0 ? (
                    <SelectItem value="__no_demos__" disabled className="text-muted-foreground">
                      No .dem in clips — use Upload tab
                    </SelectItem>
                  ) : (
                    demClips.map((row) => (
                      <SelectItem key={row.name} value={row.name}>
                        {row.display_name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 px-2.5"
              disabled={busy || compareBusy || clipsBusy}
              onClick={() => void loadDemClips()}
            >
              {clipsBusy ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </DemoInputRow>

        <div className="grid gap-4 sm:grid-cols-2">
          <DemoInputRow icon={UploadIcon}>
            <Label htmlFor="demo-file" className="text-foreground text-xs font-medium">
              Upload .dem
            </Label>
            <Input
              key={fileInputKey}
              id="demo-file"
              type="file"
              accept=".dem,application/octet-stream"
              className="cursor-pointer text-xs file:mr-2 file:text-xs"
              onChange={(e) => {
                setClipStorageName("")
                setFile(e.target.files?.[0] ?? null)
              }}
              disabled={busy || compareBusy}
            />
          </DemoInputRow>
          <DemoInputRow icon={Link2Icon}>
            <div className="flex items-center gap-1">
              <Label htmlFor="demo-url" className="text-foreground text-xs font-medium">
                Demo URL
              </Label>
              <Tooltip>
                <TooltipTrigger
                  className="text-muted-foreground inline-flex shrink-0 rounded-sm border-0 bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="About demo URL"
                >
                  <CircleHelpIcon className="size-3" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs leading-snug">
                  Dev-only fetch when{" "}
                  <span className="font-mono">BB_DEMO_PARSE_ALLOW_URL_FETCH=1</span> is set on the server.
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="demo-url"
              placeholder="https://…"
              value={demoUrl}
              onChange={(e) => {
                setClipStorageName("")
                setDemoUrl(e.target.value)
              }}
              className="text-xs"
              disabled={busy || compareBusy}
              autoComplete="off"
            />
          </DemoInputRow>
        </div>

        <div className="flex gap-3">
          <div
            className="text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/25"
            aria-hidden
          >
            <ScanSearchIcon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label htmlFor="event-scan-max" className="text-foreground text-xs font-medium">
                  event_scan_max
                </Label>
                <Tooltip>
                  <TooltipTrigger
                    className="text-muted-foreground inline-flex shrink-0 rounded-sm border-0 bg-transparent p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label="About event_scan_max"
                  >
                    <CircleHelpIcon className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-left leading-snug">
                    Bounds how deeply <span className="font-mono">parse_event</span> probes game events for column
                    names (0–200). Lower is faster on huge demos.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                id="event-scan-max"
                type="number"
                min={0}
                max={200}
                value={eventScanMax}
                onChange={(e) => setEventScanMax(Number(e.target.value) || 0)}
                className="h-8 w-full min-w-[5.5rem] text-xs sm:w-28"
                disabled={busy || compareBusy}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || compareBusy}
              onClick={() => void runParse()}
              className="inline-flex h-8 gap-2"
            >
              {busy ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Parsing…
                </>
              ) : (
                <>
                  <FileSearchIcon className="size-4" />
                  Parse demo
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex gap-3">
          <div
            className="text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/25"
            aria-hidden
          >
            <GitCompareIcon className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || compareBusy}
              onClick={() => void runCompare()}
              className="inline-flex h-8 gap-2"
            >
              {compareBusy ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Comparing…
                </>
              ) : (
                <>
                  <GitCompareIcon className="size-4" />
                  Run parser compare
                </>
              )}
            </Button>
          </div>
        </div>

        {compareHttp === 401 ? (
          <p className="text-muted-foreground text-xs">Parser compare: unauthorized — sign in again.</p>
        ) : null}

        {compare?.error ? (
          <p className="text-destructive text-xs">
            {compare.error}
            {compare.detail ? ` — ${compare.detail}` : ""}
            {compareHttp ? ` (HTTP ${compareHttp})` : ""}
          </p>
        ) : null}

        {compare && !compare.error && compare.parsers ? (
          <div className="border-border bg-muted/20 space-y-2 rounded-md border p-3 text-xs">
            <p className="text-foreground flex items-center gap-2 font-medium">
              <GitCompareIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              Parser compare (awpy · LaihoE demoparser2 · demoinfocs-golang)
            </p>
            {compare.meta ? (
              <dl className="text-muted-foreground grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">SHA-256</dt>
                  <dd className="font-mono break-all">{compare.meta.sha256 ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Wall timeout</dt>
                  <dd>{compare.meta.timeout_sec ?? "—"}s</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Stdout cap</dt>
                  <dd>{compare.meta.max_stdout_bytes ?? "—"} bytes</dd>
                </div>
              </dl>
            ) : null}
            {compare.meta?.disclaimer ? (
              <p className="text-muted-foreground text-[0.7rem] leading-snug">{compare.meta.disclaimer}</p>
            ) : null}
            <Tabs defaultValue="awpy">
              <TabsList variant="line" className="h-auto min-h-8 w-full flex-wrap justify-start gap-1 sm:w-auto">
                <TabsTrigger value="awpy" className="px-2.5 text-xs">
                  Awpy
                </TabsTrigger>
                <TabsTrigger value="demoparser2" className="px-2.5 text-xs">
                  LaihoE
                </TabsTrigger>
                <TabsTrigger value="demoinfocs_golang" className="px-2.5 text-xs">
                  Go
                </TabsTrigger>
              </TabsList>
              {PARSER_COMPARE_KEYS.map((k) => (
                <TabsContent key={k} value={k} className="mt-2">
                  <ParserCompareResultPane row={compare.parsers?.[k]} />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        ) : null}

        {previewStatus === 401 ? (
          <p className="text-muted-foreground text-xs">Unauthorized — sign in again.</p>
        ) : null}

        {preview?.error ? (
          <p className="text-destructive text-xs">
            {preview.error}
            {preview.detail ? ` — ${preview.detail}` : ""}
            {previewStatus ? ` (HTTP ${previewStatus})` : ""}
          </p>
        ) : null}

        {m && !preview?.error ? (
          <div className="border-border bg-muted/30 space-y-3 rounded-md border p-3 text-xs">
            <p className="text-foreground flex items-center gap-2 font-medium">
              <FileSearchIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              Last parse
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-mono break-all">{m.source_filename ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bytes</dt>
                <dd>{m.bytes ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">SHA-256</dt>
                <dd className="font-mono break-all">{m.sha256 ?? "—"}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="h-6 gap-1 border-border/90 font-mono text-[0.7rem] leading-none">
                <PackageIcon className="text-muted-foreground size-3" aria-hidden />
                awpy {m.awpy_version ?? "—"}
              </Badge>
              <Badge variant="outline" className="h-6 gap-1 border-border/90 font-mono text-[0.7rem] leading-none">
                <BoxIcon className="text-muted-foreground size-3" aria-hidden />
                demoparser2 {m.demoparser2_version ?? "—"}
              </Badge>
            </div>
            {m.disclaimer ? (
              <details className="rounded border border-border/60 bg-background/40">
                <summary className="text-muted-foreground cursor-pointer px-2 py-1.5 text-[0.7rem] leading-snug select-none hover:text-foreground">
                  Parser disclaimer
                </summary>
                <p className="text-muted-foreground border-border border-t px-2 py-2 text-[0.7rem] leading-relaxed">
                  {m.disclaimer}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {structured && !preview?.error ? <DemoDiscoveredStructuredView discovered={structured} /> : null}

        {rows.length > 0 ? (
          <>
            <p className="text-muted-foreground text-xs font-medium">Flat index (all keys)</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">
                {filtered.length} of {rows.length} rows
                {filter.trim() ? " (filtered)" : ""}
              </p>
              <Input
                placeholder="Filter group / key / detail…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="sm:max-w-sm text-xs"
                aria-label="Filter discovered rows"
              />
            </div>
            <div className="max-h-[min(40vh,24rem)] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[22%]">Group</TableHead>
                    <TableHead className="w-[38%]">Key</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => (
                    <TableRow key={`${r.group}:${r.key}:${i}`}>
                      <TableCell className="text-xs">{r.group}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{r.key}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.detail ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function DemoSchemaSection() {
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalog, setCatalog] = useState<DemoFieldCatalogResponse | null>(null)
  const [catalogHttpStatus, setCatalogHttpStatus] = useState(0)
  const [filter, setFilter] = useState("")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setCatalogLoading(true)
      const { httpStatus: st, data } = await fetchDemoExtractableFields()
      if (!cancelled) {
        setCatalogHttpStatus(st)
        setCatalog(data)
        setCatalogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = catalog?.fields ?? EMPTY_CATALOG_FIELDS
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) {
      return rows
    }
    return rows.filter((r) => {
      return (
        r.path.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q) ||
        r.brief_type.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q)
      )
    })
  }, [rows, filter])

  const authBlocked = catalogHttpStatus === 401

  if (catalogLoading) {
    return (
      <div className="space-y-4">
        <DiscoveredFromDemoPanel authBlocked={false} />
        <div
          className="text-muted-foreground flex items-center gap-2 py-8"
          aria-busy="true"
          aria-label="Loading demo field catalog"
        >
          <Loader2Icon className="size-5 animate-spin" />
          <span className="text-sm">Loading demo field catalog…</span>
        </div>
      </div>
    )
  }

  if (authBlocked) {
    return (
      <div className="space-y-4">
        <DiscoveredFromDemoPanel authBlocked />
        <p className="text-muted-foreground text-sm">
          Session expired — sign out and sign in again to load the catalog.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <DiscoveredFromDemoPanel authBlocked={false} />

      {catalog?.error || !catalog?.fields?.length ? (
        <Card size="sm" className="bg-card/80 ring-foreground/10">
          <CardHeader>
            <CardTitle className="text-sm">Demo extractable fields — unavailable</CardTitle>
            <p className="text-muted-foreground text-xs leading-snug">
              The catalog requires awpy in the dashboard image. Build with{" "}
              <code className="text-foreground rounded bg-muted px-1 py-0.5 text-[0.7rem]">
                bb_cs2_dashboard/requirements.txt
              </code>{" "}
              (includes awpy). Response: {catalog?.error ?? "empty"}
              {catalog?.detail ? ` — ${catalog.detail}` : ""}
            </p>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-xs leading-relaxed">
            <p className="text-foreground font-medium">Verification checklist</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Rebuild the dashboard image after updating Python requirements.</li>
              <li>Confirm the container imports awpy (no slimmed runtime stripping deps).</li>
              <li>
                Use &quot;Discovered from demo&quot; above for per-demo columns (
                <code className="text-foreground rounded bg-muted px-1 py-0.5 text-[0.7rem]">
                  list_game_events
                </code>
                , parse_event).
              </li>
            </ol>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card size="sm" className="bg-card/80 ring-foreground/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Static catalog (awpy stack)</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Stable extractable paths from the bundled parsers — browse or filter below.
              </CardDescription>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className="border-border h-7 gap-1 border font-mono text-[0.7rem] tracking-tight"
                >
                  <PackageIcon className="text-muted-foreground size-3.5" aria-hidden />
                  awpy {catalog.meta?.awpy_version ?? "—"}
                </Badge>
                <Badge
                  variant="secondary"
                  className="border-border h-7 gap-1 border font-mono text-[0.7rem] tracking-tight"
                >
                  <BoxIcon className="text-muted-foreground size-3.5" aria-hidden />
                  demoparser2 {catalog.meta?.demoparser2_version ?? "—"}
                </Badge>
              </div>

              {catalog.meta?.disclaimer || catalog.meta?.extraction ? (
                <details className="text-muted-foreground mt-3 rounded-md border border-dashed border-border/70 bg-muted/10">
                  <summary className="hover:text-foreground cursor-pointer px-2 py-2 text-xs leading-snug select-none">
                    Disclaimer & wiring
                  </summary>
                  <div className="border-border border-t px-2 py-2 text-[0.7rem] leading-relaxed space-y-2">
                    {catalog.meta.disclaimer ? <p>{catalog.meta.disclaimer}</p> : null}
                    {catalog.meta.extraction ? (
                      <p>
                        <span className="text-foreground font-medium">Pipeline: </span>
                        {catalog.meta.extraction}
                      </p>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </CardHeader>
          </Card>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-xs">
              {filtered.length} of {rows.length} paths
              {filter.trim() ? " (filtered)" : ""}
            </p>
            <Input
              placeholder="Filter by path, group, type, notes…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="sm:max-w-sm"
              aria-label="Filter fields"
            />
          </div>

          <div className="max-h-[min(60vh,32rem)] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[40%]">Path</TableHead>
                  <TableHead className="w-[12%]">Type</TableHead>
                  <TableHead className="w-[18%]">Group</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.path}>
                    <TableCell className="font-mono text-xs break-all">{r.path}</TableCell>
                    <TableCell className="text-xs">{r.brief_type}</TableCell>
                    <TableCell className="text-xs">{r.group}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
