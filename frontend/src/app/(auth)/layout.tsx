import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveAuthToken } from '@/lib/authenticate'
import { NextResponse } from 'next/server'
import { AppShell } from '@/components/layout/AppShell'
import { RouteStateSync } from '@/components/layout/RouteStateSync'

export default async function AuthenticatedLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const cookieStore = await cookies()
  const token = cookieStore.get('sb-access-token')?.value

  if (!token) {
    redirect('/login')
  }

  try {
    await resolveAuthToken(token)
  } catch (error) {
    if (error instanceof NextResponse && error.status === 401) redirect('/login')
    if (error instanceof NextResponse) {
      return <div role="alert">{error.status === 403 ? 'Application membership is required. Contact your administrator.' : 'Authentication service unavailable. Please try again.'}</div>
    }
    throw error
  }

  return (
    <AppShell>
      <RouteStateSync />
      {children}
    </AppShell>
  )
}
