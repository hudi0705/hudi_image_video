import { test, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { TaskBinding } from './doubao-task-binding.mjs'

test('发送期间捕获地址，即使确认前关闭也能恢复；绑定后不跟随其他对话', () => {
  let current = 'https://www.doubao.com/chat/create-video'
  const frame = { url: () => current }
  const page = Object.assign(new EventEmitter(), { url: () => current, mainFrame: () => frame })
  const binding = new TaskBinding(page, current)
  binding.startSending()
  current = 'https://www.doubao.com/chat/38444341520964610'
  page.emit('framenavigated', frame)
  expect(binding.recoveryUrl).toBe(current)
  binding.confirm()
  current = 'https://www.doubao.com/chat/999'
  page.emit('framenavigated', frame)
  expect(binding.url).toBe('https://www.doubao.com/chat/38444341520964610')
})

test('不绑定发送前导航或 iframe，发送前已分配的地址可绑定', () => {
  const initial = 'https://www.doubao.com/chat/create-video'
  const frame = { url: () => 'https://www.doubao.com/chat/123' }
  const page = Object.assign(new EventEmitter(), { url: frame.url, mainFrame: () => frame })
  const binding = new TaskBinding(page, initial)
  page.emit('framenavigated', frame)
  expect(binding.recoveryUrl).toBe('')
  binding.startSending()
  page.emit('framenavigated', { url: () => 'https://www.doubao.com/chat/999' })
  binding.confirm()
  expect(binding.url).toBe(frame.url())
})

test('发送前空对话 A 不覆盖确认发送后的真实对话 B', () => {
  let current = 'https://www.doubao.com/chat/111'
  const frame = { url: () => current }
  const page = Object.assign(new EventEmitter(), { url: () => current, mainFrame: () => frame })
  const binding = new TaskBinding(page, current)
  binding.startSending()
  current = 'https://www.doubao.com/chat/38444341520964610'
  page.emit('framenavigated', frame)
  binding.confirm()
  expect(binding.url).toBe(current)
})

test('确认时仍无对话地址，不把此前临时地址当成已确认任务', () => {
  let current = 'https://www.doubao.com/chat/111'
  const frame = { url: () => current }
  const page = Object.assign(new EventEmitter(), { url: () => current, mainFrame: () => frame })
  const binding = new TaskBinding(page, current)
  binding.startSending()
  current = 'https://www.doubao.com/chat/create-video'
  binding.confirm()
  expect(binding.recoveryUrl).toBe('')
})

test('导航事件本身不改绑，确认消息仍在时才能接受延迟地址；验证后冻结', () => {
  let current = 'https://www.doubao.com/chat/111'
  const frame = { url: () => current }
  const page = Object.assign(new EventEmitter(), { url: () => current, mainFrame: () => frame })
  const binding = new TaskBinding(page, current)
  binding.startSending()
  binding.confirm()
  current = 'https://www.doubao.com/chat/222'
  page.emit('framenavigated', frame)
  expect(binding.url).toBe('https://www.doubao.com/chat/111')
  expect(binding.confirmVisibleMessage(current)).toBe(true)
  expect(binding.url).toBe(current)
  expect(binding.markVerified('https://www.doubao.com/chat/111')).toBe(false)
  expect(binding.markVerified(current)).toBe(true)
  expect(binding.confirmVisibleMessage('https://www.doubao.com/chat/333')).toBe(false)
})
