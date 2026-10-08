import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveAuthToken } from '@/lib/authenticate'
import { NextResponse } from 'next/server'
import { LoginPage } from '@/components/pages/LoginPage'

export default async function LoginRoutePage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('sb-access-token')?.value

  if (token) {
    let authorized = false
    try { await resolveAuthToken(token); authorized = true }
    catch (error) {
      if (!(error instanceof NextResponse)) throw error
      if (error.status >= 500) return <div role="alert">Authentication service unavailable. Please try again.</div>
    }
    if (authorized) redirect('/dashboard')
  }

  return <LoginPage />
}
