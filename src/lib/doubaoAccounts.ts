export interface DoubaoAccount {
  id: string
  name: string
  sessionId: string
  dailyQuota: number
  usedToday: number
  quotaDate: string
  /** 调度器用于按最近使用时间轮换账户。 */
  lastUsedAt?: number
}

export const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const
export type VideoRatio = typeof VIDEO_RATIOS[number]
export const DEFAULT_VIDEO_RATIO: VideoRatio = '16:9'

export interface DoubaoSettings {
  baseUrl: string
  ratio: VideoRatio
}

const ACCOUNTS_KEY = 'gpt-image-doubao-accounts'
const SETTINGS_KEY = 'gpt-image-doubao-settings'

export function quotaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function refreshQuota(account: DoubaoAccount, today = quotaDate()): DoubaoAccount {
  if (account.quotaDate === today) return account
  return { ...account, usedToday: 0, quotaDate: today }
}

export function remainingQuota(account: DoubaoAccount, today = quotaDate()) {
  const current = refreshQuota(account, today)
  return Math.max(0, current.dailyQuota - current.usedToday)
}

export function availableAccounts(accounts: DoubaoAccount[], today = quotaDate()) {
  return accounts
    .map((account) => refreshQuota(account, today))
    .filter((account) => (account.sessionId.trim() || account.id.trim()) && remainingQuota(account, today) > 0)
    .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))
}

export function consumeQuota(accounts: DoubaoAccount[], accountId: string, today = quotaDate()) {
  return accounts.map((account) => {
    const current = refreshQuota(account, today)
    if (current.id !== accountId) return current
    return { ...current, usedToday: current.usedToday + 1 }
  })
}

export function exhaustQuota(accounts: DoubaoAccount[], accountId: string, today = quotaDate()) {
  return accounts.map((account) => {
    const current = refreshQuota(account, today)
    if (current.id !== accountId) return current
    return { ...current, usedToday: current.dailyQuota }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeAccounts(value: unknown, today = quotaDate()): DoubaoAccount[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sessionId !== 'string') return []
    const dailyQuota = Math.max(1, Math.floor(Number(item.dailyQuota) || 1))
    const account = refreshQuota({
      id: item.id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名账户',
      sessionId: item.sessionId.trim(),
      dailyQuota,
      usedToday: Math.max(0, Math.floor(Number(item.usedToday) || 0)),
      quotaDate: typeof item.quotaDate === 'string' ? item.quotaDate : today,
      lastUsedAt: Number.isFinite(Number(item.lastUsedAt)) ? Number(item.lastUsedAt) : 0,
    }, today)
    // 网页登录账号不使用 API Key，凭账号 ID 对应本地 storage_state。
    return account.id ? [account] : []
  })
}

export function readAccounts() {
  try {
    return normalizeAccounts(JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]'))
  } catch {
    return []
  }
}

export function writeAccounts(accounts: DoubaoAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
}

export function readDoubaoSettings(): DoubaoSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as unknown
    const baseUrl = isRecord(parsed) && typeof parsed.baseUrl === 'string' ? parsed.baseUrl : ''
    const ratio = isRecord(parsed) && VIDEO_RATIOS.includes(parsed.ratio as VideoRatio)
      ? parsed.ratio as VideoRatio : DEFAULT_VIDEO_RATIO
    return { baseUrl, ratio }
  } catch {
    return { baseUrl: '', ratio: DEFAULT_VIDEO_RATIO }
  }
}

export function writeDoubaoSettings(settings: DoubaoSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
