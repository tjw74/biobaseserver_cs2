"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
  clipDownloadUrl,
  clipUploadAbsoluteDownloadUrl,
  fetchUploadsList,
  type UploadListItem,
  uploadClip,
} from "@/lib/dashboard-api"
import { cn } from "@/lib/utils"
import { CopyIcon, DownloadIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

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

function formatPickedSummary(files: File[]): string {
  if (files.length === 0) {
    return ""
  }
  const maxShow = 4
  const shown = files.slice(0, maxShow).map((f) => f.name)
  const extra = files.length - shown.length
  const tail = extra > 0 ? ` (+${extra} more)` : ""
  return `${files.length} selected: ${shown.join(", ")}${tail}`
}

/** Browser folder picks expose relative paths; sort for stable upload order. */
function filesFromFolderInput(fileList: FileList | File[]): File[] {
  const raw = Array.from(fileList)
  if (raw.length === 0) {
    return raw
  }
  return [...raw].sort((a, b) => {
    const pa = a.webkitRelativePath || a.name
    const pb = b.webkitRelativePath || b.name
    return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: "base" })
  })
}

function pickedSummaryTitle(files: File[]): string {
  return files.map((f) => (f.webkitRelativePath || f.name).trim() || f.name).join(", ")
}

/** Match `components/ui/input` styling; native `<input>` avoids Base UI FieldControl + `type="file"` quirks. */
const clipsFileInputClassName = cn(
  "h-8 w-full min-w-0 max-w-md rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none file:mr-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  "cursor-pointer",
)

