import fs from 'node:fs/promises'
import path from 'node:path'

async function within(promise, milliseconds, fallback) {
  let timer
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds) })])
  } finally {
    clearTimeout(timer)
  }
}

export function taskDiagnostics(page, directory, id) {
  let stage = 'opening'
  const base = path.join(directory, id)
  let writes = fs.mkdir(directory, { recursive: true })
  const events = []
  const record = value => {
    const event = { time: new Date().toISOString(), ...value }
    events.push(event)
    if (events.length > 80) events.shift()
    // 每个阶段/请求即时追加，不能等网页退出等待或截图成功才留下证据。
    writes = writes.then(() => fs.appendFile(`${base}.jsonl`, `${JSON.stringify(event)}\n`)).catch(error => console.error('[豆包诊断写入失败]', error.message))
  }
  const endpoint = value => {
    try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '' }
  }
  const failed = request => record({ type: 'requestfailed', method: request.method(), endpoint: endpoint(request.url()), error: request.failure()?.errorText })
  const response = result => {
    const request = result.request?.()
    if (result.status() >= 400 || ['xhr', 'fetch'].includes(request?.resourceType())) {
      record({ type: 'http', status: result.status(), method: request?.method(), endpoint: endpoint(result.url()) })
    }
  }
  const navigated = frame => {
    if (frame === page.mainFrame()) record({ type: 'navigation', endpoint: endpoint(frame.url()) })
  }
  page.on('requestfailed', failed)
  page.on('response', response)
  page.on('framenavigated', navigated)
  return {
    flush() { return writes },
    event(type, details) { record({ type, ...details }) },
    stage(value) { stage = value; record({ type: 'stage', stage }) },
    async save(reason) {
      await fs.mkdir(directory, { recursive: true })
      let state = { closed: page.isClosed() }
      const snapshot = () => JSON.stringify({ stage, reason, pageUrl: endpoint(page.url()), state, events }, null, 2)
      // 先保存原因，再进行有时间上限的网页检查。浏览器卡住也有可读日志。
      await fs.writeFile(`${base}.json`, snapshot())
      console.error(`[豆包诊断] 阶段=${stage}，记录=${base}.json`)
      if (!page.isClosed()) {
        state = await within(page.evaluate(() => ({
          closed: false,
          editorCharacters: document.querySelector('[data-testid="chat_input_input"]')?.textContent?.length || 0,
          sentMessages: document.querySelectorAll('[data-testid="send_message"]').length,
          receivedMessages: document.querySelectorAll('[data-testid="receive_message"]').length,
          sendDisabled: document.querySelector('[data-testid="chat_input_send_button"]')?.matches(':disabled,[aria-disabled="true"]') ?? null,
        })).catch(() => state), 2000, state)
        await fs.writeFile(`${base}.json`, snapshot())
        await page.screenshot({ path: `${base}.png`, timeout: 5000 }).catch(() => {})
      }
      await writes
    },
    dispose() {
      page.off('requestfailed', failed)
      page.off('response', response)
      page.off('framenavigated', navigated)
    },
  }
}
