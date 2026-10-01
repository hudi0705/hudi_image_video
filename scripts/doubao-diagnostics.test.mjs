import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { taskDiagnostics } from './doubao-diagnostics.mjs'

test('窗口已关闭仍保存阶段和失败状态，记录不包含 URL 参数或认证信息', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-diagnostic-'))
  try {
    const page = Object.assign(new EventEmitter(), {
      isClosed: () => true,
      url: () => 'https://www.doubao.com/chat/123?token=secret',
    })
    const diagnostic = taskDiagnostics(page, dir, 'task')
    diagnostic.stage('waiting_for_doubao_reply')
    page.emit('response', { status: () => 403, url: () => 'https://example.com/send?token=secret' })
    await diagnostic.flush()
    const journal = await fs.readFile(path.join(dir, 'task.jsonl'), 'utf8')
    expect(journal).toContain('waiting_for_doubao_reply')
    expect(journal).toContain('403')
    expect(journal).not.toContain('secret')
    await diagnostic.save('没有回复')
    diagnostic.dispose()
    const text = await fs.readFile(path.join(dir, 'task.json'), 'utf8')
    const result = JSON.parse(text)
    expect(result.stage).toBe('waiting_for_doubao_reply')
    expect(result.state.closed).toBe(true)
    expect(result.events.at(-1)).toMatchObject({ status: 403, endpoint: 'https://example.com/send' })
    expect(text).not.toContain('secret')
    expect(page.listenerCount('response')).toBe(0)
    expect(page.listenerCount('framenavigated')).toBe(0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('网页取状态卡住时，失败原因已经落盘，截图失败也不会阻塞日志', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-diagnostic-'))
  const page = Object.assign(new EventEmitter(), {
    isClosed: () => false,
    url: () => 'https://www.doubao.com/chat/123',
    evaluate: () => new Promise(() => {}),
    screenshot: vi.fn().mockRejectedValue(new Error('screenshot timeout')),
  })
  try {
    const diagnostic = taskDiagnostics(page, dir, 'stalled')
    const saving = diagnostic.save('消息消失')
    await vi.waitFor(async () => {
      expect(JSON.parse(await fs.readFile(path.join(dir, 'stalled.json'), 'utf8')).reason).toBe('消息消失')
    })
    await saving
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }))
    diagnostic.dispose()
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
