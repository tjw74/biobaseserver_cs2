const cred: RequestCredentials = "include"

/** Vite `base` (e.g. `/admin/`) so API paths work when hosted under a URL prefix on the same host. */
function apiPrefix(): string {
  const raw = import.meta.env.BASE_URL
  if (raw && raw !== "/") {
    return raw.endsWith("/") ? raw : `${raw}/`
  }
  // Built with base `/`: infer prefix from `<base href>` (Vite injects it) or from the browser path.
  if (typeof document !== "undefined") {
    const href = document.querySelector("base")?.getAttribute("href")
    if (href) {
      try {
        const path = new URL(href, window.location.origin).pathname
        if (path && path !== "/") {
          return path.endsWith("/") ? path : `${path}/`
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof window !== "undefined") {
    const p = window.location.pathname
    if (p === "/admin" || p.startsWith("/admin/")) {
      return "/admin/"
    }
  }
  return "/"
}

function apiUrl(subpath: string): string {
  const p = subpath.startsWith("/") ? subpath.slice(1) : subpath
  return `${apiPrefix()}${p}`
}

function headers(json = false): HeadersInit {
  const h: Record<string, string> = {}
  if (json) {
    h.Accept = "application/json"
  }
  return h
}

function fastApiDetailString(detail: unknown): string | undefined {
  if (typeof detail === "string") {
    return detail
  }
  if (Array.isArray(detail) && detail[0] != null) {
    const row = detail[0] as { msg?: string }
    if (typeof row.msg === "string") {
      return row.msg
    }
  }
  return undefined
}

export type StatusResponse = {
  headline?: string
  humans?: number | null
  bots?: number | null
  map?: string | null
  hostname?: string | null
  rcon_ok?: boolean
  error?: string
  detail?: string
  raw?: string
}

export function authLoginUrl(): string {
  return apiUrl("/api/auth/login")
}

export async function fetchAuthMe(): Promise<{
  authenticated: boolean
  login_required: boolean
}> {
  const r = await fetch(apiUrl("/api/auth/me"), { credentials: cred })
  return (await r.json()) as { authenticated: boolean; login_required: boolean }
}

export async function postLogin(username: string, password: string): Promise<boolean> {
  const r = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    credentials: cred,
    headers: {
      ...headers(true),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  })
  return r.ok
}

export async function postLogout(): Promise<void> {
  await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: cred })
}

export async function fetchStatus(): Promise<{
  httpStatus: number
  data: StatusResponse
}> {
  const r = await fetch(apiUrl("/api/status"), { credentials: cred, headers: headers(true) })
  const d = (await r.json()) as StatusResponse
  if (r.status === 401) {
    return {
      httpStatus: 401,
      data: { ...d, headline: "Unauthorized — sign in again", rcon_ok: false },
    }
  }
  return { httpStatus: r.status, data: d }
}

export type CapabilityTriState = "enabled" | "disabled" | "unknown"

export type DemoParserCapability = {
  id: string
  tool: string
  version_or_probe: string
  source: string
}

export type ServerCapabilitiesResponse = {
  control_http_ok?: boolean
  checked_at?: string
  error?: string
  detail?: string
  demo_parsers?: DemoParserCapability[]
  server_profile?: { value: string; source: string }
  rcon?: {
    reachable?: boolean
    status?: {
      ok?: boolean
      exit_code?: number
      snippet?: string
      headline?: string
      humans?: number | null
      bots?: number | null
      map?: string | null
      hostname?: string | null
    }
  }
  cheats?: {
    state?: string
    source?: string
    detail?: string | null
    launch_env?: { value: string | null; known: boolean }
  }
  plugins?: Partial<
    Record<
      "metamod" | "counterstrikesharp" | "matchzy" | "kz" | "biobase_pos",
      { state?: CapabilityTriState }
    >
  >
  probes?: Record<string, { ok?: boolean; exit_code?: number; snippet?: string }>
}

