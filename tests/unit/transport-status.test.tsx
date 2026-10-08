// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {TransportStatus} from '../../frontend/src/components/inbox/TransportStatus'
afterEach(cleanup)
it.each(['completed','ignored',null])('does not show a pending status for %s',state=>{
 render(<TransportStatus state={state} direction="outbound"/>);expect(screen.queryByRole('status')).toBeNull()
})
it('shows saved replies as awaiting send',()=>{render(<TransportStatus state="prepared" direction="outbound"/>);expect(screen.getByRole('status').textContent).toContain('Saved · awaiting send')})
it('shows uncertain delivery with review guidance',()=>{render(<TransportStatus state="needs_review" direction="outbound"/>);expect(screen.getByRole('status').textContent).toContain('Delivery needs review');expect(screen.getByRole('status').textContent).toContain('Check delivery before sending again.')})
it('distinguishes inbound message review from delivery review',()=>{render(<TransportStatus state="needs_review" direction="inbound"/>);expect(screen.getByRole('status').textContent).toContain('Message needs review');expect(screen.getByRole('status').textContent).toContain('Review this message before replying.')})
it('shows an unacknowledged send as awaiting confirmation',()=>{render(<TransportStatus state="sending" direction="outbound"/>);expect(screen.getByRole('status').textContent).toContain('awaiting confirmation')})
