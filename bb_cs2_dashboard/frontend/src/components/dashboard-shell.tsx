"use client"

import { useState } from "react"

import { BiobaseSidebar, type DashboardSection } from "@/components/biobase-sidebar"
import { BiobaseSiteHeader } from "@/components/biobase-site-header"
import { ClipsUploadPanel } from "@/components/clips-upload-panel"
import { MapAndPresetsPanel } from "@/components/map-and-presets-panel"
import { MatchServerPanel } from "@/components/match-server-panel"
import { DemoSchemaSection } from "@/components/demo-schema-section"
import { ObservabilitySection } from "@/components/observability-section"
import { OverviewSection } from "@/components/overview-section"
import { PerformanceDatasetsSection } from "@/components/performance-datasets-section"
import { PracticeToolsSection } from "@/components/practice-tools-section"
import { ProMovementSection } from "@/components/pro-movement-section"
import { RoadmapSection } from "@/components/roadmap-section"
import { TiktokClipsPanel } from "@/components/tiktok-clips-panel"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useAuth } from "@/context/auth-context"

function renderSection(section: DashboardSection, onNavigate: (s: DashboardSection) => void) {
  switch (section) {
    case "overview":
      return <OverviewSection onNavigate={onNavigate} />
    case "match_server":
      return (
        <div className="space-y-3">
          <MatchServerPanel />
          <MapAndPresetsPanel />
        </div>
      )
    case "practice_tools":
      return <PracticeToolsSection />
    case "upload":
      return <ClipsUploadPanel />
    case "tiktok_clips":
      return <TiktokClipsPanel />
    case "demo_schema":
      return <DemoSchemaSection />
    case "pro_movement":
      return <ProMovementSection />
    case "performance_datasets":
      return <PerformanceDatasetsSection onOpenMovement={() => onNavigate("pro_movement")} />
    case "roadmap":
      return <RoadmapSection />
    case "observability":
      return <ObservabilitySection />
    default: {
      const _exhaustive: never = section
      return _exhaustive
    }
  }
}

export function DashboardShell() {
  const [section, setSection] = useState<DashboardSection>("overview")
  const { me, logout } = useAuth()
  const showSignOut = me?.login_required ?? false

  return (
    <SidebarProvider>
      <BiobaseSidebar
        active={section}
        onNavigate={setSection}
        showSignOut={showSignOut}
        onSignOut={() => void logout()}
      />
      <SidebarInset className="min-h-0">
        <BiobaseSiteHeader section={section} />
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${(section === "roadmap" || section === "performance_datasets") ? "" : "gap-3 px-3 py-3 md:gap-4 md:px-5 md:py-4"}`}>
          {renderSection(section, setSection)}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
