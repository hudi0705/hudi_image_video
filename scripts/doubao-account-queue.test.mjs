import { expect, test } from 'vitest'
import { AccountQueue } from './doubao-account-queue.mjs'

test('所选镜头依次受理后全部并行，确认阶段不释放发送锁', async () => {
  const queue = new AccountQueue()
  const started = []
  const unlock = []
  const finish = []
  const operation = id => release => new Promise(resolve => {
    started.push(id)
    unlock[id - 1] = release
    finish[id - 1] = () => resolve({ status: 'completed' })
  })
  const jobs = [1, 2, 3].map(id => queue.run('a', operation(id)))
  await Promise.resolve()
  expect(started).toEqual([1])
  unlock[0]()
  await Promise.resolve()
  expect(started).toEqual([1, 2])
  unlock[1]()
  await Promise.resolve()
  expect(started).toEqual([1, 2, 3])
  finish[0]()
  await jobs[0]
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(started).toEqual([1, 2, 3])
  finish[1]()
  finish[2]()
  await Promise.all(jobs)
})

test('前序失败不取消排队任务，也不影响已经受理的任务', async () => {
  const queue = new AccountQueue()
  let fail
  let finish
  const first = queue.run('a', release => { release(); return new Promise(resolve => { fail = resolve }) })
  const second = queue.run('a', () => new Promise(resolve => { finish = resolve }))
  const third = queue.run('a', async () => ({ status: 'completed' }))
  await new Promise(resolve => setTimeout(resolve, 0))
  fail({ status: 'unconfirmed' })
  await first
  finish({ status: 'completed' })
  await expect(second).resolves.toEqual({ status: 'completed' })
  await expect(third).resolves.toEqual({ status: 'completed' })
})

test('同账号多次请求串行，不同账号可以独立处理', async () => {
  const queue = new AccountQueue()
  const started = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const first = queue.run('a', async () => { started.push('a1'); await gate; return { status: 'completed' } })
  const second = queue.run('a', async () => { started.push('a2'); return { status: 'completed' } })
  await queue.run('b', async () => { started.push('b1'); return { status: 'completed' } })
  expect(started).toEqual(['a1', 'b1'])
  release()
  await Promise.all([first, second])
  expect(started).toEqual(['a1', 'b1', 'a2'])
})

test.each(['failed', 'unconfirmed', 'needs_attention', 'generating'])('前序 %s 时继续执行同账号排队任务', async status => {
  const queue = new AccountQueue()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const first = queue.run('a', async () => {
    await gate
    if (status === 'failed') throw Object.assign(new Error('发送受限：710022004'), { code: 'DOUBAO_SUBMIT_FAILED' })
    return { status }
  })
  const firstOutcome = first.catch(error => error)
  let sent = 0
  const second = queue.run('a', async () => { sent++; return { status: 'completed' } })
  const third = queue.run('a', async () => { sent++; return { status: 'completed' } })
  release()
  await firstOutcome
  await Promise.all([second, third])
  expect(sent).toBe(2)
  await Promise.resolve()
  await expect(queue.run('a', async () => ({ status: 'completed' }))).resolves.toEqual({ status: 'completed' })
})

test('后序任务失败及单独重试不影响前序仍在生成的任务', async () => {
  const queue = new AccountQueue()
  let finish
  const first = queue.run('a', release => {
    release()
    return new Promise(resolve => { finish = resolve })
  })
  const second = queue.run('a', () => { throw new Error('镜头二失败') })
  await expect(second).rejects.toThrow('镜头二失败')
  await expect(queue.run('a', async () => ({ status: 'completed' }))).resolves.toEqual({ status: 'completed' })
  finish({ status: 'completed' })
  await expect(first).resolves.toEqual({ status: 'completed' })
})
