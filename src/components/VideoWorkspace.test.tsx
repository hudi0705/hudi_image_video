// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { TaskRecord } from '../types'
import type { useStore } from '../store'
import { quotaDate, readAccounts, writeAccounts } from '../lib/doubaoAccounts'
import { loadVideoTasks, updateVideoTask, useVideoTaskStore } from '../lib/videoTaskStore'
import { recoverVideoTasks } from '../lib/videoGeneration'
import VideoWorkspace from './VideoWorkspace'

const mocks = vi.hoisted(() => ({
  tasks: [] as TaskRecord[], generate: vi.fn(), toast: vi.fn(), prepareSave: vi.fn(), saveVideo: vi.fn(), hasVideo: vi.fn(),
  confirm: vi.fn<(dialog: ReturnType<typeof useStore.getState>['confirmDialog']) => void>(),
  removeTasks: vi.fn<(ids: string[]) => Promise<void>>(),
}))
vi.mock('../lib/videoFileSave', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/videoFileSave')>(), prepareVideoSave: mocks.prepareSave, saveVideoBesideImage: mocks.saveVideo, hasShotVideo: mocks.hasVideo,
}))
vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ tasks: mocks.tasks, showToast: mocks.toast, setConfirmDialog: mocks.confirm }),
  removeMultipleTasks: mocks.removeTasks,
  importShotProjectFolder: vi.fn(), selectShotVideoImage: vi.fn(), updateShotVideoDetails: vi.fn(),
}))
vi.mock('../lib/imageCache', () => ({ ensureImageCached: async () => 'data:image/png;base64,AA==', getCachedImage: () => '' }))
vi.mock('../lib/doubaoVideo', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/doubaoVideo')>(), generateWithAccountRotation: mocks.generate,
}))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
  useVideoTaskStore.setState({ records: {}, loaded: false, storageError: '' })
  mocks.prepareSave.mockResolvedValue(undefined)
  mocks.hasVideo.mockImplementation(async (task: TaskRecord) => task.shotHasVideo)
  mocks.removeTasks.mockImplementation(async (ids) => {
    mocks.tasks = mocks.tasks.filter((task) => !ids.includes(task.id))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.generate.mockReset()
  mocks.toast.mockReset()
  mocks.prepareSave.mockReset()
  mocks.saveVideo.mockReset()
  mocks.hasVideo.mockReset()
  mocks.confirm.mockReset()
  mocks.removeTasks.mockReset()
  vi.useRealTimers()
})

