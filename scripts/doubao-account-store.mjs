import fs from 'node:fs/promises'
import path from 'node:path'

export function accountPaths(dir, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('账号 ID 无效')
  return {
    metadata: path.join(dir, `${id}.account.json`),
    storageState: path.join(dir, `${id}.session.json`),
  }
}

export async function saveAccount(dir, item) {
  const paths = accountPaths(dir, item.id)
  await fs.writeFile(paths.metadata, JSON.stringify({ ...item, storageState: paths.storageState }, null, 2))
}

export async function loadAccountStore(dir) {
  const accounts = new Map()
  const names = await fs.readdir(dir)
  // 旧版把资料和会话放在同一个文件；仅迁移尚可恢复的数据，不删除原文件。
  for (const name of names.filter((name) => name.endsWith('.json') && !name.endsWith('.session.json')).sort((a, b) => Number(a.endsWith('.account.json')) - Number(b.endsWith('.account.json')))) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
      const id = name.replace(/(?:\.account)?\.json$/, '')
      const paths = accountPaths(dir, id)
      const session = Array.isArray(data.cookies) && Array.isArray(data.origins)
      const item = session
        ? { id, name: `恢复账户 ${id}`, dailyQuota: 5, usedToday: 0, storageState: paths.storageState }
        : { ...data, id, storageState: paths.storageState }
      if (!item.name) continue
      if (session) {
        try {
          await fs.writeFile(paths.storageState, JSON.stringify(data), { flag: 'wx' })
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
        }
      }
      accounts.set(id, item)
    } catch {
      console.warn(`[豆包] 无法读取账号文件：${name}`)
    }
  }
  for (const item of accounts.values()) await saveAccount(dir, item)
  return accounts
}

export async function readSession(item) {
  try {
    const state = JSON.parse(await fs.readFile(item.storageState, 'utf8'))
    if (Array.isArray(state.cookies) && state.cookies.length && Array.isArray(state.origins)) return state
  } catch {}
  const error = new Error(`${item.name} 的登录态缺失或损坏，请重新登录该账户`)
  error.code = 'LOGIN_REQUIRED'
  throw error
}
