import { getVideoSource, putVideoSource, hashDataUrl } from './db'
import { blobToDataUrl } from './dataUrl'
import { getShotImageMime, parseShotProjectFolder } from './shotProjectImport'
import type { TaskRecord } from '../types'
import { shotFolderName } from './shotProjectExport'

export type WritableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
export type VideoSource = { directory: WritableDirectory; shotDirectory?: WritableDirectory; name: string; relativePath: string }
type DirectoryPickerWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<WritableDirectory> }

export function supportsVideoFolderSave() {
  return Boolean((window as DirectoryPickerWindow).showDirectoryPicker)
}

export async function pickVideoProjectFolder() {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (!picker) throw new Error('请使用本机 Chrome 或 Edge 打开，以便将视频保存到原图片文件夹')
  const root = await picker.call(window, { mode: 'readwrite' })
  const files: File[] = []
  const sources = new Map<string, VideoSource>()
  async function visit(directory: WritableDirectory, prefix: string, shotDirectory?: WritableDirectory) {
    for await (const entry of directory.values()) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
      const relativePath = `${prefix}/${entry.name}`
      if (entry.kind === 'directory') {
        const child = entry as WritableDirectory
        await visit(child, relativePath, directory === root ? child : shotDirectory)
      } else {
        const image = getShotImageMime({ name: entry.name } as File)
        if (!image && !/\.mp4$/i.test(entry.name)) continue
        const file = await (entry as FileSystemFileHandle).getFile()
        Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
        files.push(file)
        if (image) sources.set(relativePath, { directory, shotDirectory, name: entry.name, relativePath })
      }
    }
  }
  await visit(root, root.name)
  return { files, sources }
}

export async function bindVideoProjectFolder(tasks: TaskRecord[], files: File[], sources: Map<string, VideoSource>) {
  let bound = 0
  const matched = new Set<string>()
  for (const shot of parseShotProjectFolder(files).shots) {
    for (const file of shot.files) {
      const imageId = await hashDataUrl(await blobToDataUrl(file, getShotImageMime(file)))
      for (const task of tasks) {
        const key = `${task.id}:${imageId}`
        if (task.shotIndex !== shot.index || !task.outputImages.includes(imageId) || matched.has(key)) continue
        const source = sources.get(file.webkitRelativePath)
        if (source) { await putVideoSource(task.id, imageId, source); matched.add(key); bound++ }
      }
    }
  }
  return bound
}

export async function hasShotVideo(task: TaskRecord): Promise<boolean | undefined> {
  async function hasMp4(directory: WritableDirectory): Promise<boolean> {
    for await (const entry of directory.values()) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue
      if (entry.kind === 'file' && /\.mp4$/i.test(entry.name)) return true
      if (entry.kind === 'directory' && await hasMp4(entry as WritableDirectory)) return true
    }
    return false
  }
  try {
    let checked = false
    for (const imageId of task.outputImages) {
      const source = await getVideoSource(task.id, imageId)
      if (!source) continue
      if (await hasMp4(source.shotDirectory || source.directory)) return true
      checked = true
      if (source.shotDirectory) return false
    }
    return checked ? false : task.shotHasVideo
  } catch (err) {
    console.warn('镜头目录的视频检查失败，请重新关联原文件夹', err)
    return undefined
  }
}

export async function prepareVideoSave(taskId: string, imageId: string) {
  const source = await getVideoSource(taskId, imageId)
  if (!source) return undefined
  const options = { mode: 'readwrite' } as const
  if (await source.directory.queryPermission(options) !== 'granted' &&
      await source.directory.requestPermission(options) !== 'granted') {
    throw new Error('未获得原图片文件夹的写入权限，请重新关联文件夹')
  }
  return source
}

export async function saveVideoBesideImage(source: VideoSource, url: string, shotIndex?: number) {
  if (await source.directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('原图片文件夹的写入权限已失效，请重新关联文件夹后保存视频')
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}`)
  const blob = await response.blob()
  if (!blob.size || /^(text\/|application\/(json|xml))/.test(blob.type)) throw new Error('下载结果不是有效视频')
  const basename = shotIndex ? shotFolderName(shotIndex) : source.name.replace(/\.[^.]+$/, '')
  const existing = new Set<string>()
  for await (const entry of source.directory.values()) existing.add(entry.name.toLowerCase())
  let name = `${basename}.mp4`
  for (let suffix = 2; existing.has(name.toLowerCase()); suffix++) name = `${basename} (${suffix}).mp4`
  const file = await source.directory.getFileHandle(name, { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    await source.directory.removeEntry(name).catch(() => {})
    throw error
  }
  return `${source.relativePath.slice(0, source.relativePath.lastIndexOf('/'))}/${name}`
}
