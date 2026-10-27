import fs from 'node:fs/promises'
import path from 'node:path'
import { taskUrlFromCandidates } from './doubao-task-url.mjs'

export class TaskStore {
  writes = new Map()

  constructor(directory) {
    this.directory = directory
  }

  file(id, extension) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('任务窗口 ID 无效')
    return path.join(this.directory, `${id}.${extension}`)
  }

  async load() {
    await fs.mkdir(this.directory, { recursive: true })
    const records = new Map()
    for (const name of await fs.readdir(this.directory)) {
      if (!name.endsWith('.json')) continue
      try {
        const id = name.slice(0, -5)
        const record = JSON.parse(await fs.readFile(this.file(id, 'json'), 'utf8'))
        if (!record || typeof record.status !== 'string' || typeof record.accountId !== 'string' || typeof record.requestText !== 'string') continue
        record.taskUrl = taskUrlFromCandidates([record.taskUrl], 'https://www.doubao.com/chat/')
        records.set(id, record)
      } catch (err) {
        console.warn(`[豆包] 无法读取任务记录：${name}`, err)
      }
    }
    return records
  }

  save(id, record) {
    const text = JSON.stringify(record)
    const previous = this.writes.get(id) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const temporary = this.file(id, 'json.tmp')
      await fs.writeFile(temporary, text)
      await fs.rename(temporary, this.file(id, 'json'))
    })
    this.writes.set(id, next)
    void next.catch((err) => console.error(`[豆包] 任务记录保存失败：${id}`, err))
    return next
  }

  async flush(id) {
    await this.writes.get(id)
  }

  async readVideo(id) {
    try {
      return await fs.readFile(this.file(id, 'mp4'))
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
  }

  async saveVideo(id, bytes) {
    const temporary = this.file(id, 'mp4.tmp')
    await fs.writeFile(temporary, bytes)
    await fs.rename(temporary, this.file(id, 'mp4'))
  }
}
