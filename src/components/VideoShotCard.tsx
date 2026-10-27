import { useEffect, useState } from 'react'
import type { TaskRecord, VideoShot, VideoTaskRecord } from '../types'
import { ensureImageCached, getCachedImage } from '../lib/imageCache'
import { saveVideoTask } from '../lib/videoGeneration'
import { RefreshIcon } from './icons'

/** frame / prompt / output 是画布里同一条链路的三个节点部分 */
export type VideoShotLayout = 'list' | 'single' | 'frame' | 'prompt' | 'output'

type Props = {
  task: VideoShot
  record?: VideoTaskRecord
  layout: VideoShotLayout
  running: boolean
  selected: boolean
  hasVideo?: boolean
  disabled: boolean
  frameDisabled: boolean
  onSelect: (selected: boolean) => void
  onEdit: (patch: Pick<TaskRecord, 'shotAction' | 'shotAudio' | 'shotDuration'>) => void
  onSelectFrame: (taskId: string, imageId: string) => void
  onRetry: () => void
  onOpen: (windowId: string) => Promise<void>
}

export default function VideoShotCard(props: Props) {
  const video = props.record?.url ? props.record.downloadUrl || props.record.url : ''
  if (props.layout === 'frame') {
    return (
      <article className="nodrag nopan bg-white p-3 dark:bg-gray-900">
        <ShotFrames task={props.task} disabled={props.frameDisabled} onSelect={props.onSelectFrame} />
      </article>
    )
  }
  if (props.layout === 'prompt') {
    return (
      <article className="nodrag nopan nowheel bg-white p-3 dark:bg-gray-900">
        <ShotDetails task={props.task} running={props.running} selected={props.selected} hasVideo={props.hasVideo} disabled={props.disabled} onSelect={props.onSelect} onEdit={props.onEdit} />
      </article>
    )
  }
  if (props.layout === 'output') {
    return (
      <article className="nodrag nopan nowheel bg-white p-3 dark:bg-gray-900">
        {video
          ? <video src={video} controls preload="metadata" className="w-full rounded-xl bg-black" />
          : <p className="rounded-xl bg-gray-50 px-3 py-8 text-center text-xs leading-5 text-gray-400 dark:bg-white/[0.04]">还没有生成视频，勾选这一镜后点「生成所选视频」。</p>}
        <VideoTaskResult record={props.record} onRetry={props.onRetry} onOpen={props.onOpen} />
      </article>
    )
  }
  const single = props.layout === 'single'
  return (
    <article className={single
      ? `grid gap-5 bg-white p-5 dark:bg-gray-900 ${video ? 'lg:grid-cols-[180px_minmax(0,1fr)_minmax(240px,420px)]' : 'sm:grid-cols-[180px_minmax(0,1fr)]'}`
      : 'flex flex-col gap-4 bg-white p-4 dark:bg-gray-900 sm:flex-row'}>
      <div className={single ? 'min-w-0' : 'w-full shrink-0 sm:w-44'}>
        <ShotFrames task={props.task} disabled={props.frameDisabled} onSelect={props.onSelectFrame} />
      </div>
      <div className="min-w-0 flex-1">
        <ShotDetails task={props.task} running={props.running} selected={props.selected} hasVideo={props.hasVideo} disabled={props.disabled} onSelect={props.onSelect} onEdit={props.onEdit} />
        {video && !single && <video src={video} controls preload="metadata" className="mt-3 w-full rounded-xl bg-black" />}
        <VideoTaskResult record={props.record} onRetry={props.onRetry} onOpen={props.onOpen} />
      </div>
      {video && single && <video src={video} controls preload="metadata" className="w-full self-start rounded-xl bg-black" />}
    </article>
  )
}

