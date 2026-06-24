"use client"

import { ExternalLinkIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const grafanaUrl = import.meta.env.VITE_GRAFANA_URL as string | undefined

export function ObservabilitySection() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card size="sm" className="bg-card/80 ring-foreground/10">
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">Grafana</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Set <code className="text-muted-foreground">VITE_GRAFANA_URL</code> at build time to
            enable the link.
          </CardDescription>
          {grafanaUrl ? (
            <a
              href={grafanaUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "mt-2 inline-flex h-7 w-fit no-underline",
              )}
            >
              Open Grafana
              <ExternalLinkIcon className="ml-1.5 size-3.5" />
            </a>
          ) : (
            <p className="text-muted-foreground mt-1 text-[0.65rem]">URL not configured.</p>
          )}
        </CardHeader>
      </Card>
      <Card size="sm" className="bg-card/80 ring-foreground/10">
        <CardHeader className="gap-1">
          <CardTitle className="text-sm">Loki</CardTitle>
          <CardDescription className="text-xs leading-snug">
            Use Grafana Explore with your Loki datasource — label game server and dashboard
            containers for usable filters.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
