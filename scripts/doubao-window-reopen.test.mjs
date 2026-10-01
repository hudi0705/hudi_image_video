import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { TaskWindows } from './doubao-task-windows.mjs'
import { TaskBinding } from './doubao-task-binding.mjs'
import { currentReplies, markRepliesBeforePrompt } from './doubao-submit.mjs'

test('真实 waitFor 进行中关窗后，恢复过程重新创建页面并成功置前', async () => {
  const browser = await chromium.launch()
  try {
    const original = await browser.newPage()
    const windows = new TaskWindows()
    let attempts = 0
    windows.register('race', original, async () => {
      const restored = await browser.newPage()
      attempts++
      if (attempts === 1) {
        const waiting = restored.getByTestId('send_message').waitFor({ state: 'visible' })
        // 立即安装拒绝处理，避免关闭页面产生未处理 Promise。
        const outcome = waiting.then(() => null, error => error)
        await restored.close()
        throw await outcome
      }
      await restored.setContent('<div data-testid="send_message">本次任务</div>')
      return restored
    })
    await original.close()
    await expect(windows.open('race')).resolves.toEqual({ reopened: true })
    expect(attempts).toBe(2)
    expect(await windows.current('race').getByTestId('send_message').innerText()).toBe('本次任务')
  } finally {
    await browser.close()
  }
})

test('真实浏览器关闭后重复恢复原任务，读取切换到新窗口且不会重新发送', async () => {
  const browsers = []
  const taskUrl = 'https://www.doubao.com/chat/38444341520964610'
  const initial = 'https://www.doubao.com/chat/create-video'
  const launch = async () => {
    const browser = await chromium.launch()
    browsers.push(browser)
    const page = await browser.newPage()
    await page.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<div data-testid="receive_message"><video src="old.mp4"></video>旧回复</div><div data-testid="send_message">镜头一推进</div><div data-testid="receive_message">正在生成本次视频</div>',
    }))
    return page
  }
  try {
    const original = await launch()
    await original.goto(initial)
    const binding = new TaskBinding(original, initial)
    const windows = new TaskWindows()
    windows.reserve('shot-1')
    const opening = windows.open('shot-1')
    const ensure = page => markRepliesBeforePrompt(page, '镜头一推进')
    windows.register('shot-1', original, async () => {
      const restored = await launch()
      await restored.goto(binding.recoveryUrl)
      await ensure(restored)
      return restored
    }, ensure)
    await opening
    binding.startSending()
    await original.goto(taskUrl)
    binding.confirm()
    await browsers[0].close()
    for (let index = 0; index < 2; index++) {
      await Promise.all([windows.open('shot-1'), windows.open('shot-1')])
      const restored = windows.current('shot-1')
      expect(restored.url()).toBe(taskUrl)
      expect(await currentReplies(restored).allInnerTexts()).toEqual(['正在生成本次视频'])
      expect(await currentReplies(restored).locator('video').count()).toBe(0)
      await restored.close()
    }
    expect(browsers).toHaveLength(3)
  } finally {
    await Promise.all(browsers.map(browser => browser.close()))
  }
}, 20000)
