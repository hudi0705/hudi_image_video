import { taskUrlFromCandidates } from './doubao-task-url.mjs'

// 在点击发送前监听导航；只有确认本次消息已发送后才提交绑定。
export class TaskBinding {
  url = ''
  candidate = ''
  sending = false
  confirmed = false
  verified = false

  get recoveryUrl() {
    // 关闭可能发生在发送确认回调之前；候选地址仍可用，但恢复时必须校验消息。
    return this.url || this.candidate
  }

  constructor(page, initialUrl) {
    this.page = page
    this.initialUrl = initialUrl
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) this.observe(frame.url())
    })
  }

  startSending() {
    this.sending = true
    this.observe(this.page.url())
  }

  observe(value) {
    if (!this.sending || this.url) return
    const candidate = taskUrlFromCandidates([value], this.initialUrl)
    if (candidate) this.candidate = candidate
    if (this.confirmed && candidate) this.url = candidate
  }

  confirm() {
    this.confirmed = true
    // 确认消息时的页面优先于发送前/发送中的临时空对话。
    this.candidate = ''
    this.observe(this.page.url())
  }

  confirmVisibleMessage(value) {
    // 页面出现消息后的延迟路由仍可能变化。只有调用者确认本次消息仍在，
    // 才接受新地址；历史校验通过后不再跟随其他对话。
    const next = taskUrlFromCandidates([value], this.initialUrl)
    if (!next || (this.verified && next !== this.url)) return false
    this.url = next
    this.candidate = next
    return true
  }

  markVerified(value) {
    if (value !== this.url) return false
    this.verified = true
    return true
  }
}
