"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAuth } from "@/context/auth-context"
import {
  clipLibraryPlayUrl,
  fetchClipLibraries,
  fetchClipLibraryItems,
  type ClipLibrarySummary,
  type UploadListItem,
} from "@/lib/dashboard-api"
import { cn } from "@/lib/utils"
import { Loader2Icon, PlayIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

const PAGE_SIZE = 40
const DEFAULT_LIBRARY_ID = "klingis_tv_tiktok"

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "—"
  }
  if (n < 1024) {
    return `${n} B`
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string, unix: number): string {
  const t = Date.parse(iso)
  const d = Number.isFinite(t) ? new Date(t) : new Date(unix * 1000)
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function TiktokClipsPanel() {
  const { refresh } = useAuth()
  const [libraries, setLibraries] = useState<ClipLibrarySummary[]>([])
  const [libraryId, setLibraryId] = useState(DEFAULT_LIBRARY_ID)
  const [items, setItems] = useState<UploadListItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<UploadListItem | null>(null)
  const [listBusy, setListBusy] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const selectedLibrary = useMemo(
    () => libraries.find((lib) => lib.id === libraryId) ?? null,
    [libraries, libraryId],
  )

  const loadLibraries = useCallback(async () => {
    const d = await fetchClipLibraries()
    if (d.httpStatus === 401) {
      await refresh()
      throw new Error("Session expired — sign in again.")
    }
    if (!d.ok || !Array.isArray(d.libraries)) {
      throw new Error(d.detail ?? `Could not load clip libraries (HTTP ${d.httpStatus}).`)
    }
    setLibraries(d.libraries)
    if (d.libraries.length > 0 && !d.libraries.some((lib) => lib.id === libraryId)) {
      const preferred = d.libraries.find((lib) => lib.id === DEFAULT_LIBRARY_ID)
      setLibraryId(preferred?.id ?? d.libraries[0].id)
    }
  }, [libraryId, refresh])

  const loadItems = useCallback(async () => {
    setListBusy(true)
    setListError(null)
    try {
      await loadLibraries()
      const d = await fetchClipLibraryItems(libraryId, {
        limit: PAGE_SIZE,
        offset,
        q: query || undefined,
      })
      if (d.httpStatus === 401) {
        await refresh()
        const msg = "Session expired — sign in again."
        setListError(msg)
        toast.error(msg)
        setItems([])
        setTotal(0)
        setHasMore(false)
        return
      }
      if (!d.ok || !Array.isArray(d.items)) {
        const msg = d.detail ?? `Could not load clips (HTTP ${d.httpStatus}).`
        setItems([])
        setTotal(0)
        setHasMore(false)
        setListError(msg)
        toast.error(msg)
        return
      }
      const loadedItems = d.items
      setItems(loadedItems)
      setTotal(d.total ?? loadedItems.length)
      setHasMore(Boolean(d.has_more))
      setSelected((prev) => {
        if (prev && loadedItems.some((row) => row.name === prev.name)) {
          return prev
        }
        return loadedItems[0] ?? null
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error — could not load clips."
      setItems([])
      setTotal(0)
      setHasMore(false)
      setListError(msg)
      toast.error(msg)
    } finally {
      setListBusy(false)
    }
  }, [libraryId, loadLibraries, offset, query, refresh])

  useEffect(() => {
    queueMicrotask(() => {
      void loadItems()
    })
  }, [loadItems])

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + items.length, total)
  const playUrl = selected ? clipLibraryPlayUrl(libraryId, selected.name) : null

  return (
    <div className="space-y-3">
      <Card size="sm" className="ring-foreground/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">TikTok clip library</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Browse and play MP4 clips from server-side library folders (for example{" "}
            <span className="font-mono">{DEFAULT_LIBRARY_ID}</span>). Playback uses your dashboard
            session cookie on the same origin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <label htmlFor="clip-library-select" className="text-muted-foreground text-xs">
                    Library
                  </label>
                  <select
                    id="clip-library-select"
                    className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={libraryId}
                    disabled={listBusy || libraries.length === 0}
                    onChange={(e) => {
                      setLibraryId(e.target.value)
                      setOffset(0)
                      setSelected(null)
                    }}
                  >
                    {(libraries.length > 0 ? libraries : [{ id: libraryId, label: libraryId, mp4_count: 0 }]).map(
                      (lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.label}
                          {lib.mp4_count > 0 ? ` (${lib.mp4_count})` : ""}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <form
                  className="flex min-w-[14rem] flex-1 items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setOffset(0)
                    setQuery(searchInput.trim())
                  }}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor="clip-library-search" className="text-muted-foreground text-xs">
                      Search filename
                    </label>
                    <Input
                      id="clip-library-search"
                      value={searchInput}
                      placeholder="klingis, cs2, …"
                      onChange={(e) => setSearchInput(e.target.value)}
                    />
                  </div>
                  <Button type="submit" size="sm" className="h-8 shrink-0" disabled={listBusy}>
                    <SearchIcon className="size-3.5" />
                    <span className="sr-only">Search</span>
                  </Button>
                </form>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={listBusy}
                  onClick={() => void loadItems()}
                >
                  {listBusy ? <Loader2Icon className="size-3.5 animate-spin" /> : "Refresh"}
                </Button>
              </div>

              {selectedLibrary ? (
                <p className="text-muted-foreground text-[0.65rem]">
                  {selectedLibrary.mp4_count.toLocaleString()} MP4 files in{" "}
                  <span className="font-mono">{selectedLibrary.id}</span>
                </p>
              ) : null}

              <div className="bg-muted/20 min-h-[12rem] rounded-md border">
                {listError ? (
                  <div
                    role="alert"
                    className="border-destructive/40 bg-destructive/10 m-3 rounded-md border px-3 py-2 text-xs text-destructive"
                  >
                    {listError}
                  </div>
                ) : null}
                {listBusy && items.length === 0 ? (
                  <div className="text-muted-foreground flex items-center gap-2 p-4 text-xs">
                    <Loader2Icon className="size-3.5 animate-spin" />
                    Loading clips…
                  </div>
                ) : null}
                {!listBusy && !listError && items.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-xs">No MP4 clips matched this search.</p>
                ) : null}
                {items.length > 0 ? (
                  <div className="max-h-[min(28rem,55vh)] overflow-auto">
                    <Table aria-label="TikTok clip files">
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-xs">Clip</TableHead>
                          <TableHead className="text-xs">Size</TableHead>
                          <TableHead className="text-xs">Modified</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((row) => {
                          const active = selected?.name === row.name
                          return (
                            <TableRow
                              key={row.name}
                              className={cn("cursor-pointer", active && "bg-muted/50")}
                              onClick={() => setSelected(row)}
                            >
                              <TableCell className="max-w-[min(18rem,34vw)] truncate text-xs font-medium">
                                <span className="inline-flex items-center gap-1.5" title={row.display_name}>
                                  <PlayIcon className={cn("size-3 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                                  {row.display_name}
                                </span>
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs tabular-nums">
                                {formatBytes(row.bytes)}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs">
                                {formatWhen(row.modified_iso, row.modified_unix)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs tabular-nums">
                  {total > 0 ? `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()}` : "No clips"}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={listBusy || offset <= 0}
                    onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={listBusy || !hasMore}
                    onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <CardTitle className="text-sm">Player</CardTitle>
              {selected && playUrl ? (
                <>
                  <p className="text-muted-foreground text-xs leading-snug" title={selected.display_name}>
                    {selected.display_name}
                  </p>
                  <video
                    key={`${libraryId}:${selected.name}`}
                    className="aspect-video w-full rounded-md border bg-black"
                    controls
                    playsInline
                    preload="metadata"
                    src={playUrl}
                  />
                </>
              ) : (
                <div className="text-muted-foreground flex aspect-video w-full items-center justify-center rounded-md border bg-black/40 text-xs">
                  Select a clip to play
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
