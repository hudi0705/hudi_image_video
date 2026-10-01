// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { TaskRecord } from '../types'
import { writeAccounts } from '../lib/doubaoAccounts'
import VideoWorkspace from './VideoWorkspace'

const mocks = vi.hoisted(() => ({ tasks: [] as TaskRecord[], generate: vi.fn(), toast: vi.fn(), prepareSave: vi.fn(), saveVideo: vi.fn() }))
vi.mock('../lib/videoFileSave', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/videoFileSave')>(), prepareVideoSave: mocks.prepareSave, saveVideoBesideImage: mocks.saveVideo,
}))
vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({ tasks: mocks.tasks, showToast: mocks.toast }),
  importShotProjectFolder: vi.fn(), selectShotVideoImage: vi.fn(), updateShotVideoDetails: vi.fn(),
}))
vi.mock('../lib/imageCache', () => ({ ensureImageCached: async () => 'data:image/png;base64,AA==', getCachedImage: () => '' }))
vi.mock('../lib/doubaoVideo', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/doubaoVideo')>(), generateWithAccountRotation: mocks.generate,
}))

beforeEach(() => { mocks.prepareSave.mockResolvedValue(undefined) })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.generate.mockReset()
  mocks.toast.mockReset()
  mocks.prepareSave.mockReset()
  mocks.saveVideo.mockReset()
})

test('保存失败后可只重试保存，使用所选首帧目录且不重复生成', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) })
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

test.each([true, false])('单镜头重试可与原批次并行，防止双击重复提交（明确拒绝=%s）', async rejected => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
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
    const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '重试')!
    expect(retry).toBeDefined()
    expect(retry.disabled).toBe(false)
    writeAccounts([
      { id: 'account', name: '测试账户', sessionId: '', dailyQuota: 10, usedToday: 0, lastUsedAt: 100, quotaDate: '' },
      { id: 'other', name: '其他账户', sessionId: '', dailyQuota: 10, usedToday: 0, lastUsedAt: 0, quotaDate: '' },
    ])
    await act(async () => { retry.click(); retry.click() })
    expect(mocks.generate).toHaveBeenCalledTimes(4)
    expect(confirmation).toHaveBeenCalledTimes(rejected ? 0 : 1)
    expect(mocks.generate.mock.calls[3][0].prompt).toBe(mocks.generate.mock.calls[0][0].prompt)
    expect(mocks.generate.mock.calls[3][0].accountId).toBe('account')
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
