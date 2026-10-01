import { expect, test } from 'vitest'
import { chromium } from 'playwright'
import { AccountBrowserPool } from './doubao-browser-pool.mjs'

test('真实浏览器共享账号会话，关闭一个任务页不影响另一个，关闭浏览器后可重建', async () => {
  let launches = 0
  const pool = new AccountBrowserPool({ launch: () => {
    launches++
    return chromium.launch({ headless: true })
  } }, async () => ({ cookies: [], origins: [] }))
  const item = { id: 'test' }
  try {
    const [first, second] = await Promise.all([pool.context(item), pool.context(item)])
    expect(first).toBe(second)
    expect(launches).toBe(1)
    const a = await first.newPage()
    const b = await second.newPage()
    await a.route('https://pool.test/**', route => route.fulfill({ body: '<html>task</html>', contentType: 'text/html' }))
    await b.route('https://pool.test/**', route => route.fulfill({ body: '<html>task</html>', contentType: 'text/html' }))
    await a.goto('https://pool.test/a')
    await a.evaluate(() => localStorage.setItem('shared', 'session'))
    await b.goto('https://pool.test/b')
    expect(await b.evaluate(() => localStorage.getItem('shared'))).toBe('session')
    await a.close()
    expect(await b.locator('body').innerText()).toBe('task')
    await pool.invalidate(item.id)
    expect(await pool.context(item)).not.toBe(first)
    expect(launches).toBe(2)
  } finally {
    await pool.invalidate(item.id)
  }
}, 30000)