export function ClipsUploadPanel() {
  const [picked, setPicked] = useState<File[]>([])
  const [folderMode, setFolderMode] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 1-based index while uploading (sequential); null when idle. */
  const [uploadPos, setUploadPos] = useState<number | null>(null)
  const [listBusy, setListBusy] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [items, setItems] = useState<UploadListItem[]>([])
  /** From last successful GET /api/uploads — server-side clips path hint (VM bind). */
  const [clipsPathHint, setClipsPathHint] = useState<string | null>(null)
  const { refresh } = useAuth()
  const folderInputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (!folderMode) {
      return
    }
    const el = folderInputRef.current
    if (!el) {
      return
    }
    el.multiple = true
    el.webkitdirectory = true
  }, [folderMode])

  const loadList = useCallback(async () => {
    setListBusy(true)
    setListError(null)
    try {
      const d = await fetchUploadsList()
      if (d.httpStatus === 401) {
        await refresh()
        const msg = "Session expired — sign in again."
        setListError(msg)
        toast.error(msg)
        setItems([])
        setClipsPathHint(null)
        return
      }
      if (d.ok && Array.isArray(d.items)) {
        setItems(d.items)
        setClipsPathHint(d.vm_clips_path?.trim() ? d.vm_clips_path.trim() : null)
        return
      }
      const msg = d.detail ?? `Could not load uploads (HTTP ${d.httpStatus}).`
      setItems([])
      setClipsPathHint(null)
      setListError(msg)
      toast.error(msg)
    } catch {
      const msg = "Network error — could not load uploads."
      setItems([])
      setClipsPathHint(null)
      setListError(msg)
      toast.error(msg)
    } finally {
      setListBusy(false)
    }
  }, [refresh])

  useEffect(() => {
    queueMicrotask(() => {
      void loadList()
    })
  }, [loadList])

  async function copyDownloadLink(storageName: string) {
    const href = clipUploadAbsoluteDownloadUrl(storageName)
    try {
      await navigator.clipboard.writeText(href)
      toast.success("Download link copied")
    } catch {
      toast.error("Could not copy link")
    }
  }

  async function onUpload() {
    if (picked.length === 0) {
      return
    }
    setBusy(true)
    const pendingFiles = picked
    let okCount = 0
    let lastOk: {
      saved_as?: string
      bytes?: number
      vm_clips_path?: string | null
      host?: string
    } = {}
    const failures: string[] = []
    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        setUploadPos(i + 1)
        const f = pendingFiles[i]
        const d = await uploadClip(f)
        if (d.httpStatus === 401) {
          await refresh()
          toast.error("Session expired — sign in again")
          return
        }
        if (d.ok && d.saved_as) {
          okCount++
          lastOk = {
            saved_as: d.saved_as,
            bytes: d.bytes,
            vm_clips_path: d.vm_clips_path,
            host: d.host,
          }
        } else {
          failures.push(`${f.name}: ${d.detail ?? "Upload failed"}`)
        }
      }

      if (okCount > 0) {
        if (pendingFiles.length === 1 && lastOk.saved_as) {
          const where = lastOk.vm_clips_path?.trim()
            ? ` — saved under ${lastOk.vm_clips_path.trim()}/`
            : ""
          const srv = lastOk.host ? ` [server: ${lastOk.host}]` : ""
          toast.success(`Saved: ${lastOk.saved_as} (${lastOk.bytes ?? 0} B)${where}${srv}`)
        } else {
          const where = lastOk.vm_clips_path?.trim() ? ` — under ${lastOk.vm_clips_path.trim()}/` : ""
          const srv = lastOk.host ? ` [${lastOk.host}]` : ""
          toast.success(`Saved ${okCount} file${okCount === 1 ? "" : "s"}${where}${srv}`)
        }
        setPicked([])
        await loadList()
      }
      if (failures.length > 0) {
        toast.error(
          `Failed ${failures.length} file${failures.length === 1 ? "" : "s"}`,
          { description: failures.join("\n") },
        )
      }
    } catch {
      toast.error("Upload failed")
    } finally {
      setBusy(false)
      setUploadPos(null)
    }
  }

  const showInitialLoading = listBusy && items.length === 0 && !listError
  const showEmpty = !listBusy && !listError && items.length === 0
  const showTable = !listError && items.length > 0

  return (
    <div className="space-y-3">
      <Card size="sm" className="ring-foreground/10">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <CardTitle className="text-sm">Clips</CardTitle>
            <span
              className="text-muted-foreground font-mono text-[0.65rem] tabular-nums"
              title="Frontend bundle build id (verify deploy matches repo build)"
            >
              {import.meta.env.VITE_BUILD_ID}
            </span>
          </div>
          <CardDescription className="text-xs leading-snug">
            Upload to server volume (UUID prefix + original name). The list below scans the same server
            folder as this API whether you upload here or copy files into that volume directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <div className="flex flex-row items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-sm">Uploaded files</CardTitle>
                <CardDescription className="text-xs">Newest first — open, download, or copy link.</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0"
                disabled={listBusy}
                onClick={() => void loadList()}
              >
                {listBusy ? <Loader2Icon className="size-3.5 animate-spin" /> : "Refresh"}
              </Button>
            </div>
            {clipsPathHint ? (
              <p className="text-muted-foreground font-mono text-[0.65rem] leading-snug" title="Host / VM clips path hint">
                <span className="text-muted-foreground font-sans font-normal tracking-normal">
                  Server folder hint:{" "}
                </span>
                {clipsPathHint}
              </p>
            ) : null}

            <div
              className="bg-muted/20 min-h-[5.5rem] space-y-2 rounded-md border p-3"
              aria-label="Uploaded clip files summary"
            >
              {listError ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive dark:border-destructive/50 dark:bg-destructive/15 dark:text-red-200"
                >
                  <p className="font-medium">Could not load the file list.</p>
                  <p className="mt-1 text-destructive/90 dark:text-red-100/90">{listError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 border-destructive/40"
                    disabled={listBusy}
                    onClick={() => void loadList()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              {showInitialLoading ? (
                <div
                  className="text-foreground/80 flex items-center gap-2 text-xs"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  Loading file list…
                </div>
              ) : null}

              {showEmpty ? (
                <p className="text-foreground/90 text-xs">
                  No files in this folder yet — use Upload below or add files on the server, then Refresh.
                </p>
              ) : null}

              {showTable ? (
                <div className="max-h-[min(28rem,55vh)] overflow-auto rounded-md border">
                  <Table aria-label="Uploaded clip files">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="text-xs">File</TableHead>
                        <TableHead className="text-xs">Type</TableHead>
                        <TableHead className="text-xs">Size</TableHead>
                        <TableHead className="text-xs">Uploaded</TableHead>
                        <TableHead className="w-[7rem] text-right text-xs">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell className="max-w-[min(14rem,28vw)] truncate text-xs font-medium">
                            <span title={row.display_name}>{row.display_name}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[8rem] truncate text-xs">
                            <span title={row.content_type}>{row.content_type}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs tabular-nums">
                            {formatBytes(row.bytes)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {formatWhen(row.modified_iso, row.modified_unix)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-0.5">
                              <a
                                href={clipDownloadUrl(row.name)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  buttonVariants({ variant: "ghost", size: "sm" }),
                                  "inline-flex size-7 p-0 sm:size-8",
                                )}
                                title={`Open ${row.display_name} in new tab`}
                              >
                                <ExternalLinkIcon className="size-3.5" />
                                <span className="sr-only">Open {row.display_name} in new tab</span>
                              </a>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="inline-flex size-7 p-0 sm:size-8"
                                title="Copy download URL"
                                onClick={() => void copyDownloadLink(row.name)}
                              >
                                <CopyIcon className="size-3.5" />
                                <span className="sr-only">Copy download URL for {row.display_name}</span>
                              </Button>
                              <a
                                href={clipDownloadUrl(row.name)}
                                download={row.display_name}
                                className={cn(
                                  buttonVariants({ variant: "ghost", size: "sm" }),
                                  "inline-flex size-7 p-0 sm:size-8",
                                )}
                                title={`Download ${row.display_name}`}
                              >
                                <DownloadIcon className="size-3.5" />
                                <span className="sr-only">Download {row.display_name}</span>
                              </a>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="clips-upload-folder-mode"
                    checked={folderMode}
                    onCheckedChange={(v) => {
                      setFolderMode(v === true)
                      setPicked([])
                    }}
                  />
                  <Label
                    htmlFor="clips-upload-folder-mode"
                    className="text-muted-foreground cursor-pointer font-normal text-xs"
                  >
                    Upload folder
                  </Label>
                </div>
              </div>
              {folderMode ? (
                <input
                  key="clips-folder-input"
                  ref={folderInputRef}
                  type="file"
                  className={clipsFileInputClassName}
                  onChange={(e) => {
                    const input = e.currentTarget
                    setPicked(filesFromFolderInput(input.files ?? []))
                    input.value = ""
                  }}
                />
              ) : (
                <input
                  key="clips-files-input"
                  type="file"
                  multiple
                  className={clipsFileInputClassName}
                  onChange={(e) => {
                    const input = e.currentTarget
                    setPicked(Array.from(input.files ?? []))
                    input.value = ""
                  }}
                />
              )}
              {picked.length > 0 ? (
                <p
                  className="text-muted-foreground max-w-md text-[0.65rem] leading-snug"
                  title={pickedSummaryTitle(picked)}
                >
                  {formatPickedSummary(picked)}
                </p>
              ) : null}
              {busy && uploadPos !== null ? (
                <p className="text-muted-foreground text-[0.65rem]" aria-live="polite">
                  {picked.length > 1
                    ? `Uploading file ${uploadPos} of ${picked.length}…`
                    : "Uploading…"}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 w-fit shrink-0"
              disabled={busy || picked.length === 0}
              onClick={() => void onUpload()}
            >
              {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : "Upload"}
            </Button>
          </div>
        </CardContent>
        <CardFooter className="text-muted-foreground border-t py-2 text-[0.65rem] leading-snug">
          Open/download use your dashboard session cookie (same auth as the rest of the admin UI).
          Copied links only work for browsers that send that cookie (same origin).
        </CardFooter>
      </Card>
    </div>
  )
}
