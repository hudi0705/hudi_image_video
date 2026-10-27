import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { accountPaths, loadAccountStore, readSession, saveAccount } from './doubao-account-store.mjs'
import { quotaDate, refreshAccountQuota } from './doubao-account-quota.mjs'

afterEach(() => vi.useRealTimers())

test('会话在额度更新及服务重启后仍保留，多个账户互不覆盖', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-store-'))
  try {
    for (const id of ['a', 'b']) {
      const item = { id, name: id, usedToday: 0, storageState: accountPaths(dir, id).storageState }
      await fs.writeFile(item.storageState, JSON.stringify({ cookies: [{ name: 'sessionid', value: id }], origins: [] }))
      await saveAccount(dir, item)
      await saveAccount(dir, { ...item, usedToday: 1 })
    }
    const restored = await loadAccountStore(dir)
    for (const id of ['a', 'b']) {
      assert.equal(restored.get(id).usedToday, 1)
      assert.equal((await readSession(restored.get(id))).cookies[0].value, id)
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('迁移残存旧会话，损坏会话明确要求重新登录', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-migration-'))
  try {
    await fs.writeFile(path.join(dir, 'old.json'), JSON.stringify({ cookies: [{ name: 'sessionid', value: 'saved' }], origins: [] }))
    await fs.writeFile(path.join(dir, 'lost.json'), JSON.stringify({ id: 'lost', name: '损坏账户' }))
    const accounts = await loadAccountStore(dir)
    assert.equal((await readSession(accounts.get('old'))).cookies[0].value, 'saved')
    await assert.rejects(readSession(accounts.get('lost')), { code: 'LOGIN_REQUIRED' })
    assert.ok((await loadAccountStore(dir)).has('old'))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test.each([false, true])('恢复没有日期的旧账户时按资料保存日期判断额度（当日=%s）', async (sameDay) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-09T06:00:00Z'))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-quota-migration-'))
  try {
    const metadata = accountPaths(dir, 'old').metadata
    await fs.writeFile(metadata, JSON.stringify({ id: 'old', name: '旧账户', dailyQuota: 5, usedToday: 6 }))
    const savedAt = new Date(sameDay ? '2026-10-08T18:00:00Z' : '2026-10-08T06:00:00Z')
    await fs.utimes(metadata, savedAt, savedAt)
    const accounts = await loadAccountStore(dir)
    assert.equal(accounts.get('old').quotaDate, '2026-10-09')
    assert.equal(accounts.get('old').usedToday, sameDay ? 6 : 0)
    const persisted = JSON.parse(await fs.readFile(metadata, 'utf8'))
    assert.equal(persisted.quotaDate, '2026-10-09')
    assert.equal(persisted.usedToday, sameDay ? 6 : 0)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('上海零点后重启或继续执行都会重置额度，同日重启仍保留次数和会话', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T15:59:00Z'))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-quota-'))
  try {
    const item = { id: 'a', name: '账户', dailyQuota: 5, usedToday: 5, quotaDate: quotaDate(), storageState: accountPaths(dir, 'a').storageState }
    await fs.writeFile(item.storageState, JSON.stringify({ cookies: [{ name: 'sessionid', value: 'saved' }], origins: [] }))
    await saveAccount(dir, item)
    assert.equal((await loadAccountStore(dir)).get('a').usedToday, 5)
    vi.setSystemTime(new Date('2026-10-08T16:01:00Z'))
    refreshAccountQuota(item)
    assert.equal(item.usedToday, 0)
    assert.equal(item.quotaDate, '2026-10-09')
    const restarted = (await loadAccountStore(dir)).get('a')
    assert.equal(restarted.usedToday, 0)
    assert.equal(restarted.quotaDate, '2026-10-09')
    assert.equal((await readSession(restarted)).cookies[0].value, 'saved')
    restarted.usedToday++
    await saveAccount(dir, restarted)
    assert.equal((await loadAccountStore(dir)).get('a').usedToday, 1)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})
