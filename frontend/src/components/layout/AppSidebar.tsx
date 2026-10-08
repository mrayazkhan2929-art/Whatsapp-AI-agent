'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCompanyProfile } from '@/lib/company-profile'
import { useAppStore, type AppPage } from '@/lib/store'
import { useAuthProfile } from '@/lib/use-auth-profile'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'
import {
  Building2,
  Bot,
  LayoutDashboard,
  MessageSquare,
  Users,
  Columns3,
  UserCog,
  BookOpen,
  GitBranch,
  CalendarDays,
  BarChart3,
  Bell,
  ScrollText,
  Search,
  Send,
  Smartphone,
  Settings,
  ChevronRight,
  LogOut,
  Trophy,
  BellRing,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface NavItem {
  title: string
  page?: AppPage
  icon: React.ElementType
  badge?: string | number
  children?: { title: string; page: AppPage }[]
}

const navItems: NavItem[] = [
  { title: 'Getting started', page: 'onboarding', icon: Building2 },
  { title: 'Dashboard', page: 'dashboard', icon: LayoutDashboard },
  { title: 'Inbox', page: 'inbox', icon: MessageSquare },
  { title: 'Contacts', page: 'contacts', icon: Users },
  { title: 'Pipeline', page: 'pipeline', icon: Columns3 },
  { title: 'Properties', page: 'properties', icon: Building2 },
  { title: 'Team', page: 'team', icon: UserCog },
  { title: 'AI Studio', page: 'ai-studio', icon: Bot },
  { title: 'Performance', page: 'team-performance', icon: Trophy },
  { title: 'Knowledge Base', page: 'knowledge-base', icon: BookOpen },
  { title: 'Flows', page: 'flows', icon: GitBranch },
  { title: 'Bookings', page: 'bookings', icon: CalendarDays },
  { title: 'Analytics', page: 'analytics', icon: BarChart3 },
  { title: 'Nudges', page: 'nudges', icon: Bell },
  { title: 'Execution Evidence', page: 'execution-traces', icon: ScrollText },
  { title: 'Activity Log', page: 'activity-log', icon: ScrollText },
  { title: 'Devices', page: 'devices', icon: Smartphone },
  { title: 'Lead Scraper', page: 'lead-scraper', icon: Search },
  { title: 'WhatsApp Campaign', page: 'whatsapp-campaign', icon: Send },
  {
    title: 'Settings',
    page: 'settings',
    icon: Settings,
    children: [
      { title: 'Company & workspace', page: 'settings' },
      { title: 'Team', page: 'settings-team' },
      { title: 'Handoff', page: 'settings-handoff' },
      { title: 'Billing', page: 'settings-billing' },
      { title: 'API', page: 'settings-api' },
      { title: 'Notifications', page: 'settings-notifications' },
    ],
  },
]

export function AppSidebar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  const authProfile = useAuthProfile()
  const companyQuery = useQuery({ queryKey: ['company-profile', authProfile.profile?.orgId], queryFn: fetchCompanyProfile, enabled: Boolean(authProfile.profile), staleTime: 30_000 })
  const brand = companyQuery.data?.short_name || companyQuery.data?.legal_name || 'Your workspace'
  const [settingsDisclosure,setSettingsDisclosure]=useState({page:currentPage,open:currentPage.startsWith('settings')})
  const settingsOpen=settingsDisclosure.page===currentPage?settingsDisclosure.open:currentPage.startsWith('settings')
  const setSettingsOpen=(open:boolean)=>setSettingsDisclosure({page:currentPage,open})

  const handleNav = (page?: AppPage) => {
    if (page) {
      setCurrentPage(page)
    }
  }

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      {/* Mobile backdrop blur overlay */}
      <style>{`
        [data-sidebar="sidebar"][data-state="open"] + div::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: 39;
          background: oklch(0 0 0 / 30%);
          backdrop-filter: blur(4px) saturate(1.2);
          -webkit-backdrop-filter: blur(4px) saturate(1.2);
          opacity: 1;
          transition: opacity 0.2s ease;
        }
        @media (min-width: 1024px) {
          [data-sidebar="sidebar"][data-state="open"] + div::before { display: none; }
        }
      `}</style>

      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-11 w-11 rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <AvatarImage src={companyQuery.data?.logo_url || undefined} alt={brand + ' logo'} className="object-contain p-1" />
            <AvatarFallback className="rounded-xl bg-emerald-500/10 text-emerald-500"><Building2 className="h-5 w-5" /></AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold text-sidebar-foreground" title={brand}>{brand}</span>
            <span className="text-[11px] text-muted-foreground">Company workspace</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.filter(item=>item.page!=='execution-traces'||['owner','admin'].includes(authProfile.profile?.role??'')).map((item) => {
                if (item.children) {
                  const isActive = currentPage.startsWith('settings')
                  return (
                    <SidebarMenuItem key={item.title} className={`${isActive ? 'sidebar-active-indicator hover-underline-slide' : ''} ${isActive ? '[data-active=true]' : ''}`}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.title}
                        className="glass-sidebar-item hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors duration-150"
                        onClick={() => {
                          handleNav(item.page)
                          setSettingsOpen(!settingsOpen)
                        }}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                        <ChevronRight className={`ml-auto h-4 w-4 transition-transform duration-200 ${settingsOpen ? 'rotate-90' : ''}`} />
                      </SidebarMenuButton>
                      {settingsOpen && (
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.title}>
                              <SidebarMenuSubButton
                                isActive={currentPage === child.page}
                                className="hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors duration-150"
                                onClick={() => handleNav(child.page)}
                              >
                                <span>{child.title}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  )
                }

                const isActive = currentPage === item.page
                return (
                  <SidebarMenuItem key={item.title} className={`${isActive ? 'sidebar-active-indicator hover-underline-slide' : ''} ${isActive ? '[data-active=true]' : ''}`}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      className="glass-sidebar-item hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors duration-150"
                      onClick={() => handleNav(item.page)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.badge && (
                      <SidebarMenuBadge className="bg-emerald-600 text-white text-[10px] min-w-[20px] h-5 sidebar-badge-pulse">
                        {item.badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-gradient-footer">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-emerald-600 text-white text-xs font-semibold">
              {authProfile.initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-medium text-white truncate">{authProfile.displayName}</span>
            <span className="text-[11px] text-slate-400 truncate">{authProfile.profile?.email ?? 'Loading...'}</span>
          </div>
          <button
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors group-data-[collapsible=icon]:hidden"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
