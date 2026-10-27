import type { VideoTaskRecord } from '../types'
import { shotFolderName } from './shotProjectExport'

export type WorkTreeEventKind =
  | 'commit'
  | 'handoff'
  | 'checkpoint'
  | 'testPass'
  | 'testFail'
  | 'review'
  | 'fork'
  | 'merge'
  | 'artifact'
  | 'tool'
  | 'model'
  | 'compact'
  | 'wait'
  | 'crossRef'
  | 'error'
  | 'retry'

export type WorkTreeLaneColor = 'blue' | 'violet' | 'teal' | 'rose'
export type WorkTreeStageId = 'topic' | 'image' | 'video'

/** 工作树只关心这几个字段，生图页面直接复用 TaskRecord */
export type WorkTreeShot = {
  id: string
  imageId?: string
  prompt?: string
  createdAt?: number
  outputImages: string[]
  shotIndex?: number
  shotProjectName?: string
  apiModel?: string
}

export interface WorkTreeEvent {
  id: string
  kind: WorkTreeEventKind
  title: string
  meta: string
  /** 镜头号，选题这类非镜头节点没有 */
  shotIndex?: number
  /** 节点上被截断的原文，留给 hover 提示 */
  hint?: string
}

/** 一条主线一列：选题 / 生图 / 生视频 各一条竖线 */
export type WorkTreeLane = {
  id: WorkTreeStageId
  name: string
  color: WorkTreeLaneColor
  /** 这条线用的模型或数据来源 */
  model: string
  done: number
  total: number
  /** 生视频线的节点是镜头分支，画在主线上再向右缩进 */
  branched?: boolean
  items: WorkTreeEvent[]
}

/** 图例按列优先排布：每 4 项一列，顺序与工作树截图一致 */
export const WORK_TREE_LEGEND: { kind: WorkTreeEventKind; label: string }[] = [
  { kind: 'commit', label: '提交/保存' },
  { kind: 'handoff', label: '交接·无损' },
  { kind: 'checkpoint', label: '检查点' },
  { kind: 'testPass', label: '测试 ✓' },
  { kind: 'testFail', label: '测试 ×' },
  { kind: 'review', label: '审查通过' },
  { kind: 'fork', label: '分叉' },
  { kind: 'merge', label: '合并' },
  { kind: 'artifact', label: '产物' },
  { kind: 'tool', label: '工具调用' },
  { kind: 'model', label: '模型切换' },
  { kind: 'compact', label: '上下文压缩' },
  { kind: 'wait', label: '等待你' },
  { kind: 'crossRef', label: '跨线引用' },
  { kind: 'error', label: '错误' },
  { kind: 'retry', label: '重试' },
]

// 侧栏宽度有限，节点里的提示文字只保留一个可辨认的开头
function clip(text: string, max: number) {
  const value = (text || '').trim().replace(/\s+/g, ' ')
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 选题线：每个项目（选题）一个节点 */
function topicEvents(tasks: WorkTreeShot[]): WorkTreeEvent[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const name = task.shotProjectName?.trim()
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ id: `topic:${name}`, kind: 'fork' as const, title: name, meta: `${count} 个镜头` }))
}

/** 生图线：每个带图的镜头一个产物节点 */
function imageEvents(tasks: WorkTreeShot[]): WorkTreeEvent[] {
  const events: WorkTreeEvent[] = []
  for (const task of tasks) {
    const imageId = task.imageId || task.outputImages[0] || ''
    if (!imageId) continue
    events.push({
      id: `${task.id}:image`,
      kind: 'artifact',
      title: '首帧',
      meta: clip(task.prompt ?? '', 12) || clip(task.shotProjectName?.trim() || '已出图', 10),
      hint: task.prompt,
      shotIndex: task.shotIndex || 0,
    })
  }
  return events
}

/** 生视频线：每个镜头的豆包任务都是主线分出来的一条分支 */
function shotEvents(tasks: WorkTreeShot[], records: Record<string, VideoTaskRecord>): WorkTreeEvent[] {
  return tasks.map((task) => {
    const record = records[task.id]
    const shot = task.shotIndex || 0
    if (!record) return { id: `${task.id}:pending`, kind: 'wait', title: '待提交', meta: '还没交给豆包', shotIndex: shot }
    if (record.url) return { id: `${task.id}:video`, kind: 'testPass', title: '完成', meta: `${shotFolderName(shot)}.mp4`, shotIndex: shot }
    if (record.tracking) return { id: `${task.id}:running`, kind: 'checkpoint', title: '生成中', meta: clip(record.statusText, 14) || '豆包处理中', shotIndex: shot }
    if (record.status === 'needs_attention') return { id: `${task.id}:wait`, kind: 'wait', title: '待确认', meta: '豆包等你点一下', shotIndex: shot }
    return { id: `${task.id}:retry`, kind: 'retry', title: '待重试', meta: clip(record.statusText || '尚未发送', 18), shotIndex: shot }
  })
}

/** 三条主线并列：选题、生图各一条，镜头的视频任务从生视频线分出来 */
export function buildWorkTree(tasks: WorkTreeShot[], records: Record<string, VideoTaskRecord>): WorkTreeLane[] {
  // 从上往下按镜头号读：项目按最早镜头生成时间排，项目内按 01、02 排
  const projectOf = (task: WorkTreeShot) => task.shotProjectName?.trim() || ''
  const rank = new Map<string, number>()
  for (const task of [...tasks].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    if (!rank.has(projectOf(task))) rank.set(projectOf(task), rank.size)
  }
  const ordered = [...tasks].sort((a, b) => (rank.get(projectOf(a)) || 0) - (rank.get(projectOf(b)) || 0) || (a.shotIndex || 0) - (b.shotIndex || 0))

  const shots = ordered.filter((task) => task.outputImages.length > 0 || task.imageId)
  const submitted = shots.filter((task) => records[task.id])
  const generated = submitted.filter((task) => records[task.id].url)
  const topics = topicEvents(ordered)
  const withImage = topicEvents(shots)
  return [
    { id: 'topic', name: '选题', color: 'violet', model: '按项目分组', done: withImage.length, total: topics.length, items: topics },
    { id: 'image', name: '生图', color: 'blue', model: tasks[0]?.apiModel?.trim() || '生图', done: shots.length, total: tasks.length, items: imageEvents(shots) },
    { id: 'video', name: '生视频', color: 'teal', model: '豆包', done: generated.length, total: shots.length, branched: true, items: shotEvents(shots, records) },
  ]
}
