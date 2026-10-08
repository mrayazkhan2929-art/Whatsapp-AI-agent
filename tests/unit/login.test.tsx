// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from '../../frontend/src/components/pages/LoginPage'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
afterEach(cleanup)
it('existing login form labels are usable and exposes server errors inline', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Fixture invalid credentials' }), { status: 401 }))
  render(<LoginPage />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'a@example.invalid')
  await user.type(screen.getByLabelText('Password'), 'fixture-password')
  await user.click(screen.getByRole('button', { name: 'Sign In' }))
  expect(await screen.findByText('Fixture invalid credentials')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled()
})
