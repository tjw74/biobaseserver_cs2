import * as React from "react"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  ActivityIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  ListTreeIcon,
  MapIcon,
  RouteIcon,
  ServerIcon,
  UploadIcon,
  VideoIcon,
  WrenchIcon,
} from "lucide-react"

export type DashboardSection =
  | "overview"
  | "match_server"
  | "practice_tools"
  | "upload"
  | "tiktok_clips"
  | "observability"
  | "demo_schema"
  | "pro_movement"
  | "performance_datasets"
  | "roadmap"

const navItems: {
  title: string
  section: DashboardSection
  icon: typeof LayoutDashboardIcon
}[] = [
  { title: "Overview", section: "overview", icon: LayoutDashboardIcon },
  { title: "Match & server", section: "match_server", icon: ServerIcon },
  { title: "Practice & tools", section: "practice_tools", icon: WrenchIcon },
  { title: "Upload", section: "upload", icon: UploadIcon },
  { title: "TikTok clips", section: "tiktok_clips", icon: VideoIcon },
  { title: "Demo fields", section: "demo_schema", icon: ListTreeIcon },
  { title: "Pro movement", section: "pro_movement", icon: RouteIcon },
  { title: "Performance datasets", section: "performance_datasets", icon: DatabaseIcon },
  { title: "Observability", section: "observability", icon: ActivityIcon },
  { title: "Roadmap", section: "roadmap", icon: MapIcon },
]

type BiobaseSidebarProps = React.ComponentProps<typeof Sidebar> & {
  active: DashboardSection
  onNavigate: (section: DashboardSection) => void
  showSignOut: boolean
  onSignOut: () => void
}

export function BiobaseSidebar({
  active,
  onNavigate,
  showSignOut,
  onSignOut,
  ...props
}: BiobaseSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()

  function go(section: DashboardSection) {
    onNavigate(section)
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              isActive={active === "overview"}
              tooltip="Overview"
              onClick={() => go("overview")}
            >
              <span className="text-base font-semibold">BioBase · CS2</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigate</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.section}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={active === item.section}
                    onClick={() => go(item.section)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={{
            name: "Admin",
            email: "Operator",
            avatar: "",
          }}
          onSignOut={showSignOut ? onSignOut : undefined}
        />
      </SidebarFooter>
    </Sidebar>
  )
}
