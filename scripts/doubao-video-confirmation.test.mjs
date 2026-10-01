import { expect, test } from 'vitest'
import { chromium } from 'playwright'
import { VideoConfirmation, needsVideoConfirmation, VIDEO_CONFIRMATION_TEXT } from './doubao-video-confirmation.mjs'
import { currentReplies, markRepliesBeforePrompt } from './doubao-submit.mjs'
import { watchCompletion } from './doubao-submit-response.mjs'
import { verifySavedConversation } from './doubao-saved-conversation.mjs'

test.each([
  '视频生成参数确认\n模型：Seedance 2.0 Mini\n时长：8 秒\n比例：16:9\n确认后我再开始生成视频。',
  '请确认以上参数，确认后开始生成视频。',
  '视频参数已整理，回复“确认”即可开始生成。',
])('识别明确的视频参数确认：%s', text => {
  expect(needsVideoConfirmation(text)).toBe(true)
})

test.each([
  '请确认你的登录信息。',
  '视频生成需要登录，请先确认验证码。',
  '视频无法生成，请确认是否更换素材。',
  '请补充图片，确认后开始生成视频。',
  '视频需要购买积分，确认后生成。',
  '视频生成中，预计等待 5 分钟。',
  '视频生成完成，已确认所有参数。',
  '请确认图片参数，确认后开始生成图片。',
  '无需确认，视频生成中。',
])('不对其他状态自动确认：%s', text => {
  expect(needsVideoConfirmation(text)).toBe(false)
})

async function fixture(browser, responseBody = '{"code":0}') {
  const context = await browser.newContext()
  let requests = 0
  let saved = false
  await context.route('https://www.doubao.com/**', route => {
    if (route.request().method() === 'POST') {
      requests++
      saved = responseBody === '{"code":0}'
      return route.fulfill({ contentType: 'application/json', body: responseBody })
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: saved ? `<div data-testid="send_message">${VIDEO_CONFIRMATION_TEXT}</div>` : '<main></main>' })
  })
  const page = await context.newPage()
  await page.goto('https://www.doubao.com/chat/123')
  await page.setContent(`
    <div data-testid="receive_message" data-before-submit="true">旧回复：确认后生成视频</div>
    <div data-testid="send_message">本次镜头</div>
    <div data-testid="receive_message">视频生成参数确认。确认后我再开始生成视频。</div>
    <div data-testid="chat_input_input"><div contenteditable="true"></div></div>
    <button data-testid="chat_input_send_button">发送</button>`)
  await page.getByTestId('chat_input_send_button').evaluate(button => {
    button.onclick = async () => {
      const editor = document.querySelector('[contenteditable]')
      const sent = document.createElement('div')
      sent.dataset.testid = 'send_message'
      sent.textContent = editor.innerText
      document.body.append(sent)
      editor.innerText = ''
      const response = await fetch('/chat/completion', { method: 'POST' })
      const result = await response.json()
      if (result.code) return
      const reply = document.createElement('div')
      reply.dataset.testid = 'receive_message'
      reply.textContent = '正在生成视频，预计等待 5 分钟。'
      document.body.append(reply)
    }
  })
  return { page, context, requests: () => requests }
}

test('确认一次后继续读取新的生成回复；重复轮询或并发调用都不重复发送', async () => {
  const browser = await chromium.launch()
  let monitor
  try {
    const { page, context, requests } = await fixture(browser)
    const confirmation = new VideoConfirmation()
    const replies = currentReplies(page)
    const options = { stable: true, onSending: () => { monitor = watchCompletion(page); return monitor } }
    const results = await Promise.all([confirmation.reply(page, replies, options), confirmation.reply(page, replies, options)])
    expect(results.sort()).toEqual([false, true])
    await page.getByTestId('receive_message').filter({ hasText: '正在生成视频' }).waitFor()
    await monitor.flush()
    monitor.throwIfFailed()
    expect(await verifySavedConversation(context, page.url(), VIDEO_CONFIRMATION_TEXT, 1000)).toBe(true)
    await markRepliesBeforePrompt(page, VIDEO_CONFIRMATION_TEXT)
    expect(await currentReplies(page).allInnerTexts()).toEqual(['正在生成视频，预计等待 5 分钟。'])
    expect(await confirmation.reply(page, replies, options)).toBe(false)
    expect(requests()).toBe(1)
  } finally { monitor?.dispose(); await browser.close() }
})

test.each(['unstable', 'manual_reply', 'draft', 'latest_generating', 'old_reply'])('跳过自动确认：%s', async scenario => {
  const browser = await chromium.launch()
  try {
    const { page, requests } = await fixture(browser)
    if (scenario === 'manual_reply') await page.evaluate(() => {
      const sent = document.createElement('div'); sent.dataset.testid = 'send_message'; sent.textContent = '确认'; document.body.append(sent)
    })
    if (scenario === 'draft') await page.locator('[contenteditable]').fill('我想把时长改成 6 秒')
    if (scenario === 'latest_generating') await page.evaluate(() => {
      const reply = document.createElement('div'); reply.dataset.testid = 'receive_message'; reply.textContent = '正在生成视频'; document.body.append(reply)
    })
    if (scenario === 'old_reply') await page.getByTestId('receive_message').last().evaluate(node => node.remove())
    const confirmation = new VideoConfirmation()
    expect(await confirmation.reply(page, currentReplies(page), { stable: scenario !== 'unstable' })).toBe(false)
    expect(requests()).toBe(0)
    expect(confirmation.attempted).toBe(false)
    if (scenario === 'draft') expect(await page.locator('[contenteditable]').innerText()).toBe('我想把时长改成 6 秒')
  } finally { await browser.close() }
})

test.each(['710022004', '710022002'])('确认消息被 %s 拒绝时报告失败，不再次回复或继续判为生成中', async code => {
  const browser = await chromium.launch()
  let monitor
  try {
    const { page, requests } = await fixture(browser, JSON.stringify({ code: Number(code) }))
    const confirmation = new VideoConfirmation()
    const options = { stable: true, onSending: () => { monitor = watchCompletion(page); return monitor } }
    const finished = page.waitForEvent('requestfinished', request => request.method() === 'POST')
    await confirmation.reply(page, currentReplies(page), options).catch(error => { expect(error.message).toContain(code) })
    await finished
    await monitor.flush()
    expect(() => monitor.throwIfFailed()).toThrow(code)
    expect(await confirmation.reply(page, currentReplies(page), options)).toBe(false)
    expect(requests()).toBe(1)
  } finally { monitor?.dispose(); await browser.close() }
})

test('确认点击后无法判断是否发送时保留一次尝试，不自动重试', async () => {
  const browser = await chromium.launch()
  try {
    const { page } = await fixture(browser)
    await page.getByTestId('chat_input_send_button').evaluate(button => {
      button.onclick = () => { window.confirmationClicks = (window.confirmationClicks || 0) + 1 }
    })
    const confirmation = new VideoConfirmation()
    await expect(confirmation.reply(page, currentReplies(page), { stable: true, timeout: 200 })).rejects.toThrow('未确认消息发送成功')
    expect(await confirmation.reply(page, currentReplies(page), { stable: true })).toBe(false)
    expect(await page.evaluate(() => window.confirmationClicks)).toBe(1)
  } finally { await browser.close() }
})
