import { expect, test } from 'vitest'
import { runVideoBatch } from './videoBatch'

test('服务端未发送的镜头计为暂停而不是失败', async () => {
  let paused: number[] = []
  const result = await runVideoBatch([1, 2, 3], async item => item === 1 ? 'failed' : 'paused', items => { paused = items })
  expect(result).toEqual({ done: 0, pending: 0, failed: 1, paused: 2 })
  expect(paused).toEqual([2, 3])
})

test('所有所选镜头均提交调度，不限制为两个', async () => {
  const sent: number[] = []
  let finishFirst!: (status: string) => void
  const first = new Promise<string>(resolve => { finishFirst = resolve })
  const batch = runVideoBatch([1, 2, 3], async item => {
    sent.push(item)
    return item <= 2 ? first : 'completed'
  }, () => { throw new Error('不应暂停成功批次') })
  expect(sent).toEqual([1, 2, 3])
  finishFirst('completed')
  expect(await batch).toEqual({ done: 3, failed: 0, pending: 0, paused: 0 })
  expect(sent).toEqual([1, 2, 3])
})

test.each(['failed', 'unconfirmed', 'needs_attention', 'generating'])('前序 %s 不中断已经提交调度的镜头', async status => {
  const sent: number[] = []
  let paused: number[] = []
  const result = await runVideoBatch([1, 2, 3, 4], async item => {
    sent.push(item)
    return item === 1 ? status : 'completed'
  }, remaining => { paused = remaining })
  expect(sent).toEqual([1, 2, 3, 4])
  expect(paused).toEqual([])
  expect(result).toEqual({ done: 3, failed: status === 'failed' ? 1 : 0, pending: status === 'failed' ? 0 : 1, paused: 0 })
})
