export interface DoubaoAccount {
  id: string
  name: string
  sessionId: string
  dailyQuota: number
  usedToday: number
  quotaDate: string
}

export interface DoubaoSettings {
  baseUrl: string
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
    .filter((account) => account.sessionId.trim() && remainingQuota(account, today) > 0)
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
    }, today)
    return account.sessionId ? [account] : []
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
    return { baseUrl }
  } catch {
    return { baseUrl: '' }
  }
}

export function writeDoubaoSettings(settings: DoubaoSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