test('版权拒绝只显示在对应镜头，恢复后保留原文，不再轮询或重复生成', async () => {
  mocks.tasks = [1, 2].map((index) => ({ id: `shot-${index}`, createdAt: index, outputImages: [`image-${index}`], shotIndex: index, shotAction: '推进', shotProjectName: '项目' } as TaskRecord))
  const refusal = '抱歉，由于版权相关限制，暂时无法创作对应的内容，换其他主题试试吧。'
  loadVideoTasks()
  updateVideoTask('shot-1', {
    imageId: 'image-1', windowId: 'original', status: 'generating', statusText: '正在生成视频', requestText: '原提示词',
    responseText: '', taskUrl: '', url: '', downloadUrl: '', tracking: true, retryable: false, uncertain: false, saveState: 'pending',
  })
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'failed', failureReason: '版权限制', responseText: refusal, taskUrl: 'https://www.doubao.com/chat/123', tracking: false })))
  vi.stubGlobal('fetch', fetchMock)
  await recoverVideoTasks()
  expect(useVideoTaskStore.getState().records['shot-1']).toMatchObject({ status: 'failed', failureReason: '版权限制', tracking: false, uncertain: false, retryable: true })
  useVideoTaskStore.setState({ records: {}, loaded: false })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    const alerts = container.querySelectorAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toContain('豆包未生成：版权限制')
    expect(alerts[0].textContent).toContain(refusal)
    expect(alerts[0].closest('article')?.textContent).toContain('镜头 1')
    expect(container.querySelector('a[href="https://www.doubao.com/chat/123"]')).not.toBeNull()
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '重试')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.saveVideo).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('本次生成返回版权拒绝时显示原文并计为失败', async () => {
  mocks.tasks = [{ id: 'task', createdAt: 1, outputImages: ['image'], shotIndex: 1, shotAction: '推进', shotProjectName: '项目' } as TaskRecord]
  writeAccounts([{ id: 'account', name: '账户', sessionId: '', dailyQuota: 10, usedToday: 0, quotaDate: quotaDate() }])
  mocks.generate.mockResolvedValue({ status: 'failed', failureReason: '版权限制', responseText: '由于版权相关限制，暂时无法创作对应的内容。', taskUrl: 'https://www.doubao.com/chat/123' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('生成所选视频'))!.click() })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('版权限制')
    expect(mocks.toast).toHaveBeenCalledWith('完成 0，待查看 0，失败 1，暂停未发送 0', 'error')
    expect(useVideoTaskStore.getState().records.task).toMatchObject({ status: 'failed', tracking: false, uncertain: false })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.saveVideo).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('保存失败后可只重试保存，使用所选首帧目录且不重复生成', async () => {
  mocks.tasks = [{ id: 'task', createdAt: 1, outputImages: ['first', 'selected'], shotVideoImageId: 'selected', shotIndex: 1, shotProjectName: '项目', shotAction: '推进' } as TaskRecord]
  writeAccounts([{ id: 'account', name: '账户', sessionId: '', dailyQuota: 10, usedToday: 0, lastUsedAt: 0, quotaDate: '' }])
  const source = { directory: {}, name: 'selected.png', relativePath: '项目/镜头1/selected.png' }
  mocks.prepareSave.mockResolvedValue(source)
  mocks.generate.mockResolvedValue({ status: 'completed', url: 'https://cdn.test/video.mp4', downloadUrl: 'http://127.0.0.1:8787/task-window/video?windowId=task' })
  mocks.saveVideo.mockRejectedValueOnce(new Error('磁盘已满')).mockResolvedValueOnce('项目/镜头1/镜头1.mp4')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent?.includes('生成所选视频'))!.click() })
    expect(mocks.prepareSave).toHaveBeenCalledWith('task', 'selected')
    expect(mocks.saveVideo).toHaveBeenCalledWith(source, 'http://127.0.0.1:8787/task-window/video?windowId=task', 1)
    expect(container.textContent).toContain('视频已生成，未保存：磁盘已满')
    expect([...container.querySelectorAll('button')].some(button => button.textContent === '重试')).toBe(false)
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === '保存视频')!.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.saveVideo).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('已保存：项目/镜头1/镜头1.mp4')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test.each([
  { rejected: true, exhausted: false }, { rejected: false, exhausted: false },
  { rejected: true, exhausted: true }, { rejected: false, exhausted: true },
])('单镜头重试可与原批次并行，防止双击重复提交（明确拒绝=$rejected，原账户耗尽=$exhausted）', async ({ rejected, exhausted }) => {
  mocks.tasks = [1, 2, 3].map(index => ({
    id: String(index), createdAt: index, outputImages: [`image-${index}`],
    shotIndex: index, shotProjectName: '测试项目', shotAction: `动作${index}`,
  } as TaskRecord))
  writeAccounts([{ id: 'account', name: '测试账户', sessionId: '', dailyQuota: 10, usedToday: 0, lastUsedAt: 0, quotaDate: '' }])
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const pending: Array<(result: unknown) => void> = []
  mocks.generate.mockImplementation(() => new Promise(resolve => { pending.push(resolve) }))
  mocks.generate.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('镜头一失败'), { code: rejected ? 'DOUBAO_SUBMIT_FAILED' : undefined })))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    const generate = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('生成所选视频'))!
    await act(async () => { generate.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(3)
    const projectTitle = container.querySelector<HTMLButtonElement>('h3 button')!
    expect(projectTitle.disabled).toBe(true)
    expect([...container.querySelectorAll('button')].find((button) => button.textContent === '批量删除')!.disabled).toBe(true)
    await act(async () => { projectTitle.click() })
    expect(mocks.confirm).not.toHaveBeenCalled()
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '重试')!
    expect(retry).toBeDefined()
    expect(retry.disabled).toBe(false)
    writeAccounts([
      { id: 'account', name: '测试账户', sessionId: '', dailyQuota: 10, usedToday: exhausted ? 10 : 0, lastUsedAt: 100, quotaDate: quotaDate() },
      { id: 'other', name: '其他账户', sessionId: '', dailyQuota: 10, usedToday: 0, lastUsedAt: 0, quotaDate: '' },
    ])
    await act(async () => { retry.click(); retry.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(4)
    expect(confirmation).toHaveBeenCalledTimes(rejected ? 0 : 1)
    expect(mocks.generate.mock.calls[3][0].prompt).toBe(mocks.generate.mock.calls[0][0].prompt)
    expect(mocks.generate.mock.calls[3][0].accountId).toBe(exhausted ? 'other' : 'account')
    await act(async () => { pending[2]({ status: 'completed', url: 'https://video.test/retry.mp4' }) })
    expect(generate.disabled).toBe(true)
    expect(container.querySelectorAll('video')).toHaveLength(1)
    await act(async () => {
      pending[0]({ status: 'completed', url: 'https://video.test/second.mp4' })
      pending[1]({ status: 'completed', url: 'https://video.test/third.mp4' })
    })
    expect(container.querySelectorAll('video')).toHaveLength(3)
    expect(generate.disabled).toBe(false)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test.each(['mouse', 'touch', 'pen'])('长按项目名称需确认后才删除完整项目，保留其他项目（%s）', async (pointerType) => {
  vi.useFakeTimers()
  mocks.tasks = [
    { id: 'shot-1', createdAt: 1, outputImages: ['image-1'], shotProjectName: '项目甲', shotIndex: 1 },
    { id: 'shot-2', createdAt: 2, outputImages: ['image-2'], shotProjectName: ' 项目甲 ', shotIndex: 2 },
    { id: 'failed-shot', createdAt: 3, outputImages: [], shotProjectName: '项目甲' },
    { id: 'other', createdAt: 4, outputImages: ['image-other'], shotProjectName: '项目乙' },
  ] as TaskRecord[]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    const title = container.querySelector<HTMLButtonElement>('[aria-label="长按删除项目「项目甲」"]')!
    await act(async () => {
      title.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType, pointerId: 1, isPrimary: true, button: 0 }))
      vi.advanceTimersByTime(499)
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.removeTasks).not.toHaveBeenCalled()
    const dialog = mocks.confirm.mock.calls[0][0]!
    expect(dialog.title).toBe('删除项目')
    expect(dialog.message).toContain('全部 3 个任务')
    expect(dialog.message).toContain('生图中的对应任务也会删除')
    expect(dialog.message).toContain('已保存到原文件夹的图片和视频不受影响')
    await act(async () => {
      title.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      title.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      vi.advanceTimersByTime(1000)
    })
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    await act(async () => {
      await dialog.action?.()
      root.render(<VideoWorkspace />)
    })
    expect(mocks.removeTasks).toHaveBeenCalledExactlyOnceWith(['shot-1', 'shot-2', 'failed-shot'])
    expect(container.querySelector('[aria-label="长按删除项目「项目甲」"]')).toBeNull()
    expect(container.querySelector('[aria-label="长按删除项目「项目乙」"]')).not.toBeNull()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test.each(['pointerup', 'pointercancel', 'pointerout', 'pointermove', 'unmount'])('短按、滑动或取消长按不会打开删除确认（%s）', async (type) => {
  vi.useFakeTimers()
  mocks.tasks = [{ id: 'shot', createdAt: 1, outputImages: ['image'], shotProjectName: '项目' } as TaskRecord]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    const title = container.querySelector<HTMLButtonElement>('h3 button')!
    await act(async () => {
      title.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 40 }))
      vi.advanceTimersByTime(200)
      if (type === 'unmount') root.unmount()
      else title.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 60, clientY: 40 }))
      if (type === 'pointerup') title.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      vi.advanceTimersByTime(1000)
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.removeTasks).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('删除未命名项目只影响当前项目，键盘也可打开确认', async () => {
  mocks.tasks = [
    { id: 'older', createdAt: 1, outputImages: ['image-1'] },
    { id: 'newer', createdAt: 2, outputImages: ['image-2'] },
  ] as TaskRecord[]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    const title = container.querySelector<HTMLButtonElement>('h3 button')!
    await act(async () => { title.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' })) })
    const dialog = mocks.confirm.mock.calls[0][0]!
    expect(dialog.message).toContain('全部 1 个任务')
    await act(async () => {
      await dialog.action?.()
      root.render(<VideoWorkspace />)
    })
    expect(mocks.removeTasks).toHaveBeenCalledExactlyOnceWith(['newer'])
    expect(container.querySelectorAll('h3 button')).toHaveLength(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test.each([false, true])('多选删除仅清理所选项目及其全部任务（失败后重试=%s）', async (retry) => {
  mocks.tasks = [
    { id: 'shot-a', createdAt: 1, outputImages: ['image-a'], shotProjectName: '项目甲' },
    { id: 'failed-a', createdAt: 2, outputImages: [], shotProjectName: ' 项目甲 ' },
    { id: 'shot-b', createdAt: 3, outputImages: ['image-b'], shotProjectName: '项目乙' },
    { id: 'shot-c', createdAt: 4, outputImages: ['image-c'], shotProjectName: '项目丙' },
    { id: 'unnamed', createdAt: 5, outputImages: ['image-unnamed'] },
  ] as TaskRecord[]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '批量删除')!.click() })
    const getDeleteButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('删除所选项目'))!
    expect(getDeleteButton().disabled).toBe(true)
    await act(async () => {
      container.querySelector<HTMLInputElement>('[aria-label="选择项目「项目甲」用于删除"]')!.click()
      container.querySelector<HTMLInputElement>('[aria-label="选择项目「项目乙」用于删除"]')!.click()
    })
    expect(getDeleteButton().textContent).toContain('(2)')
    expect(container.querySelector<HTMLInputElement>('[aria-label="全选项目用于删除"]')!.indeterminate).toBe(true)
    expect(container.querySelector<HTMLInputElement>('[aria-label="项目甲全选镜头"]')!.checked).toBe(true)
    await act(async () => { getDeleteButton().click() })
    expect(mocks.removeTasks).not.toHaveBeenCalled()
    const dialog = mocks.confirm.mock.calls[0][0]!
    expect(dialog.title).toBe('批量删除项目')
    expect(dialog.message).toContain('2 个项目')
    expect(dialog.message).toContain('全部 3 个任务')
    expect(dialog.message).not.toContain('项目丙')
    if (retry) {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.removeTasks.mockRejectedValueOnce(new Error('存储失败'))
      await act(async () => { expect(await dialog.action?.()).toBe(false) })
      expect(mocks.toast).toHaveBeenCalledWith('项目删除失败，请重试', 'error')
      expect(getDeleteButton().textContent).toContain('(2)')
      expect(container.querySelector<HTMLInputElement>('[aria-label="选择项目「项目甲」用于删除"]')!.checked).toBe(true)
    }
    await act(async () => {
      await dialog.action?.()
      root.render(<VideoWorkspace />)
    })
    expect(mocks.removeTasks).toHaveBeenLastCalledWith(['shot-a', 'failed-a', 'shot-b'])
    expect(mocks.removeTasks).toHaveBeenCalledTimes(retry ? 2 : 1)
    expect(mocks.tasks.map((task) => task.id)).toEqual(['shot-c', 'unnamed'])
    expect(container.querySelector('[aria-label="全选项目用于删除"]')).toBeNull()
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '批量删除')).toBe(true)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('全选项目、取消选择和退出多选都不删除任务，再次进入时清空选择', async () => {
  mocks.tasks = [
    { id: 'named', createdAt: 1, outputImages: ['image-1'], shotProjectName: '项目' },
    { id: 'older', createdAt: 2, outputImages: ['image-2'] },
    { id: 'newer', createdAt: 3, outputImages: ['image-3'] },
  ] as TaskRecord[]
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '批量删除')!.click() })
    const all = container.querySelector<HTMLInputElement>('[aria-label="全选项目用于删除"]')!
    const projects = [...container.querySelectorAll<HTMLInputElement>('input[aria-label^="选择项目"]')]
    await act(async () => { all.click() })
    expect(projects).toHaveLength(3)
    expect(projects.every((input) => input.checked)).toBe(true)
    await act(async () => { projects[0].click() })
    expect(all.checked).toBe(false)
    expect(all.indeterminate).toBe(true)
    expect(projects.filter((input) => input.checked)).toHaveLength(2)
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '取消多选')!.click() })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '批量删除')!.click() })
    expect([...container.querySelectorAll<HTMLInputElement>('input[aria-label^="选择项目"]')].every((input) => !input.checked)).toBe(true)
    expect([...container.querySelectorAll('button')].find((button) => button.textContent?.includes('删除所选项目'))!.disabled).toBe(true)
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.removeTasks).not.toHaveBeenCalled()
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('任务执行前刷新账户额度，无可用额度时不提交；账户更新后可继续生成', async () => {
  mocks.tasks = [{ id: 'shot', createdAt: 1, outputImages: ['image'], shotAction: '推进' } as TaskRecord]
  const account = { id: 'a', name: '已保存账户', sessionId: '', dailyQuota: 5, usedToday: 0, quotaDate: quotaDate() }
  writeAccounts([account])
  mocks.generate.mockResolvedValue({ status: 'completed', url: 'https://cdn.test/video.mp4' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(container.textContent).toContain('1 个账户 · 1 个可用')
    writeAccounts([{ ...account, usedToday: 5 }])
    const generate = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('生成所选视频'))!
    await act(async () => { generate.click() })
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('豆包账户今日额度已用完，请明日再试或添加其他账户', 'error')
    expect(container.textContent).toContain('1 个账户 · 0 个可用')
    expect(container.textContent).toContain('今日额度已用完')
    writeAccounts([account])
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(container.textContent).toContain('1 个账户 · 1 个可用')
    await act(async () => { generate.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('重新登录保留服务端当前日期和用量，避免将历史累计次数作为今日额度', async () => {
  mocks.tasks = []
  writeAccounts([{ id: 'a', name: '账户', sessionId: '', dailyQuota: 5, usedToday: 5, quotaDate: '2000-01-01' }])
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'a', name: '账户', dailyQuota: 5, usedToday: 1, quotaDate: quotaDate() }))))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === '重新登录')!.click() })
    expect(readAccounts()[0].usedToday).toBe(1)
    expect(readAccounts()[0].quotaDate).toBe(quotaDate())
    expect(container.textContent).toContain('今日剩余 4/5 次')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test.each([false, true])('视频、保存结果和原对话关联在重新进入后保留（模拟刷新=%s）', async (reload) => {
  mocks.tasks = [{ id: 'task', createdAt: 1, outputImages: ['image'], shotAction: '推进' } as TaskRecord]
  writeAccounts([{ id: 'a', name: '账户', sessionId: '', dailyQuota: 10, usedToday: 0, quotaDate: quotaDate() }])
  mocks.generate.mockImplementation(async (opts) => {
    opts.onTaskWindow('window-1')
    return { status: 'completed', url: 'https://cdn.test/video.mp4', taskUrl: 'https://www.doubao.com/chat/123', responseText: '已完成视频' }
  })
  mocks.prepareSave.mockResolvedValue({ directory: {}, name: 'image.png', relativePath: '项目/镜头1/image.png' })
  mocks.saveVideo.mockResolvedValue('项目/镜头1/镜头1.mp4')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('生成所选视频'))!.click() })
    await act(async () => { root.render(null) })
    if (reload) useVideoTaskStore.setState({ records: {}, loaded: false })
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('http://127.0.0.1:8787/task-window/video?windowId=window-1')
    expect(container.textContent).toContain('已保存：项目/镜头1/镜头1.mp4')
    expect(container.textContent).toContain('已完成视频')
    expect(container.textContent).toContain('查看本次豆包窗口')
    expect(container.querySelector('a[href="https://www.doubao.com/chat/123"]')).not.toBeNull()
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.saveVideo).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('切换页面期间继续生成和保存，返回后不会重复提交', async () => {
  mocks.tasks = [{ id: 'task', createdAt: 1, outputImages: ['image'], shotAction: '推进' } as TaskRecord]
  writeAccounts([{ id: 'a', name: '账户', sessionId: '', dailyQuota: 10, usedToday: 0, quotaDate: quotaDate() }])
  let finish!: (result: unknown) => void
  mocks.generate.mockImplementation((opts) => {
    opts.onTaskWindow('window-1')
    opts.onProgress({ status: 'generating', responseText: '豆包正在生成' })
    return new Promise((resolve) => { finish = resolve })
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('生成所选视频'))!.click() })
    await act(async () => { root.render(null); root.render(<VideoWorkspace key="returned" />) })
    const generate = [...container.querySelectorAll('button')].find((button) => button.textContent === '生成中…')!
    expect(generate.disabled).toBe(true)
    expect(container.textContent).toContain('豆包已受理，正在生成视频')
    await act(async () => { generate.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    await act(async () => { root.render(null) })
    await act(async () => { finish({ status: 'completed', url: 'https://cdn.test/video.mp4' }) })
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(container.querySelector('video')).not.toBeNull()
    expect(container.textContent).toContain('视频已生成，未保存')
    expect(container.textContent).toContain('保存视频')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('刷新后查询同一任务并恢复结果，使用生成时的首帧保存且不重新生成', async () => {
  mocks.tasks = [{ id: 'task', createdAt: 1, outputImages: ['first', 'selected'], shotAction: '推进' } as TaskRecord]
  loadVideoTasks()
  updateVideoTask('task', {
    imageId: 'selected', shotIndex: 2, accountId: 'a', windowId: 'saved-window', status: 'generating',
    statusText: '豆包已受理，正在生成视频…', requestText: '原提示词', responseText: '', taskUrl: '', url: '', downloadUrl: '',
    tracking: true, retryable: false, uncertain: false, saveState: 'pending',
  })
  useVideoTaskStore.setState({ records: {}, loaded: false })
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', url: 'https://cdn.test/video.mp4', taskUrl: 'https://www.doubao.com/chat/123', tracking: false })))
  vi.stubGlobal('fetch', fetchMock)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('windowId=saved-window')
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.prepareSave).toHaveBeenCalledWith('task', 'selected')
    expect(container.querySelector('video')).not.toBeNull()
    expect(container.textContent).toContain('原提示词')
    expect(container.textContent).toContain('保存视频')
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})

test('服务暂时离线保留任务，重连后继续查询，旧查询不能覆盖重试任务', async () => {
  loadVideoTasks()
  updateVideoTask('task', {
    imageId: 'image', windowId: 'original', status: 'generating', statusText: '', requestText: '提示词', responseText: '', taskUrl: '', url: '', downloadUrl: '',
    tracking: true, retryable: false, uncertain: false, saveState: 'pending',
  })
  const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('服务离线'))
  vi.stubGlobal('fetch', fetchMock)
  await recoverVideoTasks()
  expect(useVideoTaskStore.getState().records.task).toMatchObject({ windowId: 'original', uncertain: true, retryable: true })
  let finish!: (response: Response) => void
  fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const recovery = recoverVideoTasks()
  updateVideoTask('task', { windowId: 'retry', status: 'sending', tracking: true })
  finish(new Response(JSON.stringify({ status: 'completed', url: 'https://cdn.test/old.mp4' })))
  await recovery
  expect(useVideoTaskStore.getState().records.task).toMatchObject({ windowId: 'retry', status: 'sending', url: '' })
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'generating', tracking: true })))
  await recoverVideoTasks()
  expect(String(fetchMock.mock.calls[2][0])).toContain('windowId=retry')
  expect(useVideoTaskStore.getState().records.task.uncertain).toBe(false)
})

