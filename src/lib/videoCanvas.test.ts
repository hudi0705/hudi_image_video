import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { arrangeVideoShots, readVideoCanvasLayout, saveVideoCanvasLayout, SHOT_STAGES, shotStageId } from './videoCanvas'

beforeEach(() => {
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('画布按项目保存布局和视口，互不覆盖且保留负坐标', () => {
  const first = { positions: { shot: { x: -520, y: 180 } }, viewport: { x: 120, y: -40, zoom: 0.6 } }
  const second = { positions: { other: { x: 0, y: 300 } } }
  expect(saveVideoCanvasLayout('项目甲', first)).toBe(true)
  expect(saveVideoCanvasLayout('项目乙', second)).toBe(true)
  expect(readVideoCanvasLayout('项目甲')).toEqual(first)
  expect(readVideoCanvasLayout('项目乙')).toEqual(second)
  expect(readVideoCanvasLayout('新项目')).toEqual({ positions: {} })
})

test('恢复布局时忽略损坏坐标和非法缩放，仍保留有效镜头位置', () => {
  localStorage.setItem('gpt-image-video-canvas:项目', JSON.stringify({
    positions: { valid: { x: -10, y: 25 }, missing: { x: 3 }, string: { x: '5', y: 5 }, empty: null },
    viewport: { x: 0, y: 0, zoom: -1 },
  }))
  expect(readVideoCanvasLayout('项目')).toEqual({ positions: { valid: { x: -10, y: 25 } } })
  localStorage.setItem('gpt-image-video-canvas:项目', '{broken')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  expect(readVideoCanvasLayout('项目')).toEqual({ positions: {} })
})

test('浏览器存储不可用时保留画布可用性并报告保存失败', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('读取被阻止') },
    setItem: () => { throw new Error('空间不足') },
  })
  expect(readVideoCanvasLayout('项目')).toEqual({ positions: {} })
  expect(saveVideoCanvasLayout('项目', { positions: {} })).toBe(false)
})

test('自动排列把每个镜头拆成图片、提示词、产物三列并按镜头顺序换行', () => {
  const shots = Array.from({ length: 3 }, (_, idx) => ({ id: String(idx) }))
  const positions = arrangeVideoShots(shots)
  const row = (id: string) => SHOT_STAGES.map((stage) => positions[shotStageId(id, stage)])
  const [frame, prompt, output] = row('0')
  expect(frame).toEqual({ x: 0, y: 0 })
  expect(prompt.x).toBeGreaterThan(frame.x)
  expect(output.x).toBeGreaterThan(prompt.x)
  expect(new Set([frame.y, prompt.y, output.y]).size).toBe(1)
  expect(row('1')[0].y).toBeGreaterThan(600)
  expect(new Set(Object.values(positions).map((pos) => `${pos.x}:${pos.y}`)).size).toBe(shots.length * SHOT_STAGES.length)
})
