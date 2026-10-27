export type VideoCanvasLayout = {
  positions: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
}

/** 画布把一个镜头拆成三段链路：图片 → 提示词 → 最终产物 */
export type ShotStage = 'frame' | 'prompt' | 'output'

export const SHOT_STAGES: ShotStage[] = ['frame', 'prompt', 'output']

export const SHOT_STAGE_LABEL: Record<ShotStage, string> = { frame: '图片', prompt: '提示词', output: '最终产物' }

export const SHOT_STAGE_WIDTH: Record<ShotStage, number> = { frame: 300, prompt: 360, output: 400 }

const SHOT_STAGE_X: Record<ShotStage, number> = { frame: 0, prompt: 420, output: 900 }

/** 单个镜头占一行，行高要容得下最高的提示词节点 */
const SHOT_ROW_HEIGHT = 640

export function shotStageId(shotId: string, stage: ShotStage) {
  return `${shotId}:${stage}`
}

export function readVideoCanvasLayout(projectKey: string): VideoCanvasLayout {
  try {
    const data = JSON.parse(localStorage.getItem(`gpt-image-video-canvas:${projectKey}`) || '{}')
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { positions: {} }
    const positions = data.positions && typeof data.positions === 'object' && !Array.isArray(data.positions)
      ? Object.fromEntries(Object.entries(data.positions).filter(([, value]) => {
        const pos = value as { x?: unknown; y?: unknown } | null
        return pos && typeof pos.x === 'number' && Number.isFinite(pos.x) && typeof pos.y === 'number' && Number.isFinite(pos.y)
      }).map(([id, value]) => {
        const pos = value as { x: number; y: number }
        return [id, { x: pos.x, y: pos.y }]
      })) : {}
    const view = data.viewport
    const viewport = view && typeof view.x === 'number' && Number.isFinite(view.x) && typeof view.y === 'number' && Number.isFinite(view.y) && typeof view.zoom === 'number' && Number.isFinite(view.zoom) && view.zoom > 0
      ? { x: view.x, y: view.y, zoom: Math.max(0.15, Math.min(2, view.zoom)) } : undefined
    return { positions, viewport }
  } catch (err) {
    console.warn('视频画布布局读取失败', err)
    return { positions: {} }
  }
}

export function saveVideoCanvasLayout(projectKey: string, layout: VideoCanvasLayout) {
  try {
    localStorage.setItem(`gpt-image-video-canvas:${projectKey}`, JSON.stringify(layout))
    return true
  } catch (err) {
    console.warn('视频画布布局保存失败', err)
    return false
  }
}

export function arrangeVideoShots(shots: { id: string }[]) {
  const positions: Record<string, { x: number; y: number }> = {}
  shots.forEach((shot, idx) => {
    for (const stage of SHOT_STAGES) positions[shotStageId(shot.id, stage)] = { x: SHOT_STAGE_X[stage], y: idx * SHOT_ROW_HEIGHT }
  })
  return positions
}
