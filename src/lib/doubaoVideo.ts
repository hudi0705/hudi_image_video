import {
  availableAccounts,
  consumeQuota,
  exhaustQuota,
  readAccounts,
  writeAccounts,
  DEFAULT_VIDEO_RATIO,
  type DoubaoAccount,
  type VideoRatio,
} from './doubaoAccounts'

export const DEFAULT_VIDEO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_VIDEO_MODEL = 'doubao-seedance-2-0'
export const DEFAULT_LOCAL_DOUBAO_URL = 'http://127.0.0.1:8787'
const POLL_INTERVAL_MS = 5000
const MAX_WAIT_MS = 300000
const SUCCESS_STATES = new Set(['succeeded', 'success', 'completed'])
const FAILURE_STATES = new Set(['failed', 'cancelled', 'canceled', 'expired'])

export type LocalVideoProgress = { status?: string; url?: string; downloadUrl?: string; taskUrl?: string; requestText?: string; responseText?: string; accountName?: string }

export class DoubaoQuotaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DoubaoQuotaError'
  }
}

export function isQuotaError(status: number, message: string) {
  if (status === 402 || status === 429) return true
  return /积分|额度|配额|次数已用完|余额不足|quota|insufficient|limit exceeded/i.test(message)
}

function payloadData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {}
  const record = payload as Record<string, unknown>
  return record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record
}

export function readSeedanceTaskId(payload: unknown) {
  const data = payloadData(payload)
  const value = data.id || data.task_id
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function readSeedanceStatus(payload: unknown) {
  const data = payloadData(payload)
  const value = data.status || data.task_status || ''
  return String(value)
}

export function readVideoUrl(payload: unknown): string | null {
  const data = payloadData(payload)
  const content = data.content
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const url = (content as Record<string, unknown>).video_url
    if (typeof url === 'string' && url) return url
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).video_url === 'string') {
        return (item as Record<string, unknown>).video_url as string
      }
    }
  }
  if (typeof data.video_url === 'string' && data.video_url) return data.video_url
  if (typeof data.url === 'string' && data.url) return data.url
  if (!Array.isArray(data.data) || !data.data[0] || typeof data.data[0] !== 'object') return null
  const item = data.data[0] as Record<string, unknown>
  if (typeof item.url === 'string') return item.url
  if (typeof item.b64_json === 'string') return `data:video/mp4;base64,${item.b64_json}`
  return null
}

