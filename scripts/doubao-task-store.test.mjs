import { test, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { TaskStore } from './doubao-task-store.mjs'
import { TaskWindows } from './doubao-task-windows.mjs'

test('服务重启恢复完成任务、原账号和视频缓存，进行中任务标记中断且不重新提交', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-tasks-'))
  try {
    const store = new TaskStore(dir)
    const windows = new TaskWindows(store)
    for (const [id, status] of [['done', 'completed'], ['active', 'generating'], ['queued', 'queued']]) {
      windows.reserve(id)
      windows.update(id, { accountId: 'original-account', requestText: '原提示词', taskUrl: 'https://www.doubao.com/chat/123', status, tracking: status !== 'completed', responseText: '原回复' })
      await windows.flush(id)
    }
    const bytes = Buffer.from('video-bytes')
    await store.saveVideo('done', bytes)
    const restartedStore = new TaskStore(dir)
    const restarted = new TaskWindows(restartedStore)
    const page = Object.assign(new EventEmitter(), { isClosed: () => false, bringToFront: vi.fn() })
    const reopen = vi.fn(async () => page)
    const recover = vi.fn(() => ({ reopen }))
    await restarted.load(recover)
    expect(restarted.status('done')).toMatchObject({ status: 'completed', accountId: 'original-account', tracking: false, responseText: '原回复' })
    expect(restarted.status('active')).toMatchObject({ status: 'interrupted', tracking: false, requestText: '原提示词' })
    expect(restarted.status('queued')).toMatchObject({ status: 'paused', tracking: false })
    expect(await restartedStore.readVideo('done')).toEqual(bytes)
    expect(reopen).not.toHaveBeenCalled()
    await restarted.open('active')
    expect(reopen).toHaveBeenCalledExactlyOnceWith()
    expect(() => restarted.reserve('active')).toThrow('任务窗口 ID 重复')
    await Promise.all(['done', 'active', 'queued'].map((id) => restarted.flush(id)))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('并发更新按顺序落盘，忽略损坏记录，拒绝目录越界的任务 ID', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-tasks-'))
  try {
    const store = new TaskStore(dir)
    await store.load()
    const record = { accountId: 'a', requestText: '提示词', status: 'sending' }
    await Promise.all([store.save('task', record), store.save('task', { ...record, status: 'completed' })])
    await fs.writeFile(path.join(dir, 'broken.json'), '{')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const loaded = await new TaskStore(dir).load()
    expect(loaded.get('task').status).toBe('completed')
    expect(loaded.has('broken')).toBe(false)
    expect(() => store.file('../outside', 'json')).toThrow('任务窗口 ID 无效')
  } finally {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  }
})
