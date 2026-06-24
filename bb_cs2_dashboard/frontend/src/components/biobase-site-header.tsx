import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import type { DashboardSection } from "@/components/biobase-sidebar"

const titles: Record<DashboardSection, string> = {
  overview: "Overview",
  match_server: "Match & server",
  practice_tools: "Practice & tools",
  upload: "Upload",
  tiktok_clips: "TikTok clips",
  observability: "Observability",
  demo_schema: "Demo extractable fields",
  pro_movement: "Pro movement review",
  performance_datasets: "Performance datasets",
  roadmap: "BioBase Live Roadmap",
}

export function BiobaseSiteHeader({ section }: { section: DashboardSection }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-3 lg:gap-2 lg:px-5">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <div className="flex flex-col">
          <h1 className="text-base leading-none font-medium">CS2 admin</h1>
          <p className="text-muted-foreground mt-0.5 text-xs">{titles[section]}</p>
        </div>
      </div>
    </header>
  )
}
