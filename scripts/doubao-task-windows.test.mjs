import { test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { TaskWindows } from './doubao-task-windows.mjs'

function page() {
  const p = Object.assign(new EventEmitter(), { isClosed: () => false, bringToFront: vi.fn() })
  return p
}

test('生成启动前点击会等待注册，初始化失败不会永久等待', async () => {
  const windows = new TaskWindows()
  windows.reserve('a')
  const pending = windows.open('a')
  const original = page()
  windows.register('a', original, vi.fn())
  await expect(pending).resolves.toEqual({ reopened: false })
  windows.reserve('b')
  const failed = windows.open('b')
  windows.fail('b', new Error('登录态失效'))
  await expect(failed).rejects.toThrow('登录态失效')
})

test('前端请求先到也可等待生成请求注册', async () => {
  const windows = new TaskWindows()
  const pending = windows.open('a', 1000)
  windows.register('a', page())
  await expect(pending).resolves.toEqual({ reopened: false })
})

test('窗口在置前时关闭可恢复，读取者取得恢复后的页面', async () => {
  const windows = new TaskWindows()
  const original = page()
  const restored = page()
  original.bringToFront.mockImplementation(() => {
    original.isClosed = () => true
    original.emit('close')
    throw new Error('Target closed')
  })
  const reopen = vi.fn(async () => restored)
  windows.register('a', original, reopen)
  await expect(windows.open('a')).resolves.toEqual({ reopened: true })
  expect(windows.current('a')).toBe(restored)
  expect(reopen).toHaveBeenCalledOnce()
})

test('窗口未关闭但已跳转时仍执行原对话校验，错误不会报告成功', async () => {
  const windows = new TaskWindows()
  const original = page()
  const ensureTarget = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('原消息不存在'))
  const reopen = vi.fn()
  windows.register('a', original, reopen, ensureTarget)
  await windows.open('a')
  expect(ensureTarget).toHaveBeenCalledWith(original)
  expect(reopen).not.toHaveBeenCalled()
  await expect(windows.open('a')).rejects.toThrow('原消息不存在')
})

test('关闭后可多次恢复原任务，连续点击不会重复创建窗口', async () => {
  const windows = new TaskWindows()
  const a = page()
  const b = page()
  const restored = page()
  const reopen = vi.fn(async () => restored)
  windows.register('a', a, reopen)
  windows.register('b', b)
  await windows.open('b')
  expect(b.bringToFront).toHaveBeenCalledOnce()
  expect(a.bringToFront).not.toHaveBeenCalled()
  a.emit('close')
  await Promise.all([windows.open('a'), windows.open('a')])
  expect(reopen).toHaveBeenCalledOnce()
  restored.emit('close')
  await windows.open('a')
  expect(reopen).toHaveBeenCalledTimes(2)
  expect(() => windows.register('b', a)).toThrow('任务窗口 ID 重复')
})

test('恢复失败可重试，未知任务不会打开其他账号', async () => {
  const windows = new TaskWindows()
  const original = page()
  const reopen = vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValueOnce(page())
  windows.register('a', original, reopen)
  original.emit('close')
  await expect(windows.open('a')).rejects.toThrow('连接失败')
  await expect(windows.open('a')).resolves.toEqual({ reopened: true })
  await expect(windows.open('unknown')).rejects.toMatchObject({ code: 'WINDOW_CLOSED' })
})

test('恢复回调在等待消息时窗口关闭也可重试，而不是泄漏 waitFor 错误', async () => {
  const windows = new TaskWindows()
  const original = page()
  const restored = page()
  const reopen = vi.fn()
    .mockRejectedValueOnce(new Error('locator.waitFor: Target page, context or browser has been closed'))
    .mockResolvedValueOnce(restored)
  windows.register('a', original, reopen)
  original.emit('close')
  await expect(windows.open('a')).resolves.toEqual({ reopened: true })
  expect(reopen).toHaveBeenCalledTimes(2)
  expect(windows.current('a')).toBe(restored)
})

test('连续恢复失败给出明确状态，下次点击仍能恢复', async () => {
  const windows = new TaskWindows()
  const original = page()
  const error = new Error('locator.waitFor: Target page, context or browser has been closed')
  const reopen = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValueOnce(page())
  windows.register('a', original, reopen)
  original.emit('close')
  await expect(windows.open('a')).rejects.toMatchObject({ code: 'WINDOW_INTERRUPTED', cause: error })
  await expect(windows.open('a')).resolves.toEqual({ reopened: true })
})

test('原对话没有消息时保留恢复窗口，再次查看不反复新建或关闭', async () => {
  const windows = new TaskWindows()
  const original = page()
  const restored = page()
  const reopen = vi.fn(async () => restored)
  const ensureTarget = vi.fn().mockRejectedValue(Object.assign(new Error('未读取到本次消息'), { code: 'TASK_MESSAGE_MISSING' }))
  windows.register('a', original, reopen, ensureTarget)
  original.emit('close')
  await expect(windows.open('a')).rejects.toMatchObject({ code: 'TASK_MESSAGE_MISSING' })
  expect(windows.current('a')).toBe(restored)
  await expect(windows.open('a')).rejects.toMatchObject({ code: 'TASK_MESSAGE_MISSING' })
  expect(reopen).toHaveBeenCalledOnce()
  expect(windows.current('a')).toBe(restored)
})
