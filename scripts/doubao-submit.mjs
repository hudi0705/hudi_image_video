import { completionErrorCodes } from './doubao-submit-response.mjs'
import { sentMessagesForPrompt } from './doubao-message-match.mjs'

// 从主聊天页选择技能，不能使用仍可访问但提交协议过时的 create-video 专页。
export async function submitVideoMessage(page, imagePath, prompt, confirmationTimeout = 30000, onSending = () => {}, onStage = () => {}) {
  onStage('selecting_video_mode')
  const videoMode = page.locator('[data-testid="skill_input_exit_button"][data-value="17"]').first()
  if (!await videoMode.isVisible()) {
    await page.getByRole('button', { name: '视频生成', exact: true }).click({ timeout: 30000 })
  }
  await videoMode.waitFor({ state: 'visible', timeout: 30000 })
  onStage('waiting_for_editor')
  const editor = page.getByTestId('chat_input_input').locator('[contenteditable="true"]')
  await editor.waitFor({ state: 'visible' })
  const received = page.getByTestId('receive_message')
  await received.evaluateAll((nodes) => nodes.forEach((node) => node.setAttribute('data-before-submit', 'true')))
  onStage('attaching_image')
  const [processed] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.hostname === 'www.doubao.com' && url.pathname === '/alice/message/pre_handle_v2_without_conv' && response.request().method() === 'POST'
    }, { timeout: 60000 }),
    page.getByTestId('upload-file-input').setInputFiles(imagePath),
  ])
  const codes = completionErrorCodes(await processed.text())
  if (!processed.ok() || codes.length) {
    throw new Error(`豆包图片预处理失败（${codes.join('、') || `HTTP ${processed.status()}`}），未发送生成请求。`)
  }
  const imageName = imagePath.split(/[\\/]/).at(-1)
  await page.getByTestId('attachment-image-card').getByRole('img', { name: imageName, exact: true }).waitFor({ state: 'visible', timeout: 30000 })
  onStage('image_preprocessed')
  await videoMode.waitFor({ state: 'visible', timeout: 30000 })
  await submitTextMessage(page, prompt, confirmationTimeout, onSending, onStage)
}

export async function submitTextMessage(page, prompt, confirmationTimeout = 30000, onSending = () => {}, onStage = () => {}) {
  const editor = page.getByTestId('chat_input_input').locator('[contenteditable="true"]')
  await editor.waitFor({ state: 'visible', timeout: confirmationTimeout })
  const sentBefore = await page.getByTestId('send_message').count()
  onStage('filling_prompt')
  // 通过键盘更新 ProseMirror 状态，保留其内部节点结构。
  await editor.press('ControlOrMeta+A')
  await editor.press('Backspace')
  const lines = prompt.replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (index) await editor.press('Shift+Enter')
    await editor.pressSequentially(lines[index])
  }
  await editor.press('End')
  await page.waitForFunction(expected => {
    const node = document.querySelector('[data-testid="chat_input_input"] [contenteditable="true"]')
    const actual = node?.value ?? node?.innerText ?? ''
    return actual.replace(/\s+/g, ' ').trim() === expected.replace(/\s+/g, ' ').trim()
  }, prompt, { timeout: confirmationTimeout })
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="chat_input_send_button"]')
    return button && !button.matches(':disabled,[aria-disabled="true"],[data-disabled="true"],[data-loading="true"]')
  }, null, { timeout: 30000 })
  // 不能用“生成”模糊匹配：会命中切换模式按钮，未必发送消息。
  const completion = onSending()
  const wait = promise => completion ? completion.race(promise) : promise
  onStage('clicking_send')
  await wait(page.getByTestId('chat_input_send_button').click({ timeout: 30000 }))
  onStage('waiting_for_sent_message')
  try {
    await wait(page.waitForFunction(({ prompt, sentBefore }) => {
      const sent = [...document.querySelectorAll('[data-testid="send_message"]')].slice(sentBefore)
      const normalize = text => text.replace(/[\s\u200b-\u200d\ufeff]/g, '')
      const normalized = normalize(prompt)
      return sent.some((node) => normalize(node.textContent || '').includes(normalized))
    }, { prompt, sentBefore }, { timeout: confirmationTimeout }))
    completion?.throwIfFailed()
    onStage('sent_message_visible')
  } catch (error) {
    completion?.throwIfFailed()
    if (page.isClosed() || /Target (?:page, context or browser|closed)|browser has been closed|Page crashed/i.test(error?.message || '')) throw error
    throw new Error('未确认消息发送成功：消息列表中未出现本次提示词。请查看豆包窗口，程序不会自动重发或扣减本地次数。')
  }
}

export function currentReplies(page) {
  return page.locator('[data-testid="receive_message"]:not([data-before-submit="true"])')
}

export function videoReplyStatus(latestReply, stable) {
  if (/预计等待|视频生成中|正在生成|视频生成好了|生成完成/.test(latestReply)) return 'generating'
  return stable && /请确认|先确认|参数确认|确认后.*生成|请补充|直接回复|无法生成|不能生成|不支持/.test(latestReply)
    ? 'needs_attention' : 'generating'
}

export async function activateReplyVideo(replies) {
  if (await replies.locator('video').count() || !await replies.locator('[data-video-conner-tag]').count()) return false
  const preview = replies.locator('[class*="video-player-wrapper"]:not([data-workstation-preview-opened])').last()
  if (!await preview.count()) return false
  await preview.click({ timeout: 2000 })
  await preview.evaluate(node => node.setAttribute('data-workstation-preview-opened', 'true'))
  return true
}

export async function markRepliesBeforePrompt(page, prompt) {
  await sentMessagesForPrompt(page, prompt).last().evaluate(sent => {
    for (const reply of document.querySelectorAll('[data-testid="receive_message"]')) {
      if (sent.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_PRECEDING) {
        reply.setAttribute('data-before-submit', 'true')
      } else {
        reply.removeAttribute('data-before-submit')
      }
    }
  })
}
