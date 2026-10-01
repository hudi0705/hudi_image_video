import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { checkTaskWindow } from './doubao-task-target.mjs'
import { TaskWindows } from './doubao-task-windows.mjs'
import { TaskBinding } from './doubao-task-binding.mjs'

test('延迟分配真实地址期间点击查看不导航回旧地址、不丢失发送页消息', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const initial = 'https://www.doubao.com/chat/111'
    const actual = 'https://www.doubao.com/chat/222'
    let navigations = 0
    await page.route('https://www.doubao.com/**', route => {
      navigations++
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main></main>' })
    })
    await page.goto(initial)
    const binding = new TaskBinding(page, initial)
    binding.startSending()
    binding.confirm()
    // 模拟网站在消息乐观显示后才更新 SPA 对话地址。
    await page.evaluate(next => {
      document.querySelector('main').innerHTML = '<div data-testid="send_message">本次视频提示词</div>'
      history.pushState({}, '', next)
    }, actual)
    const windows = new TaskWindows()
    windows.register('task', page, undefined, target => checkTaskWindow(target, {
      originalPage: page, active: true, conversationUrl: binding.url, initialUrl: initial, prompt: '本次视频提示词',
    }))
    await Promise.all([windows.open('task'), windows.open('task')])
    expect(page.url()).toBe(actual)
    expect(await page.getByTestId('send_message').innerText()).toBe('本次视频提示词')
    expect(navigations).toBe(1)
    expect(binding.confirmVisibleMessage(page.url())).toBe(true)
    expect(binding.url).toBe(actual)
    binding.markVerified(actual)
    expect(binding.confirmVisibleMessage('https://www.doubao.com/chat/333')).toBe(false)
    // 非活动窗口也不能偷偷导航到旧地址。
    await expect(checkTaskWindow(page, { originalPage: page, active: false, conversationUrl: initial, initialUrl: initial, prompt: '本次视频提示词' })).rejects.toThrow('未自动跳转')
    expect(navigations).toBe(1)
  } finally {
    await browser.close()
  }
})
