'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { SidebarProvider } from '@/components/ui/sidebar'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { AppSidebar } from './AppSidebar'
import { AppTopBar } from './AppTopBar'
import { CommandPalette } from './CommandPalette'
import { MobileBottomNav } from './MobileBottomNav'

function subscribeToHydration() {
  return () => {}
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const currentPage = useAppStore((state) => state.currentPage)
  const pathname = usePathname()
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  )
  const embeddedModule =
    currentPage === 'lead-scraper' ||
    currentPage === 'whatsapp-campaign' ||
    pathname === '/dashboard/lead-scraper' ||
    pathname === '/dashboard/whatsapp-campaign'

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <main className="p-4 md:p-6">
          <div className="h-6 w-40 rounded-md bg-muted animate-pulse" />
          <div className="mt-4 h-28 rounded-xl bg-muted animate-pulse" />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <SidebarProvider>
      <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-background focus:p-3 focus:ring-2">Skip to workspace content</a>
      <AppSidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <AppTopBar />
        <main
          id="workspace-content"
          tabIndex={-1}
          className={cn(
            'workspace-surface min-w-0 flex-1 bg-gray-50/50 transition-colors dark:bg-gray-950',
            embeddedModule
              ? 'min-h-0 overflow-hidden p-0'
              : 'overflow-auto p-4 pb-16 md:p-6 md:pb-6',
          )}
        >
          {children}
        </main>
        {!embeddedModule && <MobileBottomNav />}
        {/* Footer */}
        {!embeddedModule && (
          <footer className="app-footer hidden md:block">
            <hr className="app-footer-gradient" />
            <div className="px-6 py-3 flex items-center justify-center">
              <p className="text-xs font-semibold text-black dark:text-white [text-shadow:0_0_8px_rgba(16,185,129,0.35)]">
                &copy; 2026 Company workspace. Powered by Artificial Intelligence.
              </p>
            </div>
          </footer>
        )}
      </div>
      <CommandPalette />
    </SidebarProvider>
  )
}
