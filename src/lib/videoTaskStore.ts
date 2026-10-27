import { create } from 'zustand'
import type { VideoTaskRecord } from '../types'

const STORAGE_KEY = 'gpt-image-video-tasks'
type VideoTaskState = { records: Record<string, VideoTaskRecord>; loaded: boolean; storageError: string }

export const useVideoTaskStore = create<VideoTaskState>(() => ({ records: {}, loaded: false, storageError: '' }))

export function loadVideoTasks() {
  if (useVideoTaskStore.getState().loaded) return
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const records: Record<string, VideoTaskRecord> = {}
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [id, value] of Object.entries(data)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const item = value as Record<string, unknown>
        if (typeof item.imageId !== 'string' || typeof item.status !== 'string') continue
        const record: VideoTaskRecord = {
          id, imageId: item.imageId, status: item.status,
          statusText: typeof item.statusText === 'string' ? item.statusText : '',
          requestText: typeof item.requestText === 'string' ? item.requestText : '',
          responseText: typeof item.responseText === 'string' ? item.responseText : '',
          failureReason: typeof item.failureReason === 'string' ? item.failureReason : undefined,
          taskUrl: typeof item.taskUrl === 'string' ? item.taskUrl : '',
          url: typeof item.url === 'string' ? item.url : '',
          downloadUrl: typeof item.downloadUrl === 'string' ? item.downloadUrl : '',
          accountId: typeof item.accountId === 'string' ? item.accountId : undefined,
          windowId: typeof item.windowId === 'string' ? item.windowId : undefined,
          apiTaskId: typeof item.apiTaskId === 'string' ? item.apiTaskId : undefined,
          baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : undefined,
          shotIndex: typeof item.shotIndex === 'number' ? item.shotIndex : undefined,
          tracking: item.tracking === true,
          retryable: item.retryable === true,
          uncertain: item.uncertain === true,
          saveState: item.saveState === 'saved' ? 'saved' : item.saveState === 'failed' ? 'failed' : 'pending',
          savedPath: typeof item.savedPath === 'string' ? item.savedPath : undefined,
        }
        // 刷新会中断文件写入，不能恢复成永久“保存中”或假报成功。
        if (item.saveState === 'saving') record.statusText = '视频已生成，保存过程被中断，请重新保存'
        if (record.tracking && !record.windowId && !record.apiTaskId) {
          record.tracking = false
          record.retryable = true
          record.uncertain = true
          record.statusText = '任务跟踪被中断，请先检查豆包历史记录再重试'
        }
        records[id] = record
      }
    }
    useVideoTaskStore.setState({ records, loaded: true, storageError: '' })
  } catch (err) {
    console.error('视频任务记录读取失败', err)
    useVideoTaskStore.setState({ loaded: true, storageError: '视频任务记录读取失败，请检查浏览器存储后刷新页面' })
  }
}

export function updateVideoTask(id: string, patch: Partial<VideoTaskRecord>) {
  const state = useVideoTaskStore.getState()
  if (!state.records[id] && !patch.imageId) return
  const records = { ...state.records, [id]: { ...state.records[id], ...patch, id } }
  try {
    // 先同步保存任务标识，再发送请求，确保刷新后仍能查询同一个任务。
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    useVideoTaskStore.setState({ records, storageError: '' })
  } catch (err) {
    console.error('视频任务记录保存失败', err)
    useVideoTaskStore.setState({ records, storageError: '视频任务记录保存失败，请检查浏览器存储空间' })
    throw err
  }
}

export function removeVideoTasks(ids: string[]) {
  loadVideoTasks()
  const records = { ...useVideoTaskStore.getState().records }
  for (const id of ids) delete records[id]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    useVideoTaskStore.setState({ records })
  } catch (err) {
    console.error('视频任务记录清理失败', err)
    throw err
  }
}
