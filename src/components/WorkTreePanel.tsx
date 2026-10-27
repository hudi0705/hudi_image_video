import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkTreeEvent, WorkTreeEventKind, WorkTreeLane, WorkTreeLaneColor } from '../lib/workTree'
import { WORK_TREE_LEGEND } from '../lib/workTree'

type Props = {
  /** 选题 / 生图 / 生视频 三条主线，各占一列一条竖线 */
  lanes: WorkTreeLane[]
  /** 可聚焦的项目，空字符串表示全部项目 */
  projects: { id: string; name: string }[]
  project: string
  onProject: (id: string) => void
  /** 当前聚焦范围内的镜头总数，为 0 时显示空态 */
  shotCount: number
  running: boolean
}

/** 三条线只用来区分轨道，状态颜色单独由节点承担 */
const LANE_HEX: Record<WorkTreeLaneColor, string> = {
  violet: '#8b5cf6',
  blue: '#3b82f6',
  teal: '#10b981',
  rose: '#f43f5e',
}

/** 状态色：失败红、等待琥珀、进行中蓝、完成绿（完成要往后退，所以字色仍是灰的） */
const STATUS_TEXT: Partial<Record<WorkTreeEventKind, string>> = {
  retry: 'text-rose-600 dark:text-rose-400',
  testFail: 'text-rose-600 dark:text-rose-400',
  error: 'text-rose-600 dark:text-rose-400',
  wait: 'text-amber-600 dark:text-amber-400',
  checkpoint: 'text-blue-600 dark:text-blue-400',
}

// 画布几何：三条竖线的横坐标、行高，根须从主线拐出去的位置
const X_TOPIC = 10
const X_IMAGE = 112
const X_VIDEO = 232
const TOPIC_ROW = 40
const SHOT_ROW = 44
const FAN = 26
const PAD = 12
const DOT = 11
/** 镜头分支比生图节点低一点，连线才有向下蔓延的弧度 */
const DROP = 22

