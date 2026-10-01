// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { bindVideoProjectFolder, pickVideoProjectFolder, prepareVideoSave, saveVideoBesideImage, type VideoSource, type WritableDirectory } from './videoFileSave'
import type { TaskRecord } from '../types'

const mocks = vi.hoisted(() => ({ getSource: vi.fn(), putSource: vi.fn(), hash: vi.fn() }))
vi.mock('./db', () => ({ getVideoSource: mocks.getSource, putVideoSource: mocks.putSource, hashDataUrl: mocks.hash }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); mocks.getSource.mockReset(); mocks.putSource.mockReset(); mocks.hash.mockReset() })

function directory(name: string) {
  const entries = new Set<string>()
  const writes: Blob[] = []
  const writable = { write: vi.fn(async (blob: Blob) => { writes.push(blob) }), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) }
  const handle = {
    kind: 'directory', name,
    queryPermission: vi.fn(async () => 'granted'), requestPermission: vi.fn(async () => 'granted'),
    getFileHandle: vi.fn(async (filename: string) => { entries.add(filename); return { createWritable: async () => writable } }), removeEntry: vi.fn(async (filename: string) => { entries.delete(filename) }),
    async *values(): AsyncGenerator<unknown> { for (const name of entries) yield { kind: 'file', name } },
  }
  return { handle, writes, writable }
}

test('导入保留每张图片的实际父目录，包括镜头下的嵌套文件夹', async () => {
  const root = directory('项目').handle
  const shot = directory('镜头1').handle
  const nested = directory('成图').handle
  const image = { kind: 'file', name: '首帧.png', getFile: async () => new File(['image'], '首帧.png') }
  const rootEntries = [shot]
  root.values = async function* () { yield* rootEntries }
  shot.values = async function* () { yield nested }
  nested.values = async function* () { yield image as unknown as typeof nested }
  vi.stubGlobal('window', { showDirectoryPicker: vi.fn(async () => root) })
  const result = await pickVideoProjectFolder()
  expect(result.files[0].webkitRelativePath).toBe('项目/镜头1/成图/首帧.png')
  expect(result.sources.get(result.files[0].webkitRelativePath)?.directory).toBe(nested)
})

test('视频写入首帧的父目录，重复生成使用不同文件名并完整关闭写入', async () => {
  const dir = directory('成图')
  const source = { directory: dir.handle as unknown as WritableDirectory, name: '首帧.png', relativePath: '项目/镜头1/成图/首帧.png' }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) })))
  const first = await saveVideoBesideImage(source, 'http://localhost/video', 1)
  const second = await saveVideoBesideImage(source, 'http://localhost/video', 1)
  expect(first).toBe('项目/镜头1/成图/镜头1.mp4')
  expect(second).toBe('项目/镜头1/成图/镜头1 (2).mp4')
  expect(dir.writes).toHaveLength(2)
  expect(dir.writable.close).toHaveBeenCalledTimes(2)
})

test('同名视频存在时使用下一个序号，没有镜头编号时使用原图名称', async () => {
  const dir = directory('成图')
  const source = { directory: dir.handle as unknown as WritableDirectory, name: '首帧.png', relativePath: '项目/镜头12/成图/首帧.png' }
  await dir.handle.getFileHandle('镜头12.mp4')
  await dir.handle.getFileHandle('镜头12 (2).mp4')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) })))
  expect(await saveVideoBesideImage(source, 'http://localhost/video', 12)).toBe('项目/镜头12/成图/镜头12 (3).mp4')
  expect(await saveVideoBesideImage(source, 'http://localhost/video')).toBe('项目/镜头12/成图/首帧.mp4')
})

test('同一图片用于多个镜头时，关联目录仍按镜头匹配', async () => {
  mocks.hash.mockResolvedValue('same-image')
  const files = [1, 2].map(index => {
    const file = { name: 'frame.png', type: 'image/png', arrayBuffer: async () => new ArrayBuffer(1), webkitRelativePath: `项目/镜头${index}/frame.png` }
    return file as File
  })
  const sources = new Map(files.map(file => [file.webkitRelativePath, { directory: directory(file.webkitRelativePath).handle as unknown as WritableDirectory, name: file.name, relativePath: file.webkitRelativePath }]))
  const tasks = [1, 2].map(index => ({ id: `task-${index}`, shotIndex: index, outputImages: ['same-image'] } as TaskRecord))
  expect(await bindVideoProjectFolder(tasks, files, sources)).toBe(2)
  expect(mocks.putSource.mock.calls[0]).toEqual(['task-1', 'same-image', sources.get(files[0].webkitRelativePath)])
  expect(mocks.putSource.mock.calls[1]).toEqual(['task-2', 'same-image', sources.get(files[1].webkitRelativePath)])
})

test('权限拒绝时不写文件；重新授权在生成前完成', async () => {
  const dir = directory('镜头1')
  dir.handle.queryPermission.mockResolvedValue('prompt')
  dir.handle.requestPermission.mockResolvedValue('denied')
  const source = { directory: dir.handle as unknown as WritableDirectory, name: 'a.png', relativePath: '项目/镜头1/a.png' }
  mocks.getSource.mockResolvedValue(source)
  await expect(prepareVideoSave('task', 'selected-image')).rejects.toThrow('写入权限')
  expect(mocks.getSource).toHaveBeenCalledWith('task', 'selected-image')
  await expect(saveVideoBesideImage(source, 'https://video.test')).rejects.toThrow('写入权限')
  expect(dir.handle.getFileHandle).not.toHaveBeenCalled()
})

test('下载错误与写入失败不报告保存成功，写入失败清理临时文件', async () => {
  const dir = directory('镜头1')
  const source = { directory: dir.handle as unknown as WritableDirectory, name: 'a.png', relativePath: '项目/镜头1/a.png' } satisfies VideoSource
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })))
  await expect(saveVideoBesideImage(source, 'https://video.test')).rejects.toThrow('403')
  expect(dir.handle.getFileHandle).not.toHaveBeenCalled()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['video'], { type: 'video/mp4' }) })))
  dir.writable.write.mockRejectedValueOnce(new Error('磁盘已满'))
  await expect(saveVideoBesideImage(source, 'https://video.test')).rejects.toThrow('磁盘已满')
  expect(dir.writable.abort).toHaveBeenCalled()
  expect(dir.handle.removeEntry).toHaveBeenCalled()
})
