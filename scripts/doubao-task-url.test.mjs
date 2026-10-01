import { test, expect } from 'vitest'
import { taskUrlFromCandidates } from './doubao-task-url.mjs'

const initial = 'https://www.doubao.com/chat/create-video'
test('保留带对话标识的生成页链接', () => {
  expect(taskUrlFromCandidates([`${initial}?conversation_id=123`], initial)).toBe(`${initial}?conversation_id=123`)
  expect(taskUrlFromCandidates(['/chat/123'], initial)).toBe('https://www.doubao.com/chat/123')
})
test('不把首页、视频下载地址和外部链接作为对话入口', () => {
  expect(taskUrlFromCandidates([initial, `${initial}?source=test`, 'https://cdn.example/a.mp4', 'javascript:alert(1)'], initial)).toBe('')
})

test('排除功能页、空白页和生成任务 ID', () => {
  expect(taskUrlFromCandidates(['/chat/skills', '/chat/new', '/chat/drive', `${initial}?task_id=123`], initial)).toBe('')
})

test('不把发送异常后的零 ID 和本地临时 ID 当成真实任务', () => {
  expect(taskUrlFromCandidates(['/chat/0', '/chat/000', '/chat/local_8710525122725791', `${initial}?conversation_id=0`], initial)).toBe('')
})

test('发送前已经分配的对话 ID 仍可绑定，不要求 URL 改变', () => {
  const assigned = 'https://www.doubao.com/chat/38444399780567810'
  expect(taskUrlFromCandidates([assigned], assigned)).toBe(assigned)
})

test('同一对话的追踪参数及 hash 变化不会被当作其他任务', () => {
  expect(taskUrlFromCandidates(['/chat/123/?source=sidebar#bottom'], initial)).toBe('https://www.doubao.com/chat/123')
  expect(taskUrlFromCandidates([`${initial}?conversation_id=123&source=test#bottom`], initial)).toBe(`${initial}?conversation_id=123`)
})