function FrameThumb({ imageId }: { imageId: string }) {
  const [src, setSrc] = useState(() => getCachedImage(imageId) || '')

  useEffect(() => {
    let cancelled = false
    setSrc(getCachedImage(imageId) || '')
    void ensureImageCached(imageId).then((url) => {
      if (!cancelled && url) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [imageId])

  return src
    ? <img src={src} alt="" className="h-full w-full object-cover" />
    : <span className="block h-full w-full bg-gray-100 dark:bg-white/[0.04]" />
}

function ShotFrames({ task, disabled, onSelect }: {
  task: VideoShot
  disabled: boolean
  onSelect: (taskId: string, imageId: string) => void
}) {
  return (
    <div className="min-w-0">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-gray-100 dark:bg-white/[0.05]">
        <FrameThumb imageId={task.imageId} />
      </div>
      {task.outputImages.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`镜头${task.shotIndex || ''}首帧`}>
          {task.outputImages.map((imageId, index) => (
            <button
              key={imageId}
              type="button"
              disabled={disabled}
              aria-label={`选择第${index + 1}张图片作为首帧`}
              aria-pressed={task.imageId === imageId}
              title={`首帧 ${index + 1}`}
              onClick={() => onSelect(task.id, imageId)}
              className={`h-10 w-14 overflow-hidden rounded-md border-2 disabled:cursor-not-allowed ${task.imageId === imageId ? 'border-blue-500' : 'border-transparent hover:border-gray-300'}`}
            >
              <FrameThumb imageId={imageId} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ShotDetails({ task, running, selected, hasVideo, disabled, onSelect, onEdit }: {
  task: VideoShot
  running: boolean
  selected: boolean
  hasVideo?: boolean
  disabled: boolean
  onSelect: (selected: boolean) => void
  onEdit: (patch: Pick<TaskRecord, 'shotAction' | 'shotAudio' | 'shotDuration'>) => void
}) {
  const [durationDraft, setDurationDraft] = useState(String(task.shotDuration ?? 10))
  useEffect(() => setDurationDraft(String(task.shotDuration ?? 10)), [task.shotDuration])
  const inputClass = 'mt-1 w-full resize-y rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-700 outline-none focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200'
  return (
    <div className="min-w-0 text-xs leading-5 text-gray-600 dark:text-gray-300">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          aria-label={`选择镜头 ${task.shotIndex || '—'}生成视频`}
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-blue-600 disabled:cursor-not-allowed"
        />
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-white/[0.08] dark:text-gray-200">镜头 {task.shotIndex || '—'}</span>
        </label>
        {running && <span className="text-blue-500">生成中</span>}
        {hasVideo && <span className="text-gray-400">目录已有 MP4</span>}
      </div>
      <label className="block">动作<textarea aria-label={`镜头 ${task.shotIndex || '—'}动作`} rows={3} value={task.action || ''} disabled={disabled} onChange={(event) => onEdit({ shotAction: event.target.value })} className={inputClass} /></label>
      <label className="mt-2 block">音频<textarea aria-label={`镜头 ${task.shotIndex || '—'}音频`} rows={3} value={task.audio || ''} disabled={disabled} onChange={(event) => onEdit({ shotAudio: event.target.value })} className={inputClass} /></label>
      <label className="mt-2 flex flex-wrap items-center gap-2">时长
        <input aria-label={`镜头 ${task.shotIndex || '—'}时长（秒）`} type="number" min={0.1} step={0.1} value={durationDraft} disabled={disabled} onChange={(event) => {
          setDurationDraft(event.target.value)
        }} onBlur={() => {
          const value = Number(durationDraft)
          if (Number.isFinite(value) && value > 0) onEdit({ shotDuration: value })
          else setDurationDraft(String(task.shotDuration ?? 10))
        }} className="w-20 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none focus:border-blue-400 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04]" />秒
      </label>
    </div>
  )
}

function VideoTaskResult({ record, onRetry, onOpen }: {
  record?: VideoTaskRecord
  onRetry: () => void
  onOpen: (windowId: string) => Promise<void>
}) {
  if (!record) return null
  return (
    <>
      {record.failureReason && <div role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-500/20 dark:bg-red-950/20">
        <p className="text-xs font-semibold text-red-700 dark:text-red-400">豆包未生成：{record.failureReason}</p>
        {record.responseText && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-red-600 dark:text-red-300">{record.responseText}</p>}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{record.failureReason === '版权限制' ? '请检查提示词和参考图，改用原创或已获授权的素材后再重试。' : '请根据豆包提示检查内容或素材，调整后再重试。'}</p>
      </div>}
      {record.responseText && !record.failureReason && <details className="mt-2 rounded-xl bg-gray-50 p-2 dark:bg-white/[0.04]"><summary className="cursor-pointer text-xs font-medium">豆包回复</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{record.responseText}</p></details>}
      {record.requestText && <details className="mt-2 rounded-xl bg-blue-50 p-2 dark:bg-blue-950/20"><summary className="cursor-pointer text-xs font-medium">发送给豆包的消息</summary><p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{record.requestText}</p></details>}
      {record.statusText && !record.failureReason && <p className="mt-2 break-words text-xs text-amber-600">{record.statusText}</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {record.url && record.saveState !== 'saved' && <button type="button" disabled={record.saveState === 'saving'} onClick={() => void saveVideoTask(record.id)} className="font-medium text-blue-600 disabled:opacity-40">{record.saveState === 'saving' ? '保存中…' : '保存视频'}</button>}
        {record.retryable && <button type="button" disabled={record.tracking} onClick={onRetry} title="重新提交此镜头" className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline disabled:opacity-40"><RefreshIcon className="h-3.5 w-3.5" />重试</button>}
        {record.windowId && <button type="button" onClick={() => void onOpen(record.windowId!)} className="font-medium text-blue-600 hover:underline">查看本次豆包窗口 ↗</button>}
        {record.taskUrl && <a href={record.taskUrl} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">打开豆包对话 ↗</a>}
      </div>
    </>
  )
}
