export function taskUrlFromCandidates(candidates, initialUrl) {
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, initialUrl)
      if (url.protocol !== 'https:' || url.hostname !== new URL(initialUrl).hostname) continue
      // 当前豆包历史记录使用数字对话 ID；生成任务 ID 不是对话 ID。
      if (url.username || url.password || url.port) continue
      const conversationPath = url.pathname.match(/^\/chat\/(\d+)\/?$/)
      if (conversationPath && /[1-9]/.test(conversationPath[1])) return `${url.origin}/chat/${conversationPath[1]}`
      if (/^\/chat(?:\/create-video)?\/?$/.test(url.pathname)) {
        const key = ['conversation_id', 'conversationId', 'chat_id'].find((key) => /^[1-9]\d*$/.test(url.searchParams.get(key) || ''))
        // 保留已观察到的参数路由形式，去掉无关追踪参数和 hash。
        if (key) return `${url.origin}${url.pathname.replace(/\/$/, '')}?${key}=${url.searchParams.get(key)}`
      }
    } catch {}
  }
  return ''
}
