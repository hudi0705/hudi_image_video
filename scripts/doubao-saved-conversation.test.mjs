import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { verifySavedConversation } from './doubao-saved-conversation.mjs'

test('发送页本地显示消息但历史为空时校验失败；保存后独立读取通过', async () => {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    let saved = false
    await context.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: saved ? '<div data-testid="send_message">镜头推进</div>' : '<h1>新对话</h1>',
    }))
    const original = await context.newPage()
    await original.setContent('<div data-testid="send_message">镜头推进</div>')
    const url = 'https://www.doubao.com/chat/38444341520964610'
    expect(await verifySavedConversation(context, url, '镜头推进', 300)).toBe(false)
    expect(context.pages()).toEqual([original])
    saved = true
    expect(await verifySavedConversation(context, url, '镜头推进', 1000)).toBe(true)
    expect(context.pages()).toEqual([original])
    expect(await verifySavedConversation(context, url, '其他任务', 300)).toBe(false)
    await context.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<div data-testid="send_message"><p>动作：推进</p><p>时长：8 秒</p></div>',
    }))
    expect(await verifySavedConversation(context, url, '动作：推进\n时长：8秒', 1000)).toBe(true)
  } finally {
    await browser.close()
  }
})