test('API 视频任务恢复时只查询已保存的任务 ID，额度仅扣一次', async () => {
  writeAccounts([{ id: 'api-account', name: 'API账户', sessionId: 'key', dailyQuota: 10, usedToday: 0, quotaDate: quotaDate() }])
  loadVideoTasks()
  updateVideoTask('task', {
    imageId: 'image', accountId: 'api-account', apiTaskId: 'api-task', baseUrl: 'https://api.test/v3',
    status: 'generating', statusText: '', requestText: '提示词', responseText: '', taskUrl: '', url: '', downloadUrl: '',
    tracking: true, retryable: false, uncertain: false, saveState: 'pending',
  })
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'succeeded', content: { video_url: 'https://cdn.test/video.mp4' } })))
  vi.stubGlobal('fetch', fetchMock)
  await recoverVideoTasks()
  await recoverVideoTasks()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v3/contents/generations/tasks/api-task')
  expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
  expect(mocks.generate).not.toHaveBeenCalled()
  expect(useVideoTaskStore.getState().records.task).toMatchObject({ status: 'completed', url: 'https://cdn.test/video.mp4', tracking: false })
  expect(readAccounts()[0].usedToday).toBe(1)
})

test('已有 MP4 默认不选，没有视频默认选中，重新检查保留手动选择且刷新重建默认值', async () => {
  mocks.tasks = [1, 2, 3].map((index) => ({
    id: `shot-${index}`, createdAt: index, outputImages: [`image-${index}`], shotIndex: index,
    shotAction: '推进', shotProjectName: '项目',
  } as TaskRecord))
  writeAccounts([{ id: 'account', name: '账户', sessionId: '', dailyQuota: 10, usedToday: 0, quotaDate: quotaDate() }])
  const existing = new Set(['shot-1'])
  mocks.hasVideo.mockImplementation(async (task: TaskRecord) => existing.has(task.id))
  mocks.generate.mockResolvedValue({ status: 'completed', url: 'https://cdn.test/video.mp4' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const checkbox = (index: number) => container.querySelector<HTMLInputElement>(`[aria-label="选择镜头 ${index}生成视频"]`)!
  const generate = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('生成所选视频'))!
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(checkbox(1).checked).toBe(false)
    expect(checkbox(2).checked).toBe(true)
    expect(checkbox(3).checked).toBe(true)
    expect(container.textContent).toContain('目录已有 MP4')
    expect(generate().textContent).toContain('(2)')
    await act(async () => { generate().click() })
    expect(mocks.generate.mock.calls.map(([opts]) => opts.prompt)).toHaveLength(2)
    expect(useVideoTaskStore.getState().records['shot-1']).toBeUndefined()
    await act(async () => { checkbox(1).click(); checkbox(2).click() })
    expect(checkbox(1).checked).toBe(true)
    expect(checkbox(2).checked).toBe(false)
    existing.add('shot-3')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(checkbox(1).checked).toBe(true)
    expect(checkbox(2).checked).toBe(false)
    expect(checkbox(3).checked).toBe(false)
    existing.delete('shot-3')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(checkbox(3).checked).toBe(true)
    await act(async () => { root.render(null) })
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(checkbox(1).checked).toBe(false)
    expect(checkbox(2).checked).toBe(true)
    expect(checkbox(3).checked).toBe(true)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})


test('切换列表和画布复用同一任务、勾选状态与生成结果，不重新提交', async () => {
  await import('./VideoCanvas')
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  mocks.tasks = [{ id: 'shot', createdAt: 1, outputImages: ['image'], shotProjectName: '项目', shotIndex: 1, shotAction: '推进' } as TaskRecord]
  writeAccounts([{ id: 'account', name: '账户', sessionId: '', dailyQuota: 5, usedToday: 0, quotaDate: quotaDate() }])
  mocks.generate.mockResolvedValue({ status: 'completed', url: 'https://cdn.test/video.mp4' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === text)!
  try {
    await act(async () => { root.render(<VideoWorkspace />) })
    await act(async () => { button('无限画布').click() })
    expect(container.querySelector('[aria-label="视频无限画布"]')).not.toBeNull()
    // 一个镜头在画布上拆成图片、提示词、最终产物三个节点
    expect(container.querySelectorAll('article')).toHaveLength(3)
    expect(container.querySelector('textarea[aria-label="镜头 1动作"]')?.textContent).toBe('推进')
    await act(async () => { container.querySelector<HTMLInputElement>('[aria-label="选择镜头 1生成视频"]')!.click() })
    await act(async () => { button('列表视图').click() })
    expect(container.querySelector<HTMLInputElement>('[aria-label="选择镜头 1生成视频"]')!.checked).toBe(false)
    await act(async () => { container.querySelector<HTMLInputElement>('[aria-label="选择镜头 1生成视频"]')!.click() })
    await act(async () => { button('生成所选视频 (1)').click() })
    await act(async () => { button('无限画布').click() })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://cdn.test/video.mp4')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('gpt-image-video-view')).toBe('canvas')
    await act(async () => { root.render(null) })
    await act(async () => { root.render(<VideoWorkspace />) })
    expect(container.querySelector('[aria-label="视频无限画布"]')).not.toBeNull()
    expect(container.querySelector('video')?.getAttribute('src')).toBe('https://cdn.test/video.mp4')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
})
