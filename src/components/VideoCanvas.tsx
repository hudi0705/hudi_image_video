import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useNodesState, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { VideoShot } from '../types'
import {
  arrangeVideoShots,
  readVideoCanvasLayout,
  saveVideoCanvasLayout,
  SHOT_STAGES,
  SHOT_STAGE_LABEL,
  SHOT_STAGE_WIDTH,
  shotStageId,
  type ShotStage,
} from '../lib/videoCanvas'

type StageNode = Node<{ stage: ShotStage; title: string; content: ReactNode }, 'stage'>

type Props = {
  projectKey: string
  tasks: VideoShot[]
  /** 同一镜头的三段落载同一个镜头数据：图片、提示词、最终产物 */
  renderStage: (task: VideoShot, stage: ShotStage) => ReactNode
}

const HANDLE_CLASS = '!h-2 !w-2 !border-2 !border-white !bg-blue-400 dark:!border-gray-900'

const EDGE_STYLE = { stroke: '#94a3b8', strokeWidth: 1.5 }

function StageCanvasNode({ data, selected }: NodeProps<StageNode>) {
  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-gray-900 ${selected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-gray-200 dark:border-white/15'}`}>
      {data.stage !== 'frame' && <Handle type="target" position={Position.Left} isConnectable={false} className={HANDLE_CLASS} />}
      <div className="video-shot-drag-handle flex cursor-grab items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-2.5 text-xs font-medium text-gray-600 active:cursor-grabbing dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-gray-300">
        <span>{data.title}</span>
        <span aria-hidden="true" className="text-base leading-none text-gray-400">⠿</span>
      </div>
      <div className="nodrag nopan nowheel max-h-[740px] overflow-y-auto">{data.content}</div>
      {data.stage !== 'output' && <Handle type="source" position={Position.Right} isConnectable={false} className={HANDLE_CLASS} />}
    </div>
  )
}

const NODE_TYPES = { stage: StageCanvasNode }

export default function VideoCanvas({ projectKey, tasks, renderStage }: Props) {
  const [saved] = useState(() => readVideoCanvasLayout(projectKey))
  const positions = useMemo(() => arrangeVideoShots(tasks), [tasks])
  const [nodes, setNodes, onNodesChange] = useNodesState<StageNode>([])
  const flow = useRef<ReactFlowInstance<StageNode> | null>(null)
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    setNodes((previous) => tasks.flatMap((task) => SHOT_STAGES.map((stage) => {
      const id = shotStageId(task.id, stage)
      const existing = previous.find((node) => node.id === id)
      return {
        ...existing,
        id,
        type: 'stage',
        position: existing?.position || saved.positions[id] || positions[id],
        style: { width: SHOT_STAGE_WIDTH[stage] },
        dragHandle: '.video-shot-drag-handle',
        ariaLabel: `镜头 ${task.shotIndex || '—'}${SHOT_STAGE_LABEL[stage]}画布节点`,
        data: { stage, title: `镜头 ${task.shotIndex || '—'} · ${SHOT_STAGE_LABEL[stage]}`, content: renderStage(task, stage) },
      }
    })))
  }, [tasks, renderStage, positions, saved, setNodes])

  const edges = useMemo(() => tasks.flatMap((task) => {
    const link = (from: ShotStage, to: ShotStage) => ({
      id: `${shotStageId(task.id, from)}>${to}`,
      source: shotStageId(task.id, from),
      target: shotStageId(task.id, to),
      type: 'smoothstep',
      selectable: false,
      style: EDGE_STYLE,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    })
    return [link('frame', 'prompt'), link('prompt', 'output')]
  }), [tasks])

  function saveLayout() {
    if (!flow.current) return
    const positions = Object.fromEntries(flow.current.getNodes().map((node) => [node.id, node.position]))
    setSaveError(!saveVideoCanvasLayout(projectKey, { positions, viewport: flow.current.getViewport() }))
  }

  return (
    <div className="video-canvas">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-white/[0.07] dark:text-gray-400">
        <span>拖动标题栏移动节点 · 拖动空白平移 · 滚轮缩放</span>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline">连线：图片 → 提示词 → 最终产物，每个镜头一行，自上而下按镜头顺序</span>
          <button type="button" onClick={() => {
            setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id] })))
            if (flow.current) {
              const viewport = flow.current.getViewport()
              setSaveError(!saveVideoCanvasLayout(projectKey, { positions, viewport }))
            }
          }} className="font-medium text-blue-600 hover:underline dark:text-blue-400">自动排列</button>
          <button type="button" onClick={() => void flow.current?.fitView({ padding: 0.15, maxZoom: 1 })} className="font-medium text-blue-600 hover:underline dark:text-blue-400">查看全部</button>
        </div>
      </div>
      {saveError && <p role="status" className="px-4 py-2 text-xs text-amber-600">布局未能保存，请检查浏览器存储空间。当前仍可继续使用画布。</p>}
      <div role="region" aria-label="视频无限画布" onKeyUp={(event) => {
        if (event.target instanceof HTMLElement && event.target.classList.contains('react-flow__node') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) saveLayout()
      }} className="h-[640px] min-h-[460px] w-full sm:h-[calc(100dvh-27rem)] sm:max-h-[900px]">
        <ReactFlow<StageNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onInit={(instance) => { flow.current = instance }}
          onNodeDragStop={saveLayout}
          onMoveEnd={saveLayout}
          defaultViewport={saved.viewport || { x: 36, y: 32, zoom: 0.85 }}
          minZoom={0.15}
          maxZoom={2}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          colorMode="system"
          ariaLabelConfig={{
            'controls.ariaLabel': '画布缩放控制',
            'controls.zoomIn.ariaLabel': '放大画布',
            'controls.zoomOut.ariaLabel': '缩小画布',
            'controls.fitView.ariaLabel': '适应画布',
            'minimap.ariaLabel': '镜头位置小地图',
            'node.a11yDescription.default': '使用方向键移动节点，按回车选中，按 Escape 取消选择。',
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#cbd5e1" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#93b4f6" maskColor="rgba(148, 163, 184, 0.14)" className="!h-24 !w-36 max-sm:hidden" />
        </ReactFlow>
      </div>
    </div>
  )
}
