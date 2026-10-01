// 只提取错误码，不记录提示词、图片、请求头或完整响应。
export function completionErrorCodes(text) {
  const codes = new Set()
  const inspect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 5) return
    for (const [key, item] of Object.entries(value)) {
      if (['code', 'error_code', 'status_code'].includes(key) &&
          (typeof item === 'number' || typeof item === 'string') &&
          /^-?\d+$/.test(String(item)) && Number(item) !== 0) codes.add(String(item))
      if (['error', 'data', 'event_data', 'base_resp'].includes(key)) {
        if (typeof item === 'string') { try { inspect(JSON.parse(item), depth + 1) } catch {} }
        else inspect(item, depth + 1)
      }
    }
  }
  try { inspect(JSON.parse(text)) } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try { inspect(JSON.parse(line.slice(5).trim())) } catch {}
    }
  }
  return [...codes]
}

export function completionFailureMessage(codes) {
  if (codes.includes('710022002')) {
    return '豆包拦截了本次发送（SharkBlock / SHARK_BLOCKED，710022002），消息未确认受理。请保留原窗口检查验证或限制提示；该错误码未说明具体拦截原因。程序未自动重发，也未扣减本地次数。'
  }
  // 官网同时将此码命名为 RateLimit 和 LIMIT_TO_SEND_MESSAGE。
  if (codes.includes('710022004')) {
    return '豆包限制了本次消息发送（RateLimit / LIMIT_TO_SEND_MESSAGE，710022004），任务未确认受理，页面可能只保留草稿。该错误码未提供具体限制原因或解除时间；请保留原窗口检查提示，如有验证要求请手动完成，稍后再确认是否可以发送。程序未自动重发，也未扣减本地次数。'
  }
  // 豆包官网 chat.702ebf1101.js：SYSTEM_ERROR=0x2a520e5e（710020702）。
  if (codes.includes('710020702')) {
    return '豆包发送接口返回系统错误 SYSTEM_ERROR（710020702），本次任务未确认受理。网页可能因此清空消息并进入空白对话；该错误码未提供具体原因。程序未自动重发，接口与提交阶段已记录到本地诊断。'
  }
  return `豆包发送接口返回业务错误码 ${codes.join('、')}（即使 HTTP 为 200 也不能判为成功），本次任务未确认受理。页面可能没有显示具体原因；未自动重新提交。`
}

export function watchCompletion(page, onEvent = () => {}) {
  let failure = null
  let received = false
  let observed = false
  let trackedRequest
  let pending = Promise.resolve()
  let signalFailure
  const failureSignal = new Promise(resolve => { signalFailure = resolve })
  const matches = request => {
    try {
      const url = new URL(request.url())
      return (!trackedRequest || trackedRequest === request) && url.hostname === 'www.doubao.com' && ['/chat/completion', '/samantha/chat/completion'].includes(url.pathname) && request.method() === 'POST'
    } catch { return false }
  }
  const fail = message => {
    if (failure) return
    failure = new Error(message)
    failure.code = 'DOUBAO_SUBMIT_FAILED'
    signalFailure(failure)
  }
  const request = item => {
    if (matches(item)) {
      trackedRequest = item
      observed = true
      onEvent('completion_requested')
    }
  }
  const response = item => {
    if (!matches(item.request())) return
    received = true
    onEvent('completion_response', { status: item.status() })
    if (item.status() >= 400) fail(`豆包发送接口返回 HTTP ${item.status()}，未确认任务受理。请查看原窗口提示，程序不会自动重发。`)
  }
  const finished = item => {
    if (!matches(item)) return
    pending = (async () => {
      const result = await item.response()
      if (!result) return
      const codes = completionErrorCodes(await result.text())
      onEvent('completion_finished', { errorCodes: codes })
      if (codes.length) fail(completionFailureMessage(codes))
    })().catch(() => onEvent('completion_body_unavailable'))
  }
  const failed = item => {
    if (!matches(item)) return
    onEvent('completion_request_failed')
    fail('豆包发送请求中断，无法确认是否受理。请保留原窗口检查，不要直接重复发送。')
  }
  page.on('request', request)
  page.on('response', response)
  page.on('requestfinished', finished)
  page.on('requestfailed', failed)
  return {
    get observed() { return observed },
    get received() { return received },
    throwIfFailed() { if (failure) throw failure },
    // 信号本身不拒绝，监听器空闲时也不会产生未处理的 Promise 拒绝。
    race(promise) {
      return Promise.race([promise, failureSignal.then(error => { throw error })]).then(value => {
        if (failure) throw failure
        return value
      }, error => { throw failure || error })
    },
    flush() { return pending },
    dispose() {
      page.off('request', request); page.off('response', response)
      page.off('requestfinished', finished); page.off('requestfailed', failed)
    },
  }
}
