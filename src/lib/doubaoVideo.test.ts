import { describe, expect, it } from 'vitest'
import { isQuotaError, readSeedanceTaskId, readVideoUrl, requestDoubaoVideo } from './doubaoVideo'
import type { DoubaoAccount } from './doubaoAccounts'

describe('doubao video response', () => {
  it('reads a video url from the common response shapes', () => {
    expect(readVideoUrl({ data: [{ url: 'https://example.com/a.mp4' }] })).toBe('https://example.com/a.mp4')
    expect(readVideoUrl({ video_url: 'https://example.com/b.mp4' })).toBe('https://example.com/b.mp4')
    expect(readVideoUrl({ data: [{ b64_json: 'AAAA' }] })).toBe('data:video/mp4;base64,AAAA')
    expect(readVideoUrl({ data: [] })).toBeNull()
    expect(readVideoUrl({ id: 'task-1', content: { video_url: 'https://cdn.example/v.mp4' } })).toBe('https://cdn.example/v.mp4')
    expect(readSeedanceTaskId({ data: { id: 'task-9' } })).toBe('task-9')
  })

  it('recognizes a used-up daily quota', () => {
    expect(isQuotaError(402, 'payment required')).toBe(true)
    expect(isQuotaError(400, '今日积分不足')).toBe(true)
    expect(isQuotaError(500, '服务暂时不可用')).toBe(false)
    expect(isQuotaError(429, 'too many requests')).toBe(true)
  })

  it('creates a Seedance task and waits until the video url appears', async () => {
    const responses = [
      { id: 'task-1', status: 'queued' },
      { id: 'task-1', status: 'running' },
      { id: 'task-1', status: 'succeeded', content: { video_url: 'https://cdn.example/done.mp4' } },
    ]
    const urls: string[] = []
    const url = await requestDoubaoVideo({
      baseUrl: 'https://ark.example/api/v3',
      account: { id: 'a', name: '豆包1', sessionId: 'key', dailyQuota: 5, usedToday: 0, quotaDate: '2026-09-22' } satisfies DoubaoAccount,
      prompt: '动作：推进',
      imageDataUrl: 'data:image/png;base64,AAAA',
      sleep: async () => {},
      now: () => 0,
      fetchImpl: (async (input: RequestInfo | URL) => {
        urls.push(String(input))
        const body = responses.shift()
        return new Response(JSON.stringify(body), { status: 200 })
      }) as typeof fetch,
    })
    expect(url).toBe('https://cdn.example/done.mp4')
    expect(urls[0]).toBe('https://ark.example/api/v3/contents/generations/tasks')
    expect(urls[1]).toBe('https://ark.example/api/v3/contents/generations/tasks/task-1')
  })
})