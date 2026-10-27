import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateWithAccountRotation, isQuotaError, readLocalVideoProgress, readSeedanceTaskId, readVideoUrl, requestDoubaoVideo } from './doubaoVideo'
import { quotaDate, readAccounts, writeAccounts } from './doubaoAccounts'
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

  it.each([undefined, '9:16'] as const)('creates a Seedance task with ratio %s and waits until the video url appears', async (ratio) => {
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
      duration: 9.2,
      ratio,
      imageDataUrl: 'data:image/png;base64,AAAA',
      sleep: async () => {},
      now: () => 0,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          expect(JSON.parse(String(init.body))).toMatchObject({ duration: 9.2, ratio: ratio ?? '16:9' })
        }
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

describe('豆包账户恢复与轮换', () => {
  beforeEach(() => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('版权拒绝保留原回复和对话地址，不丢失原因、不轮换账号、不扣本地额度', async () => {
    writeAccounts(['a', 'b'].map((id) => ({ id, name: id, sessionId: '', dailyQuota: 5, usedToday: 0, quotaDate: quotaDate() })))
    const refusal = {
      status: 'failed', failureReason: '版权限制', tracking: false,
      responseText: '抱歉，由于版权相关限制，暂时无法创作对应的内容，换其他主题试试吧。',
      taskUrl: 'https://www.doubao.com/chat/123', requestText: '原提示词',
    }
    expect(readLocalVideoProgress(refusal)).toMatchObject(refusal)
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(refusal)))
    const result = await generateWithAccountRotation({ accountId: 'a', baseUrl: 'https://api.test', prompt: '原提示词', imageDataUrl: 'data:image/png;base64,AA==', fetchImpl })
    expect(result).toMatchObject({ status: 'failed', failureReason: refusal.failureReason, responseText: refusal.responseText, taskUrl: refusal.taskUrl, requestText: refusal.requestText, url: '', accountName: 'a' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(readAccounts().map((account) => account.usedToday)).toEqual([0, 0])
  })

  it.each([false, true])('区分未添加账户和已有账户额度耗尽（已保存=%s）', async (hasAccount) => {
    if (hasAccount) writeAccounts([{ id: 'a', name: '账户', sessionId: '', dailyQuota: 5, usedToday: 5, quotaDate: quotaDate() }])
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(generateWithAccountRotation({
      baseUrl: 'https://api.test', prompt: '推进', imageDataUrl: 'data:image/png;base64,AA==', fetchImpl,
    })).rejects.toMatchObject({
      message: hasAccount ? '豆包账户今日额度已用完，请明日再试或添加其他账户' : '尚未添加豆包账户，请先添加并扫码登录',
      code: 'DOUBAO_NO_ACCOUNTS',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['exhausted', 'removed', 'yesterday'])('重试优先使用原账户，原账户不可用时切换，跨日恢复额度（%s）', async (state) => {
    writeAccounts([
      ...(state === 'removed' ? [] : [{ id: 'original', name: '原账户', sessionId: '', dailyQuota: 5, usedToday: 5, quotaDate: state === 'yesterday' ? '2000-01-01' : quotaDate() }]),
      { id: 'other', name: '其他账户', sessionId: '', dailyQuota: 5, usedToday: 0, quotaDate: quotaDate() },
    ])
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', url: 'https://cdn.test/video.mp4' })))
    const selected = vi.fn()
    await generateWithAccountRotation({
      accountId: 'original', baseUrl: 'https://api.test', prompt: '推进', imageDataUrl: 'data:image/png;base64,AA==', fetchImpl, onAccountSelected: selected,
    })
    const expected = state === 'yesterday' ? 'original' : 'other'
    expect(selected).toHaveBeenCalledExactlyOnceWith(expected)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).accountId).toBe(expected)
    expect(readAccounts().find((account) => account.id === expected)?.usedToday).toBe(1)
  })
})
