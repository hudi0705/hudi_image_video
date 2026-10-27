import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTopicTrends } from './topicTrends'

afterEach(() => vi.restoreAllMocks())

describe('fetchTopicTrends', () => {
  it('只取选中平台，使用真实榜位、热度和来源，忽略无效词条', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [
      { title: '  钠电池上车 ', rank: 12, score: '947.5w', link: 'https://www.xiaohongshu.com/search_result?keyword=test' },
      { title: '   ' }, null,
      { title: '海鸥雨', link: 'javascript:alert(1)' },
    ] })))
    const result = await fetchTopicTrends(['小红书'])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://60s.viki.moe/v2/rednote')
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined()
    expect(result.items).toEqual([
      { title: '钠电池上车', platform: '小红书', heat: '小红书热榜第 12 位 · 热度 947.5w', source: 'https://www.xiaohongshu.com/search_result?keyword=test' },
      { title: '海鸥雨', platform: '小红书', heat: '小红书热榜第 4 位', source: '' },
    ])
    expect(result.unavailable).toEqual([])
  })

  it('单平台失败不丢掉其他平台的数据，并明确报告缺失平台', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: [{ title: '内存价格倒挂', hot_value: 12164037 }] })))
      .mockResolvedValueOnce(new Response('upstream error', { status: 500 }))
    const result = await fetchTopicTrends(['抖音', 'B站'])

    expect(result.items[0].heat).toBe('抖音热榜第 1 位 · 热度 12164037')
    expect(result.unavailable).toEqual(['B站'])
  })

  it('HTTP 成功但业务失败或空榜单不算取数成功', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 500, data: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 200, data: [] })))
    expect(await fetchTopicTrends(['抖音', '小红书'])).toEqual({ items: [], unavailable: ['抖音', '小红书'] })
  })

  it('取消会中断所有平台请求，不把取消伪装成平台取数失败', async () => {
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const result = fetchTopicTrends(['抖音', 'B站'], controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow()
    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})
