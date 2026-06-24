"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export function PracticeToolsSection() {
  return (
    <div className="space-y-3">
      <Card size="sm" className="ring-foreground/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Practice & server tooling</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Server-side practice cfg / convars — scaffolding until RCON-backed routes land.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
            <Label htmlFor="srv-practice-mode" className="cursor-not-allowed text-xs leading-snug">
              Practice mode
            </Label>
            <Checkbox id="srv-practice-mode" disabled checked={false} aria-readonly />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
            <Label htmlFor="srv-infinite" className="cursor-not-allowed text-xs leading-snug">
              Infinite reserve ammo
            </Label>
            <Checkbox id="srv-infinite" disabled checked={false} aria-readonly />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 border-t px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground text-[0.65rem]">Presets</span>
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="outline" size="xs" disabled>
              Aim
            </Button>
            <Button type="button" variant="outline" size="xs" disabled>
              Exec
            </Button>
            <Button type="button" variant="outline" size="xs" disabled>
              Retake
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Card size="sm" className="ring-foreground/10">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div className="space-y-0.5">
            <CardTitle className="text-sm">RCON shell</CardTitle>
            <CardDescription className="text-xs">Reserved for the control service.</CardDescription>
          </div>
          <Button type="button" variant="secondary" size="sm" className="h-7 shrink-0" disabled>
            Open
          </Button>
        </CardHeader>
      </Card>
    </div>
  )
}
