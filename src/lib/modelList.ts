import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from './devProxy'
import { getApiErrorMessage } from './imageApiShared'

/** 兼容 OpenAI 的 { data: [...] }、{ models: [...] } 与直接数组三种模型列表形态 */
export function parseModelIds(payload: unknown): string[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).data ?? (payload as Record<string, unknown>).models
      : null
  if (!Array.isArray(list)) return []

  const ids = list.map((item) => {
    if (typeof item === 'string') return item.trim()
    if (!item || typeof item !== 'object') return ''
    const record = item as Record<string, unknown>
    const id = record.id ?? record.name ?? record.model
    return typeof id === 'string' ? id.trim() : ''
  })
  return Array.from(new Set(ids.filter(Boolean)))
}

const MODEL_LIST_TIMEOUT_MS = 20000

/** 拉取 OpenAI 兼容接口的 /v1/models 列表；网络错误和超时都转成可直接展示的提示 */
export async function fetchProviderModelIds(opts: {
  baseUrl: string
  apiKey: string
  apiProxy?: boolean
}): Promise<string[]> {
  const proxyConfig = readClientDevProxyConfig()
  const useApiProxy = shouldUseApiProxy(Boolean(opts.apiProxy), proxyConfig)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS)
  const apiKey = opts.apiKey.trim()

  try {
    const response = await fetch(buildApiUrl(opts.baseUrl, 'models', proxyConfig, useApiProxy), {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`拉取失败：${await getApiErrorMessage(response)}`)
    return parseModelIds(await response.json())
  } catch (err) {
    if (controller.signal.aborted) throw new Error('拉取模型超时，请检查 API URL 是否可访问')
    if (err instanceof TypeError) throw new Error('无法连接该接口，可能是地址不可达或服务商未放开跨域')
    if (err instanceof SyntaxError) throw new Error('接口返回的内容不是有效的 JSON')
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
