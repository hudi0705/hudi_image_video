import { TOPIC_PLATFORMS, type TopicPlatform } from './topicResearch'
import { throwIfAborted } from './serverSentEvents'

export type TopicTrend = {
  title: string
  platform: TopicPlatform
  heat: string
  source: string
}

const ENDPOINTS: Record<TopicPlatform, string> = {
  抖音: 'douyin',
  小红书: 'rednote',
  B站: 'bili',
}

/** 公开热榜独立于模型获取，DeepSeek 等没有内置搜索的模型也能筛选真实词条。 */
export async function fetchTopicTrends(platforms: readonly string[], signal?: AbortSignal) {
  throwIfAborted(signal)
  const selected = TOPIC_PLATFORMS.filter((platform) => platforms.includes(platform))
  const results = await Promise.allSettled(selected.map(async (platform) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`https://60s.viki.moe/v2/${ENDPOINTS[platform]}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.code !== 200 || !Array.isArray(payload.data)) throw new Error('热榜返回格式无效')
      const items: TopicTrend[] = []
      for (const [index, value] of payload.data.slice(0, 50).entries()) {
        if (!value || typeof value !== 'object' || typeof value.title !== 'string' || !value.title.trim()) continue
        const rank = Number.isInteger(value.rank) && value.rank > 0 ? value.rank : index + 1
        const score = value.hot_value ?? value.score
        const heat = typeof score === 'number' && Number.isFinite(score) && score > 0
          ? String(score)
          : typeof score === 'string' ? score.trim() : ''
        const source = typeof value.link === 'string' && /^https?:\/\//i.test(value.link) ? value.link : ''
        items.push({ title: value.title.trim(), platform, heat: `${platform}热榜第 ${rank} 位${heat ? ` · 热度 ${heat}` : ''}`, source })
      }
      if (!items.length) throw new Error('热榜没有可用词条')
      return items
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }))
  throwIfAborted(signal)
  const items: TopicTrend[] = []
  const unavailable: TopicPlatform[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') items.push(...result.value)
    else unavailable.push(selected[index])
  })
  return { items, unavailable }
}
