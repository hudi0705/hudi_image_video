import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { accountPaths, loadAccountStore, readSession, saveAccount } from './doubao-account-store.mjs'

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