export async function fetchServerCapabilities(): Promise<{
  httpStatus: number
  data: ServerCapabilitiesResponse
}> {
  const r = await fetch(apiUrl("/api/server-capabilities"), {
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as ServerCapabilitiesResponse
  if (r.status === 401) {
    return {
      httpStatus: 401,
      data: { ...d, error: "Unauthorized — sign in again", control_http_ok: false },
    }
  }
  return { httpStatus: r.status, data: d }
}

export async function postChangeMap(map: string): Promise<{
  httpStatus: number
  ok?: boolean
  message?: string
  error?: string
}> {
  const r = await fetch(apiUrl("/api/map"), {
    method: "POST",
    credentials: cred,
    headers: {
      ...headers(true),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ map }),
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    error?: string
    detail?: string | unknown
  }
  let detailMsg: string | undefined
  if (typeof d.detail === "string") {
    detailMsg = d.detail
  } else if (Array.isArray(d.detail) && d.detail[0] != null) {
    const row = d.detail[0] as { msg?: string }
    if (typeof row.msg === "string") {
      detailMsg = row.msg
    }
  }
  if (r.status === 404 && !d.error) {
    return {
      httpStatus: r.status,
      ok: false,
      error:
        detailMsg ??
        "Control service missing /api/map — rebuild bb_cs2_control image and recreate the container.",
    }
  }
  return {
    httpStatus: r.status,
    ...d,
    ...(detailMsg && !d.error ? { error: detailMsg } : {}),
  }
}

export async function postBots(
  action: "start" | "stop",
): Promise<{
  httpStatus: number
  ok?: boolean
  message?: string
  error?: string
}> {
  const r = await fetch(apiUrl(`/api/bots/${action}`), {
    method: "POST",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    message?: string
    error?: string
  }
  return { httpStatus: r.status, ...d }
}

export async function fetchDemoExtractableFields(): Promise<{
  httpStatus: number
  data: DemoFieldCatalogResponse
}> {
  const r = await fetch(apiUrl("/api/demo-extractable-fields"), {
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoFieldCatalogResponse
  return { httpStatus: r.status, data: d }
}

export type DemoFieldCatalogResponse = {
  meta?: {
    extraction?: string | null
    awpy_version?: string | null
    demoparser2_version?: string | null
    disclaimer?: string
  }
  fields?: Array<{
    path: string
    brief_type: string
    group: string
    notes: string
  }>
  error?: string
  detail?: string
}

export async function postDemoParsePreview(args: {
  file?: File | null
  demoUrl?: string
  /** Basename from GET /api/uploads (same volume as Clips upload). */
  clipStorageName?: string
  eventScanMax?: number
}): Promise<{
  httpStatus: number
  data: DemoParsePreviewResponse
}> {
  const fd = new FormData()
  if (args.file) {
    fd.append("file", args.file, args.file.name)
  }
  const url = args.demoUrl?.trim()
  if (url) {
    fd.append("demo_url", url)
  }
  const clip = args.clipStorageName?.trim()
  if (clip) {
    fd.append("clip_storage_name", clip)
  }
  fd.append("event_scan_max", String(args.eventScanMax ?? 80))
  const r = await fetch(apiUrl("/api/demo-parse-preview"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const data = (await r.json().catch(() => ({}))) as DemoParsePreviewResponse
  return { httpStatus: r.status, data }
}

export type DemoParsePreviewMeta = {
  extraction?: string | null
  awpy_version?: string | null
  demoparser2_version?: string | null
  source_filename?: string
  bytes?: number
  sha256?: string
  disclaimer?: string
}

export type DemoParsePreviewDiscovered = {
  header_keys?: string[]
  /** First 64 header keys with truncated scalar previews (from awpy demo header). */
  header_field_samples?: Record<string, string | number | boolean | null>
  list_game_events?: string[]
  list_updated_fields?: string[]
  event_columns_from_parse_event?: Record<string, string[] | { error?: string }>
  awpy_events_tables?: Record<string, string[]>
  ticks_columns?: string[]
  rounds_columns?: string[]
  grenades_columns?: string[]
  derived_tables?: Record<string, { columns?: string[]; error?: string }>
}

export type DemoParsePreviewResponse = {
  meta?: DemoParsePreviewMeta
  discovered?: DemoParsePreviewDiscovered
  discovery_rows?: Array<{ group: string; key: string; detail?: string }>
  error?: string
  detail?: string
}

export type ParserCompareParserResult = {
  id: string
  label: string
  ok?: boolean
  skipped?: boolean
  exit_code?: number | null
  duration_ms?: number
  summary?: Record<string, unknown> | null
  stdout_json?: Record<string, unknown> | null
  stdout_text?: string
  stderr_tail?: string
  error?: string | null
  hint?: string
}

export type ParserCompareResponse = {
  meta?: {
    source_filename?: string
    bytes?: number
    sha256?: string
    timeout_sec?: number
    max_stdout_bytes?: number
    disclaimer?: string
  }
  parsers?: Record<string, ParserCompareParserResult>
  error?: string
  detail?: string
}

export async function postDemoParserCompare(args: {
  file?: File | null
  demoUrl?: string
  clipStorageName?: string
}): Promise<{
  httpStatus: number
  data: ParserCompareResponse
}> {
  const fd = new FormData()
  if (args.file) {
    fd.append("file", args.file, args.file.name)
  }
  const url = args.demoUrl?.trim()
  if (url) {
    fd.append("demo_url", url)
  }
  const clip = args.clipStorageName?.trim()
  if (clip) {
    fd.append("clip_storage_name", clip)
  }
  const r = await fetch(apiUrl("/api/demo-parser-compare"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const data = (await r.json().catch(() => ({}))) as ParserCompareResponse
  return { httpStatus: r.status, data }
}

export type ClipBatchUploadRow =
  | { ok: true; saved_as: string; bytes: number; filename?: string }
  | { ok: false; detail: string; http_status: number; filename?: string }

export async function uploadClip(file: File): Promise<{
  httpStatus: number
  ok?: boolean
  saved_as?: string
  bytes?: number
  detail?: string
  vm_clips_path?: string | null
  host?: string
  /** Populated for multi-file POST (≥2 parts). */
  results?: ClipBatchUploadRow[]
}> {
  const fd = new FormData()
  fd.append("file", file, file.name)
  const r = await fetch(apiUrl("/api/uploads"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    saved_as?: string
    bytes?: number
    detail?: unknown
    vm_clips_path?: string | null
    host?: string
    results?: ClipBatchUploadRow[]
  }
  return {
    httpStatus: r.status,
    ok: d.ok,
    saved_as: d.saved_as,
    bytes: d.bytes,
    detail: fastApiDetailString(d.detail),
    vm_clips_path: d.vm_clips_path ?? null,
    host: typeof d.host === "string" ? d.host : undefined,
    results: Array.isArray(d.results) ? d.results : undefined,
  }
}

/** POST multiple `file` parts in one request. For a single file, delegates to {@link uploadClip}. */
export async function uploadClips(files: File[]): Promise<{
  httpStatus: number
  ok?: boolean
  saved_as?: string
  bytes?: number
  detail?: string
  vm_clips_path?: string | null
  host?: string
  results?: ClipBatchUploadRow[]
}> {
  if (files.length === 0) {
    return { httpStatus: 400, ok: false, detail: "no_files" }
  }
  if (files.length === 1) {
    return uploadClip(files[0]!)
  }
  const fd = new FormData()
  for (const f of files) {
    fd.append("file", f, f.name)
  }
  const r = await fetch(apiUrl("/api/uploads"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    saved_as?: string
    bytes?: number
    detail?: unknown
    vm_clips_path?: string | null
    host?: string
    results?: ClipBatchUploadRow[]
  }
  return {
    httpStatus: r.status,
    ok: d.ok,
    saved_as: d.saved_as,
    bytes: d.bytes,
    detail: fastApiDetailString(d.detail),
    vm_clips_path: d.vm_clips_path ?? null,
    host: typeof d.host === "string" ? d.host : undefined,
    results: Array.isArray(d.results) ? d.results : undefined,
  }
}

export type UploadListItem = {
  name: string
  display_name: string
  bytes: number
  modified_unix: number
  modified_iso: string
  content_type: string
}

export async function fetchUploadsList(): Promise<{
  httpStatus: number
  ok?: boolean
  items?: UploadListItem[]
  vm_clips_path?: string | null
  detail?: string
}> {
  const r = await fetch(apiUrl("/api/uploads"), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    items?: UploadListItem[]
    vm_clips_path?: string | null
    detail?: unknown
  }
  return {
    httpStatus: r.status,
    ok: d.ok,
    items: Array.isArray(d.items) ? d.items : undefined,
    vm_clips_path: d.vm_clips_path ?? null,
    detail: fastApiDetailString(d.detail),
  }
}

/** Same-origin URL for GET download (session cookie sent for logged-in users). */
export function clipDownloadUrl(storageName: string): string {
  const enc = encodeURIComponent(storageName)
  return apiUrl(`api/uploads/download/${enc}`)
}

/** Absolute download URL (for copying — requires session cookie when opened in-browser). */
export function clipUploadAbsoluteDownloadUrl(storageName: string): string {
  const path = clipDownloadUrl(storageName)
  if (typeof window === "undefined") {
    return path
  }
  return new URL(path, window.location.origin).href
}

export type ClipLibrarySummary = {
  id: string
  label: string
  mp4_count: number
}

export async function fetchClipLibraries(): Promise<{
  httpStatus: number
  ok?: boolean
  libraries?: ClipLibrarySummary[]
  detail?: string
}> {
  const r = await fetch(apiUrl("/api/clip-libraries"), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    libraries?: ClipLibrarySummary[]
    detail?: unknown
  }
  return {
    httpStatus: r.status,
    ok: d.ok,
    libraries: Array.isArray(d.libraries) ? d.libraries : undefined,
    detail: fastApiDetailString(d.detail),
  }
}

export async function fetchClipLibraryItems(
  libraryId: string,
  opts?: { limit?: number; offset?: number; q?: string },
): Promise<{
  httpStatus: number
  ok?: boolean
  library_id?: string
  items?: UploadListItem[]
  total?: number
  limit?: number
  offset?: number
  has_more?: boolean
  detail?: string
}> {
  const params = new URLSearchParams()
  if (opts?.limit != null) {
    params.set("limit", String(opts.limit))
  }
  if (opts?.offset != null) {
    params.set("offset", String(opts.offset))
  }
  if (opts?.q?.trim()) {
    params.set("q", opts.q.trim())
  }
  const qs = params.toString()
  const r = await fetch(
    apiUrl(`/api/clip-libraries/${encodeURIComponent(libraryId)}/items${qs ? `?${qs}` : ""}`),
    {
      method: "GET",
      credentials: cred,
      headers: headers(true),
    },
  )
  const d = (await r.json().catch(() => ({}))) as {
    ok?: boolean
    library_id?: string
    items?: UploadListItem[]
    total?: number
    limit?: number
    offset?: number
    has_more?: boolean
    detail?: unknown
  }
  return {
    httpStatus: r.status,
    ok: d.ok,
    library_id: d.library_id,
    items: Array.isArray(d.items) ? d.items : undefined,
    total: typeof d.total === "number" ? d.total : undefined,
    limit: typeof d.limit === "number" ? d.limit : undefined,
    offset: typeof d.offset === "number" ? d.offset : undefined,
    has_more: d.has_more,
    detail: fastApiDetailString(d.detail),
  }
}

/** Same-origin URL for inline MP4 playback (session cookie sent). */
export function clipLibraryPlayUrl(libraryId: string, fileName: string): string {
  const params = new URLSearchParams({ name: fileName })
  return apiUrl(`/api/clip-libraries/${encodeURIComponent(libraryId)}/play?${params.toString()}`)
}

export type DemoMovementPoint = {
  tick: number
  round_num?: number
  x: number | null
  y: number | null
  z: number | null
  health?: number | null
}

export type DemoMovementPlayer = {
  steamid: string
  name: string
  team_name?: string | null
  rows: number
  first_tick: number
  last_tick: number
  travel_units: number
  bounds?: Record<string, number | null>
  points: DemoMovementPoint[]
}

export type DemoMovementPayload = {
  ok?: boolean
  cached?: boolean
  meta?: {
    extraction?: string
    awpy_version?: string | null
    demoparser2_version?: string | null
    source_filename?: string
    storage_name?: string
    bytes?: number
    sha256?: string
    generated_at?: string
    parse_elapsed_sec?: number
    max_points_per_player?: number
    note?: string
  }
  summary?: {
    tick_rows?: number
    movement_rows?: number
    players?: number
    rounds?: number
    columns?: string[]
    bounds?: Record<string, number | null>
  }
  players?: DemoMovementPlayer[]
  error?: string
  detail?: string
}

export type DemoMovementListResponse = {
  ok?: boolean
  parse_max_mb?: number
  demos?: Array<UploadListItem & { movement_parsed?: boolean }>
  artifacts?: Array<{
    artifact: string
    storage_name?: string
    source_filename?: string
    generated_at?: string
    parse_elapsed_sec?: number
    tick_rows?: number
    movement_rows?: number
    players?: number
    rounds?: number
    bytes?: number
  }>
  detail?: string
}

export async function fetchDemoMovementList(): Promise<{ httpStatus: number; data: DemoMovementListResponse }> {
  const r = await fetch(apiUrl("/api/demo-movement"), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementListResponse
  return { httpStatus: r.status, data: d }
}

export async function fetchDemoMovement(clipStorageName: string): Promise<{ httpStatus: number; data: DemoMovementPayload }> {
  const params = new URLSearchParams({ clip_storage_name: clipStorageName })
  const r = await fetch(apiUrl(`/api/demo-movement?${params.toString()}`), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementPayload
  return { httpStatus: r.status, data: d }
}

export async function postDemoMovementParse(args: {
  clipStorageName: string
  force?: boolean
  maxPointsPerPlayer?: number
}): Promise<{ httpStatus: number; data: DemoMovementPayload }> {
  const fd = new FormData()
  fd.append("clip_storage_name", args.clipStorageName)
  fd.append("force", args.force ? "true" : "false")
  fd.append("max_points_per_player", String(args.maxPointsPerPlayer ?? 450))
  const r = await fetch(apiUrl("/api/demo-movement/parse"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementPayload
  return { httpStatus: r.status, data: d }
}

export type DemoMovementAnnotation = {
  id: string
  clip_storage_name?: string
  player_steamid?: string | null
  player_name?: string | null
  start_tick: number
  end_tick: number
  label: string
  intent?: string | null
  phase?: string | null
  quality?: string | null
  note?: string | null
  created_at?: string
  updated_at?: string
}

export type DemoMovementAnnotationsResponse = {
  ok?: boolean
  storage_name?: string
  updated_at?: string
  annotations?: DemoMovementAnnotation[]
  error?: string
  detail?: string
}

export async function fetchDemoMovementAnnotations(clipStorageName: string): Promise<{ httpStatus: number; data: DemoMovementAnnotationsResponse }> {
  const params = new URLSearchParams({ clip_storage_name: clipStorageName })
  const r = await fetch(apiUrl(`/api/demo-movement/annotations?${params.toString()}`), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementAnnotationsResponse
  return { httpStatus: r.status, data: d }
}

export async function postDemoMovementAnnotation(annotation: Omit<DemoMovementAnnotation, "id"> & { id?: string; clip_storage_name: string }): Promise<{ httpStatus: number; data: DemoMovementAnnotationsResponse }> {
  const r = await fetch(apiUrl("/api/demo-movement/annotations"), {
    method: "POST",
    credentials: cred,
    headers: {
      ...headers(true),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(annotation),
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementAnnotationsResponse
  return { httpStatus: r.status, data: d }
}

export async function deleteDemoMovementAnnotation(clipStorageName: string, annotationId: string): Promise<{ httpStatus: number; data: DemoMovementAnnotationsResponse }> {
  const params = new URLSearchParams({ clip_storage_name: clipStorageName })
  const r = await fetch(apiUrl(`/api/demo-movement/annotations/${encodeURIComponent(annotationId)}?${params.toString()}`), {
    method: "DELETE",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoMovementAnnotationsResponse
  return { httpStatus: r.status, data: d }
}

export type DemoRenderStatus = {
  ok?: boolean
  storage_name?: string
  rendered?: boolean
  renderer_configured?: boolean
  steam_playback_configured?: boolean
  status?: string
  video_url?: string | null
  bytes?: number | null
  generated_at?: string
  detail?: string
  error?: string
  cached?: boolean
}

export type DemoSteamPlaybackStatus = {
  ok?: boolean
  storage_name?: string
  steam_playback_configured?: boolean
  status?: string
  viewer_url?: string | null
  detail?: string
  error?: string
  exit_code?: number
  stdout?: string
  stderr?: string
  started_at?: string
}

export async function fetchDemoRender(clipStorageName: string): Promise<{ httpStatus: number; data: DemoRenderStatus }> {
  const params = new URLSearchParams({ clip_storage_name: clipStorageName })
  const r = await fetch(apiUrl(`/api/demo-render?${params.toString()}`), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoRenderStatus
  return { httpStatus: r.status, data: d }
}

export async function postDemoRender(clipStorageName: string, force = false): Promise<{ httpStatus: number; data: DemoRenderStatus }> {
  const fd = new FormData()
  fd.append("clip_storage_name", clipStorageName)
  fd.append("force", force ? "true" : "false")
  const r = await fetch(apiUrl("/api/demo-render"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const d = (await r.json().catch(() => ({}))) as DemoRenderStatus
  return { httpStatus: r.status, data: d }
}

export async function fetchDemoSteamPlayback(clipStorageName: string): Promise<{ httpStatus: number; data: DemoSteamPlaybackStatus }> {
  const params = new URLSearchParams({ clip_storage_name: clipStorageName })
  const r = await fetch(apiUrl(`/api/demo-steam-playback?${params.toString()}`), {
    method: "GET",
    credentials: cred,
    headers: headers(true),
  })
  const d = (await r.json().catch(() => ({}))) as DemoSteamPlaybackStatus
  return { httpStatus: r.status, data: d }
}

export async function postDemoSteamPlayback(clipStorageName: string): Promise<{ httpStatus: number; data: DemoSteamPlaybackStatus }> {
  const fd = new FormData()
  fd.append("clip_storage_name", clipStorageName)
  const r = await fetch(apiUrl("/api/demo-steam-playback"), {
    method: "POST",
    credentials: cred,
    body: fd,
  })
  const d = (await r.json().catch(() => ({}))) as DemoSteamPlaybackStatus
  return { httpStatus: r.status, data: d }
}
