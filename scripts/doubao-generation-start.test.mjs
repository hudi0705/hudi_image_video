import { expect, test } from 'vitest'
import { hasGenerationStarted } from './doubao-generation-start.mjs'

test('只有已保存且稳定的实际生成回复释放发送锁', () => {
  const flags = { verified: true, stable: true }
  expect(hasGenerationStarted('正在生成视频，预计等待一分钟', flags)).toBe(true)
  expect(hasGenerationStarted('正在生成视频', { ...flags, verified: false })).toBe(false)
  expect(hasGenerationStarted('正在生成视频', { ...flags, stable: false })).toBe(false)
  expect(hasGenerationStarted('已收到请求', flags)).toBe(false)
  expect(hasGenerationStarted('视频参数确认：请回复确认后开始生成，预计等待一分钟', flags)).toBe(false)
  expect(hasGenerationStarted('无法生成视频，预计等待', flags)).toBe(false)
  expect(hasGenerationStarted('', { ...flags, videoCount: 1 })).toBe(true)
})
