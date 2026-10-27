import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { VideoTaskRecord } from '../types'
import { loadVideoTasks, removeVideoTasks, updateVideoTask, useVideoTaskStore } from './videoTaskStore'

const record: VideoTaskRecord = {
  id: 'shot', imageId: 'selected-image', windowId: 'window', accountId: 'account', status: 'completed', statusText: '已保存',
  requestText: '原提示词', responseText: '原回复', taskUrl: 'https://www.doubao.com/chat/123', url: 'blob:video',
  downloadUrl: 'http://127.0.0.1:8787/task-window/video?windowId=window', tracking: false, retryable: false, uncertain: false, saveState: 'saved',
}

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  })
  useVideoTaskStore.setState({ records: {}, loaded: false, storageError: '' })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('刷新恢复原任务关联及保存结果，缺失字段和无效记录保持兼容', () => {
  localStorage.setItem('gpt-image-video-tasks', JSON.stringify({
    shot: record, old: { imageId: 'image', status: 'failed' }, invalid: { status: 'completed' },
  }))
  loadVideoTasks()
  expect(useVideoTaskStore.getState().records.shot).toMatchObject(record)
  expect(useVideoTaskStore.getState().records.old).toMatchObject({ url: '', tracking: false, saveState: 'pending' })
  expect(useVideoTaskStore.getState().records.invalid).toBeUndefined()
})

test('刷新中断的文件写入恢复为待保存；无任务标识时保留消息并要求先确认原任务', () => {
  localStorage.setItem('gpt-image-video-tasks', JSON.stringify({
    shot: { ...record, saveState: 'saving' },
    interrupted: { ...record, windowId: undefined, tracking: true, status: 'sending' },
  }))
  loadVideoTasks()
  expect(useVideoTaskStore.getState().records.shot).toMatchObject({ saveState: 'pending', statusText: '视频已生成，保存过程被中断，请重新保存' })
  expect(useVideoTaskStore.getState().records.interrupted).toMatchObject({ tracking: false, retryable: true, uncertain: true, requestText: '原提示词' })
})

test('删除任务同步清理持久化记录，迟到的进度更新不能复活已删除任务', () => {
  loadVideoTasks()
  updateVideoTask('shot', record)
  updateVideoTask('kept', { ...record, id: 'kept' })
  removeVideoTasks(['shot'])
  updateVideoTask('shot', { status: 'completed', url: 'https://cdn.test/late.mp4' })
  useVideoTaskStore.setState({ records: {}, loaded: false })
  loadVideoTasks()
  expect(Object.keys(useVideoTaskStore.getState().records)).toEqual(['kept'])
})

test('存储损坏或空间不足会明确报告，不能假报已保存任务', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.setItem('gpt-image-video-tasks', '{')
  loadVideoTasks()
  expect(useVideoTaskStore.getState().storageError).toContain('读取失败')
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('空间不足') })
  expect(() => updateVideoTask('shot', record)).toThrow('空间不足')
  expect(useVideoTaskStore.getState().storageError).toContain('保存失败')
})
