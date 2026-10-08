import { expect, it } from 'vitest'
import { buildCursor, parseCursor } from '../../backend/src/api/http'
it('roundtrips the current API pagination cursor', () => {
  const createdAt = '2026-10-06T00:00:00Z'
  expect(parseCursor(buildCursor(createdAt, 'row-1'))).toEqual({ createdAt, id: 'row-1' })
  expect(parseCursor(null)).toBeNull()
  expect(parseCursor('malformed')).toBeNull()
})
