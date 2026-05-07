import { describe, expect, it } from 'vitest'
import { parsePlayerApiErrorCode } from './playerFetch'

describe('parsePlayerApiErrorCode', () => {
  it('reads code from playerapi.WriteError nested shape', () => {
    const body = JSON.stringify({ error: { code: 'oddin_incomplete', message: 'Set ODDIN_*' } })
    expect(parsePlayerApiErrorCode(body)).toBe('oddin_incomplete')
  })
  it('reads top-level code when present', () => {
    expect(parsePlayerApiErrorCode(JSON.stringify({ code: 'legacy', message: 'x' }))).toBe('legacy')
  })
  it('returns undefined on non-json', () => {
    expect(parsePlayerApiErrorCode('not json')).toBeUndefined()
  })
})
