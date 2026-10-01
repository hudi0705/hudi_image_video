import { submitTextMessage } from './doubao-submit.mjs'

export const VIDEO_CONFIRMATION_TEXT = '确认，请按上述参数开始生成视频。'

export function needsVideoConfirmation(text) {
  const value = text.replace(/\s+/g, '')
  if (/无法生成|不能生成|不支持|请补充|请上传|验证码|扫码|登录|余额不足|积分不足|充值|购买|不要确认|无需确认|无需回复/.test(value)) return false
  const context = /视频生成参数确认|生成视频|视频生成|视频[^。！？]*(?:参数|方案|时长|比例)/.test(value)
  const request = /(?:确认后|确认之后|确认以后)[^。！？]{0,35}(?:生成|开始)|(?:请|需要你|等待你|先)(?:回复)?确认|(?:回复|输入)[“"「]?确认/.test(value)
  return context && request
}

export class VideoConfirmation {
  attempted = false

  async reply(page, replies, { stable, timeout = 30000, onSending, onStage } = {}) {
    if (this.attempted || !stable || !await replies.count()) return false
    const latest = replies.last()
    if (!needsVideoConfirmation(await latest.innerText())) return false
    // 人工已经回复或正在输入时，让人工操作继续，不能覆盖编辑器。
    const unanswered = await latest.evaluate(node => {
      const sent = [...document.querySelectorAll('[data-testid="send_message"]')].at(-1)
      return !sent || Boolean(sent.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    if (!unanswered) return false
    const editor = page.getByTestId('chat_input_input').locator('[contenteditable="true"]')
    if (!await editor.isVisible() || (await editor.innerText()).trim()) return false
    if (this.attempted) return false
    this.attempted = true
    await submitTextMessage(page, VIDEO_CONFIRMATION_TEXT, timeout, onSending, onStage)
    return true
  }
}
