import { setTimeout as delay } from 'node:timers/promises'
import { isWindowInterruption } from './doubao-window-interruption.mjs'

export class TaskWindows {
  pages = new Map()

  update(id, patch) {
    const entry = this.pages.get(id)
    if (entry) entry.status = { ...entry.status, ...patch }
  }

  status(id) {
    return this.pages.get(id)?.status || null
  }

  current(id) {
    const page = this.pages.get(id)?.page
    return page && !page.isClosed() ? page : null
  }

  reserve(id) {
    if (this.pages.has(id)) throw new Error('任务窗口 ID 重复')
    let resolveReady
    const ready = new Promise(resolve => { resolveReady = resolve })
    this.pages.set(id, { ready, resolveReady, preparing: true, pending: null, status: { status: 'sending' } })
  }

  fail(id, error) {
    const entry = this.pages.get(id)
    if (entry?.preparing) {
      entry.error = error
      entry.preparing = false
      entry.resolveReady()
    }
  }

  register(id, page, reopen, ensureTarget) {
    const reserved = this.pages.get(id)
    if (reserved && !reserved.preparing) throw new Error('任务窗口 ID 重复')
    const entry = reserved || { pending: null }
    Object.assign(entry, { page, reopen, ensureTarget, preparing: false })
    this.pages.set(id, entry)
    page.once('close', () => { if (entry.page === page) entry.page = null })
    entry.resolveReady?.()
  }

  async open(id, registrationWaitMs = 0) {
    const deadline = Date.now() + registrationWaitMs
    while (!this.pages.has(id) && Date.now() < deadline) await delay(50)
    const entry = this.pages.get(id)
    if (!entry) {
      const error = new Error('本地服务中没有该任务记录，可能已重启服务')
      error.code = 'WINDOW_CLOSED'
      throw error
    }
    if (entry.ready) await entry.ready
    if (entry.error) throw entry.error
    // 整个“恢复、验证、置前”共用一个 Promise，避免校验时页面被其他点击替换。
    if (entry.pending) return entry.pending
    entry.pending = this.openEntry(entry).finally(() => { entry.pending = null })
    return entry.pending
  }

  async openEntry(entry) {
    let reopened = false
    // 窗口恰好在点击期间关闭时允许恢复一次，不重复提交生成。
    for (let attempt = 0; attempt < 2; attempt++) {
      let target
      try {
      if (!entry.page || entry.page.isClosed()) {
        reopened = true
        if (!entry.reopen) throw new Error('该任务未保存恢复信息')
        const page = await entry.reopen()
        entry.page = page
        page.once('close', () => { if (entry.page === page) entry.page = null })
      }
      target = entry.page
        if (entry.ensureTarget) await entry.ensureTarget(target)
        await target.bringToFront()
        return { reopened }
      } catch (error) {
        // reopen 本身也可能在 goto/waitFor 期间遇到关闭；此时尚未返回 target。
        if (!isWindowInterruption(error, target)) throw error
        if (entry.page === target) entry.page = null
        if (attempt === 1) {
          const interrupted = new Error('豆包窗口在打开或校验过程中关闭，恢复未完成。请稍后再次点击查看；若窗口自动退出，请检查豆包服务终端。没有重新提交生成。', { cause: error })
          interrupted.code = 'WINDOW_INTERRUPTED'
          throw interrupted
        }
      }
    }
  }
}
