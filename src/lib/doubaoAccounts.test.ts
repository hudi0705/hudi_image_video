import { describe, expect, it } from 'vitest'
import { availableAccounts, consumeQuota, exhaustQuota, refreshQuota, remainingQuota, type DoubaoAccount } from './doubaoAccounts'

const account = (patch: Partial<DoubaoAccount> = {}): DoubaoAccount => ({
  id: 'a',
  name: '账户A',
  sessionId: 'session-a',
  dailyQuota: 2,
  usedToday: 0,
  quotaDate: '2026-09-22',
  ...patch,
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

  it('marks an account exhausted when the service says the quota is gone', () => {
    const next = exhaustQuota([account({ usedToday: 0 })], 'a', '2026-09-22')
    expect(remainingQuota(next[0], '2026-09-22')).toBe(0)
    expect(availableAccounts(next, '2026-09-22')).toEqual([])
  })
})
