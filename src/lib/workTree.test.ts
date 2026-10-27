import { describe, expect, it } from 'vitest'
import type { VideoShot, VideoTaskRecord } from '../types'
import { buildWorkTree, WORK_TREE_LEGEND } from './workTree'

const shot = (patch: Partial<VideoShot>) => ({
  id: 'task-1',
  imageId: 'abcdef1234',
  outputImages: ['abcdef1234'],
  shotIndex: 1,
  ...patch,
} as VideoShot)

const record = (patch: Partial<VideoTaskRecord>) => ({
  id: 'task-1',
  imageId: 'img',
  status: 'generating',
  statusText: '',
  requestText: '',
  responseText: '',
  taskUrl: '',
  url: '',
  downloadUrl: '',
  tracking: false,
  retryable: false,
  uncertain: false,
  saveState: 'pending',
  ...patch,
} as VideoTaskRecord)

const lane = (lanes: ReturnType<typeof buildWorkTree>, id: string) => lanes.find((item) => item.id === id)!

describe('工作树是三条主线加生视频分支', () => {
  it('固定输出选题、生图、生视频三条主线，只有生视频带分支', () => {
    const lanes = buildWorkTree([], {})
    expect(lanes.map((item) => item.name)).toEqual(['选题', '生图', '生视频'])
    expect(lanes.map((item) => item.color)).toEqual(['violet', 'blue', 'teal'])
    expect(lanes.map((item) => Boolean(item.branched))).toEqual([false, false, true])
    expect(lanes.every((item) => item.items.length === 0)).toBe(true)
  })

  it('选题线每个项目一个节点，按镜头数统计', () => {
    const lanes = buildWorkTree([
      shot({ id: 'a', shotIndex: 1, shotProjectName: '河流' }),
      shot({ id: 'b', shotIndex: 2, shotProjectName: '河流' }),
      shot({ id: 'c', shotIndex: 3, shotProjectName: '山谷' }),
      shot({ id: 'd', shotIndex: 4 }),
    ], {})
    expect(lane(lanes, 'topic')).toMatchObject({ done: 2, total: 2 })
    expect(lane(lanes, 'topic').items).toEqual([
      { id: 'topic:河流', kind: 'fork', title: '河流', meta: '2 个镜头' },
      { id: 'topic:山谷', kind: 'fork', title: '山谷', meta: '1 个镜头' },
    ])
  })

  it('生图线每个带图镜头一个产物节点，没图的镜头只计入总数', () => {
    const lanes = buildWorkTree([
      shot({ id: 'a', shotIndex: 1, shotProjectName: '河流' }),
      shot({ id: 'b', shotIndex: 2, imageId: '', outputImages: [] }),
    ], {})
    expect(lane(lanes, 'image')).toMatchObject({ done: 1, total: 2 })
    expect(lane(lanes, 'image').items).toEqual([
      { id: 'a:image', kind: 'artifact', title: '首帧', meta: '河流', shotIndex: 1 },
    ])
  })

  it('生图线优先显示这句提示词，空格压成一个再截断', () => {
    const lanes = buildWorkTree([
      shot({ id: 'a', shotIndex: 1, prompt: '  黄昏的河面   漂着一只小船  ' }),
      shot({ id: 'b', shotIndex: 2, prompt: '夜晚的山谷里下着一场非常大的雨' }),
    ], {})
    expect(lane(lanes, 'image').items.map((item) => item.meta)).toEqual([
      '黄昏的河面 漂着一只小船',
      '夜晚的山谷里下着一场非常…',
    ])
  })

  it('生视频线每个镜头一条分支：完成、生成中、待重试', () => {
    const lanes = buildWorkTree([
      shot({ id: 'a', shotIndex: 1 }),
      shot({ id: 'b', shotIndex: 2 }),
      shot({ id: 'c', shotIndex: 3 }),
    ], {
      a: record({ id: 'a', url: 'blob:1' }),
      b: record({ id: 'b', tracking: true, statusText: '豆包已受理，正在生成视频…' }),
      c: record({ id: 'c', status: 'failed', retryable: true, statusText: 'Failed to fetch' }),
    })
    expect(lane(lanes, 'video')).toMatchObject({ done: 1, total: 3 })
    expect(lane(lanes, 'video').items).toEqual([
      { id: 'a:video', kind: 'testPass', title: '完成', meta: '镜头1.mp4', shotIndex: 1 },
      { id: 'b:running', kind: 'checkpoint', title: '生成中', meta: '豆包已受理，正在生成视频…', shotIndex: 2 },
      { id: 'c:retry', kind: 'retry', title: '待重试', meta: 'Failed to fetch', shotIndex: 3 },
    ])
  })

  it('还没交给豆包的镜头也挂一条等待分支', () => {
    const lanes = buildWorkTree([shot({ id: 'a', shotIndex: 2 })], {})
    expect(lane(lanes, 'video').items).toEqual([
      { id: 'a:pending', kind: 'wait', title: '待提交', meta: '还没交给豆包', shotIndex: 2 },
    ])
  })

  it('镜头全部进树，多出来的靠面板自己滚动', () => {
    const tasks = Array.from({ length: 12 }, (_, index) => shot({ id: `s${index}`, shotIndex: index + 1 }))
    const lanes = buildWorkTree(tasks, {})
    expect(lane(lanes, 'image').items).toHaveLength(12)
    expect(lane(lanes, 'video').items).toHaveLength(12)
    expect(lane(lanes, 'video').items[0].id).toBe('s0:pending')
    expect(lane(lanes, 'image')).toMatchObject({ done: 12, total: 12 })
  })

  it('同一个项目内按镜头号从上往下排，项目之间保持传入顺序', () => {
    const lanes = buildWorkTree([
      shot({ id: 'b2', shotIndex: 2, shotProjectName: '河流' }),
      shot({ id: 'a1', shotIndex: 1, shotProjectName: '山谷' }),
      shot({ id: 'b1', shotIndex: 1, shotProjectName: '河流' }),
    ], {})
    expect(lane(lanes, 'image').items.map((item) => item.id)).toEqual(['b1:image', 'b2:image', 'a1:image'])
    expect(lane(lanes, 'video').items.map((item) => item.shotIndex)).toEqual([1, 2, 1])
  })

  it('生图线的型号取最近镜头的生图模型', () => {
    expect(lane(buildWorkTree([shot({ apiModel: 'gpt-image-1' })], {}), 'image').model).toBe('gpt-image-1')
    expect(lane(buildWorkTree([shot({})], {}), 'image').model).toBe('生图')
  })
})

describe('WORK_TREE_LEGEND', () => {
  it('按列优先排布成 4 列 16 项', () => {
    expect(WORK_TREE_LEGEND).toHaveLength(16)
    expect(WORK_TREE_LEGEND.slice(0, 4).map((item) => item.label)).toEqual(['提交/保存', '交接·无损', '检查点', '测试 ✓'])
    expect(WORK_TREE_LEGEND.slice(12).map((item) => item.label)).toEqual(['等待你', '跨线引用', '错误', '重试'])
  })
})
