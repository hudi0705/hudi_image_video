import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchProviderModelIds, parseModelIds } from './modelList'

describe('parseModelIds', () => {
  it('reads OpenAI style data arrays and drops empty ids', () => {
    const payload = { object: 'list', data: [{ id: 'gpt-5' }, { id: ' gpt-4.1 ' }, { id: '' }, null] }

    expect(parseModelIds(payload)).toEqual(['gpt-5', 'gpt-4.1'])
  })

  it('accepts models arrays, plain string arrays and bare arrays', () => {
    expect(parseModelIds({ models: [{ model: 'qwen-max' }, { name: 'deepseek-chat' }] })).toEqual(['qwen-max', 'deepseek-chat'])
    expect(parseModelIds(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  it('returns an empty list for unexpected payloads', () => {
    expect(parseModelIds(null)).toEqual([])
    expect(parseModelIds({ error: 'nope' })).toEqual([])
    expect(parseModelIds('gpt-5')).toEqual([])
  })
})

describe('fetchProviderModelIds', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests /v1/models with a bearer token and parses the response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchProviderModelIds({ baseUrl: 'https://api.example.com', apiKey: 'sk-1' })).resolves.toEqual(['gpt-5'])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1')
  })

  it('surfaces the provider error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 })))

    await expect(fetchProviderModelIds({ baseUrl: 'https://api.example.com/v1', apiKey: '' })).rejects.toThrow('invalid key')
  })

  it('turns a network failure into a readable hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    await expect(fetchProviderModelIds({ baseUrl: 'https://api.example.com', apiKey: 'sk-1' })).rejects.toThrow('无法连接该接口')
  })
})