export async function requestDoubaoVideo(options: {
  baseUrl: string
  account: DoubaoAccount
  prompt: string
  imageDataUrl: string
  model?: string
  duration?: number
  ratio?: VideoRatio
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}) {
  const baseUrl = (options.baseUrl.trim() || DEFAULT_VIDEO_BASE_URL).replace(/\/$/, '')
  const prompt = options.prompt.trim()
  if (!prompt) throw new Error('这个镜头没有动作或音频')
  if (!options.imageDataUrl.startsWith('data:image/')) throw new Error('生成图不是可用的图片')

  const fetchImpl = options.fetchImpl || fetch
  const sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = options.now || Date.now
  const created = await requestJson(fetchImpl, `${baseUrl}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.account.sessionId.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_VIDEO_MODEL,
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: options.imageDataUrl }, role: 'first_frame' },
      ],
      ratio: options.ratio ?? DEFAULT_VIDEO_RATIO,
      duration: options.duration ?? 10,
    }),
  })
  const immediateUrl = readVideoUrl(created.payload)
  if (immediateUrl) return immediateUrl
  const taskId = readSeedanceTaskId(created.payload)
  if (!taskId) throw new Error('创建视频任务成功，但响应里没有任务 ID')

  const deadline = now() + MAX_WAIT_MS
  let lastStatus = 'unknown'
  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const task = await requestJson(fetchImpl, `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${options.account.sessionId.trim()}`, Accept: 'application/json' },
    })
    const status = readSeedanceStatus(task.payload)
    lastStatus = status || lastStatus
    const normalized = status.toLowerCase()
    if (SUCCESS_STATES.has(normalized)) {
      const url = readVideoUrl(task.payload)
      if (!url) throw new Error('视频已完成，但响应里没有视频地址')
      return url
    }
    if (FAILURE_STATES.has(normalized)) throw new Error(`视频任务失败：${readErrorMessage(task.payload) || status}`)
  }
  throw new Error(`等待视频超时，最后状态：${lastStatus}`)
}

export async function generateWithAccountRotation(options: {
  accountId?: string
  baseUrl: string
  prompt: string
  imageDataUrl: string
  model?: string
  duration?: number
  ratio?: VideoRatio
  fetchImpl?: typeof fetch
  onTaskWindow?: (id: string) => void
  onProgress?: (progress: LocalVideoProgress) => void
}) {
  const accounts = availableAccounts(readAccounts()).filter(account => !options.accountId || account.id === options.accountId)
  if (!accounts.length) throw new Error('没有还有今日额度的豆包账户')

  let lastMessage = '所有账户今日额度已用完'
  for (const account of accounts) {
    // 请求前先记录使用时间，避免连续任务总是从列表第一个账户开始。
    const reservedAt = Date.now()
    writeAccounts(readAccounts().map((item) =>
      item.id === account.id ? { ...item, lastUsedAt: reservedAt } : item,
    ))
    try {
      const windowId = crypto.randomUUID()
      options.onTaskWindow?.(windowId)
      const controller = new AbortController()
      let polling = false
      const poll = async () => {
        if (polling) return
        polling = true
        try {
          const response = await fetch(`${DEFAULT_LOCAL_DOUBAO_URL}/task-window/status?windowId=${encodeURIComponent(windowId)}`, { signal: controller.signal })
          if (response.ok) {
            const progress = await response.json()
            if (!controller.signal.aborted) options.onProgress?.(progress)
          }
        } catch { /* The generation response remains authoritative if progress is unavailable. */ }
        finally { polling = false }
      }
      const timer = options.onProgress ? setInterval(() => { void poll() }, 1000) : undefined
      let local: Response
      try {
        local = await fetch(`${DEFAULT_LOCAL_DOUBAO_URL}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: account.id, windowId, prompt: options.prompt, imageDataUrl: options.imageDataUrl, ratio: options.ratio ?? DEFAULT_VIDEO_RATIO }),
        })
      } finally {
        clearInterval(timer)
        controller.abort()
      }
      if (local.ok) {
        const result = await local.json() as LocalVideoProgress
        if (!result.url && !['needs_attention', 'unconfirmed', 'generating'].includes(result.status || '')) throw new Error('豆包本地服务未返回视频地址')
        if (result.url) writeAccounts(consumeQuota(readAccounts(), account.id))
        return { url: result.url || '', downloadUrl: result.url ? `${DEFAULT_LOCAL_DOUBAO_URL}/task-window/video?windowId=${encodeURIComponent(windowId)}` : '', status: result.status || 'completed', taskUrl: result.taskUrl || '', requestText: result.requestText || options.prompt, responseText: result.responseText || '', accountName: result.accountName || account.name }
      }
      const localError = await local.json().catch(() => ({})) as { message?: string; code?: string }
      if (local.status === 401) throw new Error(localError.message || '豆包账号登录已过期')
      if (local.status !== 404) throw Object.assign(new Error(localError.message || '豆包本地服务失败'), { code: localError.code })
      if (!account.sessionId.trim()) throw new Error('请启动豆包本地服务并扫码登录账号')
      const url = await requestDoubaoVideo({ ...options, account })
      writeAccounts(consumeQuota(readAccounts(), account.id))
      return { url, status: 'completed', accountName: account.name }
    } catch (err) {
      if (!(err instanceof DoubaoQuotaError)) throw err
      writeAccounts(exhaustQuota(readAccounts(), account.id))
      lastMessage = `${account.name}：${err.message}`
    }
  }
  throw new Error(lastMessage)
}

async function requestJson(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetchImpl(url, init)
  } catch {
    throw new Error('无法连接火山方舟。浏览器直接访问会被跨域拦住，请把视频接口地址改成你自己的反代。')
  }
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message = readErrorMessage(payload) || text.trim() || `视频接口返回 ${response.status}`
    if (isQuotaError(response.status, message)) throw new DoubaoQuotaError(message)
    throw new Error(message)
  }
  return { payload }
}

function readErrorMessage(payload: unknown) {
  const data = payloadData(payload)
  const value = data.error || data.message || data.error_message
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message || (value as Record<string, unknown>).code
    if (typeof message === 'string') return message
  }
  return ''
}
