import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { currentReplies } from './doubao-submit.mjs'
import { interruptedTaskResult } from './doubao-window-interruption.mjs'

const progress = {
  submitted: true,
  conversationUrl: 'https://www.doubao.com/chat/123456',
  prompt: '让画面动起来',
  previousReply: '正在生成视频',
}

test.each(['page', 'context', 'browser'])('读取回复前关闭 %s 时保留原任务且不标记完成', async (target) => {
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.setContent('<div data-testid="receive_message">正在生成视频</div>')
    expect(await currentReplies(page).allInnerTexts()).toEqual(['正在生成视频'])
    await ({ page, context, browser })[target].close()
    const result = await currentReplies(page).allInnerTexts().catch(error => interruptedTaskResult(error, page, progress))
    expect(result).toMatchObject({ status: 'unconfirmed', url: '', taskUrl: progress.conversationUrl, requestText: progress.prompt })
    expect(result.responseText).toContain(progress.previousReply)
    expect(result.responseText).toContain('请勿重复提交')
    expect(result.responseText).toContain('重新打开原对话')
    expect(result.responseText).not.toContain('allInnerTexts')
  } finally {
    await browser.close()
  }
})

test('未确认发送且无对话地址时不声称已发送或可以恢复窗口', () => {
  const result = interruptedTaskResult(new Error('Target page, context or browser has been closed'), undefined, {
    ...progress, submitted: false, conversationUrl: '', previousReply: '',
  })
  expect(result.status).toBe('unconfirmed')
  expect(result.taskUrl).toBe('')
  expect(result.responseText).toContain('尚未确认消息是否发送成功')
  expect(result.responseText).toContain('手动打开豆包')
  expect(result.responseText).not.toContain('重新打开原对话')
})

test('页面崩溃也保留任务，其他异常继续抛出', () => {
  expect(interruptedTaskResult(new Error('locator.allInnerTexts: Page crashed'), { isClosed: () => false }, progress).status).toBe('unconfirmed')
  const error = new Error('窗口已离开本次对话')
  expect(() => interruptedTaskResult(error, { isClosed: () => false }, progress)).toThrow(error)
})

test('关窗不能把已确认的提交失败改写为可能仍在生成', () => {
  const error = new Error('豆包发送受限：710022004')
  error.code = 'DOUBAO_SUBMIT_FAILED'
  expect(() => interruptedTaskResult(error, { isClosed: () => true }, progress)).toThrow(error)
})
