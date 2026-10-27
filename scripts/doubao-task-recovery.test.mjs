import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { readTaskConversation } from './doubao-task-recovery.mjs'

test('恢复时把原任务的版权拒绝标记为失败，忽略旧视频和旧回复', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const refusal = '抱歉，由于版权相关限制，暂时无法创作对应的内容，换其他主题试试吧。'
    await page.route('https://www.doubao.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <div data-testid="receive_message"><video src="https://cdn.test/old.mp4"></video>视频生成好了</div>
      <div data-testid="send_message">原视频提示词</div>
      <div data-testid="receive_message">正在生成视频，预计等待</div>
      <div data-testid="receive_message">${refusal}</div>
      <button onclick="document.body.dataset.sent = 'true'">发送</button>` }))
    await page.goto('https://www.doubao.com/chat/123')
    const result = await readTaskConversation(page, { taskUrl: page.url(), requestText: '原视频提示词' }, 'https://www.doubao.com/chat/')
    expect(result).toMatchObject({ status: 'failed', failureReason: '版权限制', tracking: false })
    expect(result.responseText).toContain(refusal)
    expect(result.responseText).not.toContain('视频生成好了')
    expect(await page.locator('body').getAttribute('data-sent')).toBeNull()
  } finally {
    await browser.close()
  }
})

test('恢复只读取原消息和确认后的本次视频，不重新发送，不接受其他对话中的结果', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    let navigations = 0
    await page.route('https://www.doubao.com/**', (route) => {
      navigations++
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <div data-testid="receive_message"><video data-src="https://cdn.test/old.mp4"></video></div>
        <div data-testid="send_message">原视频提示词</div>
        <div data-testid="receive_message">请确认</div>
        <div data-testid="send_message">确认参数</div>
        <div data-testid="receive_message">本次视频已完成<video data-src="https://cdn.test/current.mp4"></video></div>
        <button onclick="document.body.dataset.sent = 'true'">发送</button>` })
    })
    await page.goto('https://www.doubao.com/chat/123')
    await page.evaluate(() => {
      for (const video of document.querySelectorAll('video')) {
        Object.defineProperties(video, { currentSrc: { value: video.dataset.src }, readyState: { value: 4 }, duration: { value: 10 } })
      }
    })
    const record = { taskUrl: page.url(), requestText: '原视频提示词', replyAnchor: '确认参数' }
    const result = await readTaskConversation(page, record, 'https://www.doubao.com/chat/')
    expect(result).toMatchObject({ status: 'completed', url: 'https://cdn.test/current.mp4', responseText: '本次视频已完成', tracking: false })
    expect(await page.locator('body').getAttribute('data-sent')).toBeNull()
    expect(navigations).toBe(1)
    await page.evaluate(() => history.pushState({}, '', '/chat/456'))
    await expect(readTaskConversation(page, record, 'https://www.doubao.com/chat/')).rejects.toThrow('当前窗口已切换到其他页面')
    expect(navigations).toBe(1)
    await expect(readTaskConversation(page, { ...record, taskUrl: '' }, 'https://www.doubao.com/chat/')).rejects.toThrow('尚未取得本次原对话地址')
  } finally {
    await browser.close()
  }
})
