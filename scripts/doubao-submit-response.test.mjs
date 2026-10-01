import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { completionErrorCodes, completionFailureMessage, watchCompletion } from './doubao-submit-response.mjs'

test('提取 JSON/SSE 错误码，不把对话 ID 或正常事件当成错误', () => {
  expect(completionErrorCodes('{"code":0,"data":{"conversation_id":"123"}}')).toEqual([])
  expect(completionErrorCodes('{"code":7100,"message":"private content"}')).toEqual(['7100'])
  expect(completionErrorCodes('event: error\ndata: {"event_data":"{\\"error_code\\":1234}"}\n\ndata: [DONE]')).toEqual(['1234'])
})

test('官网系统错误码给出含义和边界，不要求用户在空白页寻找提示', () => {
  const message = completionFailureMessage(['710020702'])
  expect(message).toContain('SYSTEM_ERROR（710020702）')
  expect(message).toContain('该错误码未提供具体原因')
  expect(message).not.toContain('请查看原窗口提示')
  expect(completionFailureMessage(['999'])).toContain('999')
})

test('发送限流明确解释草稿和受理状态，不推断具体原因或自动重发', () => {
  const message = completionFailureMessage(['710022004'])
  expect(message).toContain('RateLimit / LIMIT_TO_SEND_MESSAGE')
  expect(message).toContain('710022004')
  expect(message).toContain('草稿')
  expect(message).toContain('任务未确认受理')
  expect(message).toContain('未提供具体限制原因或解除时间')
  expect(message).toContain('未自动重发')
})

test('确认回复被风控拦截时明确提示，并保留原因边界', () => {
  const message = completionFailureMessage(['710022002'])
  expect(message).toContain('SharkBlock / SHARK_BLOCKED')
  expect(message).toContain('710022002')
  expect(message).toContain('未说明具体拦截原因')
  expect(message).toContain('未自动重发')
})

test.each([
  { status: 200, body: '{"code":710022004}', expected: '710022004' },
  { status: 503, body: '{}', expected: 'HTTP 503' },
  { abort: true, expected: '请求中断' },
])('接口失败立即打断等待：$expected', async scenario => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://www.doubao.com/**', route => {
      if (route.request().method() !== 'POST') return route.fulfill({ body: '<main></main>' })
      if (scenario.abort) return route.abort('failed')
      return route.fulfill({ status: scenario.status, contentType: 'application/json', body: scenario.body })
    })
    await page.goto('https://www.doubao.com/chat/')
    const monitor = watchCompletion(page)
    const waiting = monitor.race(new Promise(() => {}))
    const rejected = expect(waiting).rejects.toThrow(scenario.expected)
    await page.evaluate(() => { void fetch('/chat/completion', { method: 'POST' }).catch(() => {}) })
    await rejected
    await expect(monitor.race(Promise.resolve('already visible'))).rejects.toThrow(scenario.expected)
    monitor.dispose()
  } finally {
    await browser.close()
  }
})

test('正常业务响应不会中断页面等待', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: 'application/json', body: '{"code":0}',
    }))
    await page.goto('https://www.doubao.com/chat/')
    const monitor = watchCompletion(page)
    const finished = page.waitForEvent('requestfinished', request => request.method() === 'POST')
    await page.evaluate(() => fetch('/chat/completion', { method: 'POST' }).then(response => response.text()))
    await finished
    await monitor.flush()
    await expect(monitor.race(Promise.resolve('reply saved'))).resolves.toBe('reply saved')
    monitor.dispose()
  } finally {
    await browser.close()
  }
})

test('后续人工确认的请求失败不会覆盖本次已经成功的提交', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    let submissions = 0
    await page.route('https://www.doubao.com/**', route => {
      if (route.request().method() !== 'POST') return route.fulfill({ body: '<main></main>' })
      if (++submissions > 1) return route.abort('failed')
      return route.fulfill({ contentType: 'application/json', body: '{"code":0}' })
    })
    await page.goto('https://www.doubao.com/chat/')
    const monitor = watchCompletion(page)
    const finished = page.waitForEvent('requestfinished', request => request.method() === 'POST')
    await page.evaluate(() => fetch('/chat/completion', { method: 'POST' }).then(response => response.text()))
    await finished
    await monitor.flush()
    const failed = page.waitForEvent('requestfailed', request => request.method() === 'POST')
    await page.evaluate(() => fetch('/chat/completion', { method: 'POST' }).catch(() => {}))
    await failed
    expect(() => monitor.throwIfFailed()).not.toThrow()
    monitor.dispose()
  } finally { await browser.close() }
})

test.each(['/chat/completion', '/samantha/chat/completion'])('%s 返回 HTTP 200 但业务失败时，不以状态码成功放行', async endpoint => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: 'application/json', body: '{"code":7100}',
    }))
    await page.goto('https://www.doubao.com/chat/create-video')
    const events = []
    const monitor = watchCompletion(page, (type, details) => events.push({ type, details }))
    const finished = page.waitForEvent('requestfinished', request => request.method() === 'POST')
    await page.evaluate(endpoint => fetch(endpoint, { method: 'POST' }).then(response => response.text()), endpoint)
    await finished
    await monitor.flush()
    expect(monitor.observed).toBe(true)
    expect(monitor.received).toBe(true)
    expect(() => monitor.throwIfFailed()).toThrow('7100')
    expect(events).toContainEqual({ type: 'completion_response', details: { status: 200 } })
    monitor.dispose()
  } finally {
    await browser.close()
  }
})
