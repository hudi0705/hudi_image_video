export class AccountBrowserPool {
  sessions = new Map()

  constructor(chromium, readSession) {
    this.chromium = chromium
    this.readSession = readSession
  }

  async context(item) {
    let pending = this.sessions.get(item.id)
    if (!pending) {
      pending = this.create(item)
      this.sessions.set(item.id, pending)
      void pending.catch(() => {
        if (this.sessions.get(item.id) === pending) this.sessions.delete(item.id)
      })
    }
    return pending
  }

  async create(item) {
    const storageState = await this.readSession(item)
    const browser = await this.chromium.launch({ headless: false })
    try {
      const context = await browser.newContext({ storageState, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
      browser.once('disconnected', () => {
        void this.sessions.get(item.id)?.then(current => {
          if (current === context) this.sessions.delete(item.id)
        }).catch(() => {})
      })
      return context
    } catch (error) {
      await browser.close().catch(() => {})
      throw error
    }
  }

  async invalidate(accountId) {
    const pending = this.sessions.get(accountId)
    this.sessions.delete(accountId)
    if (pending) await (await pending).browser().close()
  }
}