function Glyph({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="shrink-0">{children}</svg>
}

function EventGlyph({ kind }: { kind: WorkTreeEventKind }) {
  const stroke = 'stroke-gray-500 dark:stroke-gray-400'
  if (kind === 'commit') return <Glyph><circle cx="8" cy="8" r="4" className="fill-gray-800 dark:fill-gray-200" /></Glyph>
  if (kind === 'handoff') return <Glyph><path d="M8 2.2 13.8 8 8 13.8 2.2 8Z" className="fill-gray-500 dark:fill-gray-400" /></Glyph>
  if (kind === 'checkpoint') return <Glyph><circle cx="8" cy="8" r="4.8" fill="none" strokeWidth="2" className={stroke} /></Glyph>
  if (kind === 'testPass') {
    return <Glyph>
      <circle cx="8" cy="8" r="6.6" className="fill-emerald-500" />
      <path d="m5 8.2 2 2 4-4.4" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  }
  if (kind === 'testFail') {
    return <Glyph>
      <circle cx="8" cy="8" r="6.6" className="fill-rose-500" />
      <path d="m5.9 5.9 4.2 4.2m0-4.2-4.2 4.2" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
    </Glyph>
  }
  if (kind === 'review') {
    return <Glyph>
      <circle cx="8" cy="8" r="6.6" className="fill-slate-600 dark:fill-slate-300" />
      <path d="m5 8.2 2 2 4-4.4" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-slate-800" />
    </Glyph>
  }
  if (kind === 'fork') return <Glyph><circle cx="8" cy="8" r="2.2" className="fill-gray-500 dark:fill-gray-400" /></Glyph>
  if (kind === 'merge') {
    return <Glyph>
      <circle cx="8" cy="8" r="6.2" fill="none" strokeWidth="1.6" className={stroke} />
      <circle cx="8" cy="8" r="3.2" className="fill-gray-600 dark:fill-gray-300" />
    </Glyph>
  }
  if (kind === 'artifact') {
    return <Glyph>
      <path d="M2 4.8c0-.6.5-1.1 1.1-1.1h2.6l1.3 1.5h5.1c.6 0 1 .5 1 1.1v4.6c0 .6-.4 1.1-1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1V4.8Z" fill="none" strokeWidth="1.4" className={stroke} />
    </Glyph>
  }
  if (kind === 'tool') return <Glyph><circle cx="8" cy="8" r="1.8" className="fill-gray-400 dark:fill-gray-500" /></Glyph>
  if (kind === 'model') {
    return <Glyph>
      <circle cx="8" cy="8" r="5.6" fill="none" strokeWidth="1.4" className={stroke} />
      <path d="M7.1 10.3h1.4a1.6 1.6 0 0 0 0-3.2H6.5l1-1.1" fill="none" strokeWidth="1.3" strokeLinecap="round" className={stroke} />
    </Glyph>
  }
  if (kind === 'compact') {
    return <Glyph>
      <path d="M4.8 11.4V4.6l6.4 6.8V4.6" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={stroke} />
    </Glyph>
  }
  if (kind === 'wait') return <Glyph><circle cx="8" cy="8" r="4.9" fill="none" strokeWidth="2" className="stroke-amber-500" /></Glyph>
  if (kind === 'crossRef') {
    return <Glyph><circle cx="8" cy="8" r="5.4" fill="none" strokeWidth="1.4" strokeDasharray="2 2" className={stroke} /></Glyph>
  }
  if (kind === 'error') {
    return <Glyph>
      <circle cx="8" cy="8" r="6.6" className="fill-rose-600" />
      <path d="M8 4.7v3.9" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r="0.9" fill="white" />
    </Glyph>
  }
  return <Glyph>
    <circle cx="8" cy="8" r="5.8" fill="none" strokeWidth="1.5" className="stroke-rose-500" />
    <path d="M10.4 7.4A2.9 2.9 0 1 0 8 10.9" fill="none" strokeWidth="1.5" strokeLinecap="round" className="stroke-rose-500" />
    <path d="M10.9 5.1v2.5H8.4" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="stroke-rose-500" />
  </Glyph>
}

/** 节点圆点只表达状态，颜色不跟主线走 */
function NodeDot({ kind }: { kind: WorkTreeEventKind }) {
  if (kind === 'testPass') {
    return (
      <span className="flex h-[11px] w-[11px] items-center justify-center rounded-full bg-emerald-500 text-white">
        <svg viewBox="0 0 12 12" width="7" height="7" aria-hidden="true"><path d="M2.4 6.2 4.8 8.5 9.6 3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    )
  }
  if (kind === 'retry' || kind === 'testFail' || kind === 'error') {
    return (
      <span className="flex h-[11px] w-[11px] items-center justify-center rounded-full bg-rose-500 text-white">
        <svg viewBox="0 0 12 12" width="7" height="7" aria-hidden="true"><path d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </span>
    )
  }
  if (kind === 'wait') return <span className="flex h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-amber-500 bg-gray-50 dark:bg-gray-900" />
  if (kind === 'checkpoint') {
    return (
      <span className="flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-blue-500 bg-gray-50 dark:bg-gray-900">
        <span className="h-[3px] w-[3px] rounded-full bg-blue-500 motion-safe:animate-pulse" />
      </span>
    )
  }
  // 只是事实（有图 / 分组）的节点用小实心点，状态节点用大圆点，靠尺寸分主次
  return (
    <span className="flex h-[11px] w-[11px] shrink-0 items-center justify-center">
      <span className="h-[7px] w-[7px] rounded-full bg-gray-400 dark:bg-gray-500" />
    </span>
  )
}

/** 节点文字块：标题一行、meta 一行，宽度按所在轨道固定 */
function NodeText({ item, left, top, width, withIndex }: { item: WorkTreeEvent; left: number; top: number; width: number; withIndex: boolean }) {
  return (
    <div className="absolute flex gap-1.5" style={{ left, top, width }} title={item.hint || `${item.title} · ${item.meta}`}>
      {withIndex && (
        <span className="w-[15px] shrink-0 font-mono text-[10px] leading-[18px] tabular-nums text-gray-400 dark:text-gray-500">
          {String(item.shotIndex || 0).padStart(2, '0')}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium leading-[18px] text-gray-800 dark:text-gray-100">{item.title}</p>
        <p className={`truncate text-[10.5px] leading-[15px] ${STATUS_TEXT[item.kind] || 'text-gray-400 dark:text-gray-500'}`}>{item.meta}</p>
      </div>
    </div>
  )
}

export default function WorkTreePanel(props: Props) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const focusOptions = [{ id: '', name: '全部项目' }, ...props.projects]
  const focusName = focusOptions.find((option) => option.id === props.project)?.name || '全部项目'
  const branchCount = props.lanes.find((lane) => lane.branched)?.items.length || 0
  const clock = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

  const topicLane = props.lanes.find((lane) => lane.id === 'topic')
  const imageLane = props.lanes.find((lane) => lane.id === 'image')
  const videoLane = props.lanes.find((lane) => lane.id === 'video')
  const topics = topicLane ? topicLane.items : []
  const images = imageLane ? imageLane.items : []
  const videos = videoLane ? videoLane.items : []

  // 树根几何：选题在左上扎根，生图线从选题拐出去；每个镜头的视频任务再拐一道弯落进右侧
  const topicY = (index: number) => PAD + index * TOPIC_ROW + 14
  const rowTop = PAD + topics.length * TOPIC_ROW + (topics.length ? FAN : 0)
  const imageY = (index: number) => rowTop + index * SHOT_ROW + 14
  const videoY = (index: number) => imageY(index) + DROP
  const bodyHeight = rowTop + images.length * SHOT_ROW + DROP + 8
  /** 主干拐进生图线的位置：第一个镜头上方一点 */
  const bendY = images.length > 0 ? imageY(0) - 18 : topicY(Math.max(topics.length - 1, 0)) + 18

  const topicColor = LANE_HEX[(topicLane && topicLane.color) || 'violet']
  const imageColor = LANE_HEX[(imageLane && imageLane.color) || 'blue']
  const videoColor = LANE_HEX[(videoLane && videoLane.color) || 'teal']

  return (
    <section aria-label="工作树" className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-50/90 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <header className="flex shrink-0 items-center gap-1.5 px-3.5 pb-2 pt-3">
        <h3 className="shrink-0 text-[13px] font-semibold text-gray-900 dark:text-gray-100">工作树</h3>
        <button
          type="button"
          title="点击切换聚焦项目"
          onClick={() => {
            const index = focusOptions.findIndex((option) => option.id === props.project)
            props.onProject(focusOptions[(index + 1) % focusOptions.length].id)
          }}
          className="flex min-w-0 max-w-[112px] items-center gap-0.5 rounded-full bg-gray-900/[0.055] px-2 py-[1px] text-[10px] font-medium text-gray-600 transition-colors hover:bg-gray-900/[0.1] dark:bg-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.16]"
        >
          <span className="truncate">{focusName}</span>
          <svg viewBox="0 0 10 10" width="7" height="7" aria-hidden="true" className="shrink-0 opacity-50"><path d="m2 4 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
          <time className="font-mono tabular-nums">{clock}</time>
          <span className={`h-1 w-1 rounded-full ${props.running ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
          {props.running ? '运行中' : '待命'}
        </span>
      </header>

      {/* 三条线的名字挂在图上会挤，收成一排：一小截轨道 + 阶段名 + 进度 */}
      <div className="flex shrink-0 items-center gap-3 px-3.5 pb-1">
        {props.lanes.map((lane) => (
          <span key={lane.id} className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="w-[2px] shrink-0 rounded-full" style={{ height: 9, backgroundColor: LANE_HEX[lane.color] }} />
            {lane.name}
            {lane.total > 0 && <span className="font-mono text-[9.5px] tabular-nums text-gray-400 dark:text-gray-500">{lane.done}/{lane.total}</span>}
          </span>
        ))}
      </div>

      {props.shotCount === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pb-6">
          <div aria-hidden="true" className="flex items-start gap-2">
            {props.lanes.map((lane) => (
              <span key={lane.id} className="flex flex-col items-center gap-1.5">
                <span className="h-[7px] w-[7px] rounded-full border-[1.5px]" style={{ borderColor: LANE_HEX[lane.color], opacity: 0.5 }} />
                <span className="h-9 w-[1.5px] rounded-full" style={{ backgroundImage: `linear-gradient(to bottom, ${LANE_HEX[lane.color]}66, ${LANE_HEX[lane.color]}00)` }} />
              </span>
            ))}
          </div>
          <p className="text-center text-[11px] text-gray-500 dark:text-gray-400">还没有镜头进入工作树</p>
          <p className="max-w-[250px] text-balance text-center text-[10.5px] leading-5 text-gray-400 dark:text-gray-500">
            生成带镜头编号的图片后，三条线上会出现节点，视频任务挂在生视频线当分支。
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_18px),transparent)]">
          <div className="relative" style={{ height: bodyHeight }}>
            <svg className="pointer-events-none absolute inset-0" width="100%" height={bodyHeight} aria-hidden="true">
              {/* 主干先一直往下长，到第一个镜头再拐进生图线 */}
              {topics.length > 0 && (
                <line x1={X_TOPIC + 1} y1={PAD} x2={X_TOPIC + 1} y2={bendY} stroke={topicColor} strokeWidth="1.6" strokeOpacity="0.55" strokeLinecap="round" />
              )}
              {topics.length > 0 && images.length > 0 && (
                <path
                  d={`M ${X_TOPIC + 1} ${bendY} C ${X_TOPIC + 32} ${bendY + 4}, ${X_IMAGE - 30} ${rowTop + 2}, ${X_IMAGE + 1} ${rowTop + 14}`}
                  fill="none"
                  stroke={topicColor}
                  strokeWidth="1.6"
                  strokeOpacity="0.5"
                  strokeLinecap="round"
                />
              )}
              <line
                x1={X_IMAGE + 1}
                y1={topics.length > 0 ? rowTop + 12 : PAD}
                x2={X_IMAGE + 1}
                y2={bodyHeight - 10}
                stroke={imageColor}
                strokeWidth="1.6"
                strokeOpacity="0.5"
                strokeLinecap="round"
              />
              <line
                x1={X_VIDEO + 1}
                y1={images.length > 0 ? videoY(0) : PAD}
                x2={X_VIDEO + 1}
                y2={bodyHeight - 10}
                stroke={videoColor}
                strokeWidth="1.6"
                strokeOpacity="0.5"
                strokeLinecap="round"
              />
              {images.map((item, index) => {
                const video = videos[index]
                const dashed = Boolean(video && video.id.endsWith(':pending'))
                return (
                  <path
                    key={`root-${item.id}`}
                    d={`M ${X_IMAGE + 1} ${imageY(index) + 3} C ${X_IMAGE + 2} ${imageY(index) + 34}, ${X_VIDEO - 40} ${videoY(index) + 14}, ${X_VIDEO} ${videoY(index)}`}
                    fill="none"
                    stroke={videoColor}
                    strokeWidth="1.4"
                    strokeOpacity={dashed ? 0.3 : 0.5}
                    strokeDasharray={dashed ? '2.5 3' : undefined}
                    strokeLinecap="round"
                  />
                )
              })}
            </svg>

            {topics.map((item, index) => (
              <div key={item.id}>
                <span className="absolute" style={{ left: X_TOPIC - DOT / 2 + 1, top: topicY(index) - DOT / 2 }}>
                  <NodeDot kind={item.kind} />
                </span>
                <NodeText item={item} left={X_TOPIC + 10} top={topicY(index) - 9} width={X_IMAGE - X_TOPIC - 20} withIndex={false} />
              </div>
            ))}

            {images.map((item, index) => (
              <div key={item.id}>
                <span className="absolute" style={{ left: X_IMAGE - DOT / 2 + 1, top: imageY(index) - DOT / 2 }}>
                  <NodeDot kind={item.kind} />
                </span>
                <NodeText item={item} left={X_IMAGE + 14} top={imageY(index) - 9} width={X_VIDEO - X_IMAGE - 22} withIndex />
                {videos[index] && (
                  <>
                    <span className="absolute" style={{ left: X_VIDEO - DOT / 2 + 1, top: videoY(index) - DOT / 2 }}>
                      <NodeDot kind={videos[index].kind} />
                    </span>
                    <NodeText item={videos[index]} left={X_VIDEO + 12} top={videoY(index) - 9} width={383 - X_VIDEO - 14} withIndex={false} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-gray-200/70 px-3.5 pb-3 pt-2.5 dark:border-white/[0.07]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">图例 · 轨道事件</span>
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-gray-400 dark:text-gray-500">{branchCount} 个镜头分支</span>
        </div>
        <div className="mt-2 grid grid-flow-col grid-rows-4 gap-x-2 gap-y-1.5">
          {WORK_TREE_LEGEND.map((item) => (
            <span key={item.kind} className="flex min-w-0 items-center gap-1 text-[9.5px] text-gray-500 dark:text-gray-400">
              <EventGlyph kind={item.kind} />
              <span className="truncate">{item.label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
