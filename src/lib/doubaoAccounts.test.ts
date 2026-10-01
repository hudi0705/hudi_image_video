import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { availableAccounts, consumeQuota, exhaustQuota, readDoubaoSettings, refreshQuota, remainingQuota, writeDoubaoSettings, type DoubaoAccount } from './doubaoAccounts'

const account = (patch: Partial<DoubaoAccount> = {}): DoubaoAccount => ({
  id: 'a',
  name: '账户A',
  sessionId: 'session-a',
  dailyQuota: 2,
  usedToday: 0,
  quotaDate: '2026-09-22',
  ...patch,
})

describe('doubao video settings', () => {
  beforeEach(() => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['{}', '{"baseUrl":"https://proxy.example"}', '{"ratio":"invalid"}', 'invalid json'])(
    'defaults missing or invalid ratios to 16:9: %s', (saved) => {
      localStorage.setItem('gpt-image-doubao-settings', saved)
      expect(readDoubaoSettings().ratio).toBe('16:9')
    },
  )

  it('preserves the ratio and API address when settings are saved', () => {
    writeDoubaoSettings({ baseUrl: 'https://proxy.example', ratio: '9:16' })
    expect(readDoubaoSettings()).toEqual({ baseUrl: 'https://proxy.example', ratio: '9:16' })
  })
})

describe('doubao account quota', () => {
  it('resets yesterday’s usage on a new Shanghai day', () => {
    const next = refreshQuota(account({ usedToday: 2, quotaDate: '2026-09-21' }), '2026-09-22')
    expect(next.usedToday).toBe(0)
    expect(remainingQuota(next, '2026-09-22')).toBe(2)
  })

  it('skips accounts that have used today’s free quota and tries the next one', () => {
    const accounts = [
      account({ id: 'used', usedToday: 2 }),
      account({ id: 'next', name: '账户B', sessionId: 'session-b', usedToday: 1 }),
    ]
    expect(availableAccounts(accounts, '2026-09-22').map((item) => item.id)).toEqual(['next'])
    expect(consumeQuota(accounts, 'next', '2026-09-22').find((item) => item.id === 'next')?.usedToday).toBe(2)
  })

  it('orders available accounts by least recent use for round-robin generation', () => {
    const accounts = [
      account({ id: 'recent', lastUsedAt: 200 }),
      account({ id: 'old', name: '账户B', sessionId: 'session-b', lastUsedAt: 100 }),
      account({ id: 'never', name: '账户C', sessionId: 'session-c' }),
    ]
    expect(availableAccounts(accounts, '2026-09-22').map((item) => item.id)).toEqual(['never', 'old', 'recent'])
  })

  it('marks an account exhausted when the service says the quota is gone', () => {
    const next = exhaustQuota([account({ usedToday: 0 })], 'a', '2026-09-22')
    expect(remainingQuota(next[0], '2026-09-22')).toBe(0)
    expect(availableAccounts(next, '2026-09-22')).toEqual([])
  })
})
