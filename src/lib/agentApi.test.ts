import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS } from './apiProfiles'
import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle, callTopicResearchApi, parseBatchImageCallArguments } from './agentApi'
import { fetchTopicTrends } from './topicTrends'

vi.mock('./topicTrends', () => ({ fetchTopicTrends: vi.fn() }))

describe('parseBatchImageCallArguments', () => {
  it('trims ids and prompts, fills missing ids, and skips empty prompts', () => {
    expect(parseBatchImageCallArguments(JSON.stringify({ images: [
      { id: ' hero ', prompt: ' first prompt ' },
      { id: '   ', prompt: 'blank id' },
      { prompt: 'missing id' },
      { id: 'skipped', prompt: '   ' },
    ] }))).toEqual([
      { id: 'hero', prompt: 'first prompt' },
      { id: 'image_2', prompt: 'blank id' },
      { id: 'image_3', prompt: 'missing id' },
    ])
  })

  it('makes duplicate and colliding ids deterministically unique', () => {
    const args = JSON.stringify({ images: [
      { id: 'same', prompt: 'one' },
      { id: ' same ', prompt: 'two' },
      { id: 'same_2', prompt: 'three' },
      { id: 'same', prompt: 'four' },
    ] })

    expect(parseBatchImageCallArguments(args)).toEqual([
      { id: 'same', prompt: 'one' },
      { id: 'same_2', prompt: 'two' },
      { id: 'same_2_2', prompt: 'three' },
      { id: 'same_3', prompt: 'four' },
    ])
    expect(parseBatchImageCallArguments(args)).toEqual(parseBatchImageCallArguments(args))
  })
})

describe('callTopicResearchApi', () => {
  beforeEach(() => {
    vi.mocked(fetchTopicTrends).mockReset().mockResolvedValue({
      items: [{ title: '钠电池上车', platform: '抖音', heat: '抖音热榜第 12 位', source: 'https://www.douyin.com/search/test' }],
      unavailable: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('中转不认 web_search 时独立取热榜，再用原模型筛选', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unknown tool type: web_search' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'resp_topic',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"note":"没联网","topics":[]}' }] }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await callTopicResearchApi({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }),
      input: '方向：不限',
    })

    expect(result.searched).toBe(true)
    expect(result.trends?.[0].title).toBe('钠电池上车')
    expect(result.text).toContain('topics')
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstBody.tools).toEqual([{ type: 'web_search' }])
    expect(secondBody.tools).toBeUndefined()
    expect(secondBody.input[0].content[0].text).toContain('钠电池上车')
    expect(secondBody.instructions).toContain('不需要调用联网工具')
  })

  it('识别 web_search_call 输出项，说明这次真的搜过', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_topic',
      output: [
        { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search' } },
        { type: 'message', content: [{ type: 'output_text', text: '{"topics":[]}' }] },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await callTopicResearchApi({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses' }),
      input: '方向：不限',
    })

    expect(result.searched).toBe(true)
    expect(fetchTopicTrends).not.toHaveBeenCalled()
  })

  it('DeepSeek v4.1 直接筛选热榜，不强塞 web_search 或切换模型', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"topics":[]}' }] }],
    })))
    const profile = createDefaultOpenAIProfile({ baseUrl: 'https://text.example/v1', apiKey: 'text-key', model: 'cn:deepseek-v4.1-flash' })
    await callTopicResearchApi({ profile, input: '方向：电池', platforms: ['抖音'] })

    expect(fetchTopicTrends).toHaveBeenCalledWith(['抖音'], expect.any(AbortSignal))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://text.example/v1/responses')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ Authorization: 'Bearer text-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'cn:deepseek-v4.1-flash' })
    expect(JSON.parse(String(init.body)).tools).toBeUndefined()
  })

  it('Responses 不可用时兼容 DeepSeek Chat Completions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"topics":[]}' } }] })))
    const result = await callTopicResearchApi({ profile: createDefaultOpenAIProfile({ model: 'deepseek-v4.1' }), input: '方向：不限' })

    expect(result.text).toBe('{"topics":[]}')
    expect(fetchMock.mock.calls[1][0]).toContain('/chat/completions')
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(body.model).toBe('deepseek-v4.1')
    expect(body.messages[1].content).toContain('钠电池上车')
    expect(body.tools).toBeUndefined()
  })

  it('有搜索输出但状态失败时仍取独立热榜，并保留缺失平台提示', async () => {
    vi.mocked(fetchTopicTrends).mockResolvedValue({
      items: [{ title: '钠电池上车', platform: '抖音', heat: '抖音热榜第 12 位', source: '' }],
      unavailable: ['B站'],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ type: 'web_search_call', status: 'failed' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"topics":[]}' }] }] })))
    const result = await callTopicResearchApi({ profile: createDefaultOpenAIProfile(), input: '方向：不限' })

    expect(fetchTopicTrends).toHaveBeenCalledTimes(1)
    expect(result.notice).toContain('B站暂时取数失败')
  })

  it('全部热榜失败时停止，不请求模型生成虚构热点', async () => {
    vi.mocked(fetchTopicTrends).mockResolvedValue({ items: [], unavailable: ['抖音'] })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(callTopicResearchApi({ profile: createDefaultOpenAIProfile({ model: 'deepseek-v4.1' }), input: '方向：不限' })).rejects.toThrow('未能获取抖音的实时热榜')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('取消后不再取热榜或请求模型', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(callTopicResearchApi({ profile: createDefaultOpenAIProfile({ model: 'deepseek-v4.1' }), input: '', signal: controller.signal })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fetchTopicTrends).not.toHaveBeenCalled()
  })
})

describe('callBatchImageSingle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the image tool error without a misleading streaming hint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Tool choice 'required' must be specified with 'tools' parameter." },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }))

    const result = await callBatchImageSingle({
      profile: createDefaultOpenAIProfile({ apiKey: 'test-key', apiMode: 'responses', streamImages: true }),
      params: DEFAULT_PARAMS,
      batchItemId: 'image_1',
      prompt: 'prompt',
      referenceImageDataUrls: [],
    })

    expect(result).toMatchObject({
      batchItemId: 'image_1',
      image: null,
      error: "Tool choice 'required' must be specified with 'tools' parameter.\n提示：当前使用的 API 可能未正确转发图像生成工具，请尝试更换支持该工具的接口或模型。",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('callAgentResponsesApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams Agent text and requests configured partial images', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]},{"type":"image_generation_call","id":"ig_1","result":"ZmluYWw=","size":"1024x1024"}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      streamPartialImages: 2,
      reasoningEffort: 'xhigh',
      imageGenerationModel: 'gpt-image-2.5-flare',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onTextDelta: (delta) => textDeltas.push(delta),
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.stream).toBe(true)
    expect(body.reasoning).toEqual({ effort: 'xhigh' })
    expect(body.tools[0].model).toBe('gpt-image-2.5-flare')
    expect(body.tools[0].partial_images).toBe(2)
    expect(textDeltas).toEqual(['Hel', 'lo'])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: 'Hello',
      images: [{ toolCallId: 'ig_1', dataUrl: 'data:image/png;base64,ZmluYWw=' }],
    })
  })

  it('reports failed image output item without aborting the ongoing stream', async () => {
    const streamBody = [
      'data: {"type":"response.output_item.added","item":{"id":"ig_fail","type":"image_generation_call","status":"in_progress"},"output_index":0}',
      '',
      'data: {"type":"response.output_item.done","item":{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},"output_index":0}',
      '',
      'data: {"type":"response.output_text.delta","delta":"已跳过失败图片"}',
      '',
      'data: {"type":"response.completed","response":{"id":"resp_1","output":[{"id":"ig_fail","type":"image_generation_call","status":"failed","error":{"message":"safety rejected"}},{"type":"message","content":[{"type":"output_text","text":"已跳过失败图片"}]}]}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const failures: Array<{ toolCallId: string; error: string }> = []
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      onImageToolFailed: (event) => {
        failures.push(event)
      },
    })

    expect(failures).toEqual([{ toolCallId: 'ig_fail', error: 'safety rejected' }])
    expect(result).toMatchObject({
      responseId: 'resp_1',
      text: '已跳过失败图片',
      images: [],
    })
    expect(result.rawResponsePayload).toContain('resp_1')
  })

  it('passes mask data to the Agent image tool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'edit' }] }],
      maskDataUrl: 'data:image/png;base64,bWFzaw==',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].input_image_mask).toEqual({ image_url: 'data:image/png;base64,bWFzaw==' })
  })

  it('requires resolution in Agent prompts and omits the Codex CLI size parameter', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      codexCli: true,
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: { ...DEFAULT_PARAMS, size: '1024x1024' },
      input: 'prompt',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools[0].size).toBeUndefined()
    expect(body.instructions).toContain('Start every image prompt with exactly "Generate at 1024x1024 resolution." followed by a space.')
  })

  it('extracts image_generation results from base64 object fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'image_generation_call',
        id: 'ig_base64',
        result: { base64: 'ZmlsZQ==' },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    expect(result.images).toEqual([{
      toolCallId: 'ig_base64',
      dataUrl: 'data:image/png;base64,ZmlsZQ==',
      actualParams: {},
    }])
  })

  it('stops reading a stream when the caller aborts after output starts', async () => {
    const streamBody = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      '',
    ].join('\n')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamBody))
        controller.close()
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const textDeltas: string[] = []
    const abortController = new AbortController()
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
    })

    await expect(callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
      signal: abortController.signal,
      onTextDelta: (delta) => {
        textDeltas.push(delta)
        abortController.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(textDeltas).toEqual(['Hel'])
  })

  it('generates a short conversation title without image tools', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '<title>生成猫咪头像</title>' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
      streamImages: true,
      reasoningEffort: 'max',
    })

    const title = await callAgentConversationTitleApi({
      settings: DEFAULT_SETTINGS,
      profile,
      prompt: '帮我生成一张橘猫头像，要赛博朋克风格',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.instructions).toContain('<title>short title</title>')
    expect(body.reasoning).toEqual({ effort: 'max' })
    expect(body.max_output_tokens).toBeUndefined()
    expect(body.tools).toBeUndefined()
    expect(body.stream).toBeUndefined()
    expect(body.input[0].content[0].text).toContain('帮我生成一张橘猫头像，要赛博朋克风格')
    expect(title).toBe('生成猫咪头像')
  })

  it('requests web search and applies citations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      id: 'resp_search',
      output: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'OpenAI web search docs' },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'See OpenAI docs.',
            annotations: [{
              type: 'url_citation',
              start_index: 4,
              end_index: 15,
              url: 'https://platform.openai.com/docs',
              title: 'OpenAI Docs',
            }],
          }],
        },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    const result = await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentWebSearch: true },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.tools).toEqual(expect.arrayContaining([{ type: 'web_search' }]))
    expect(result.text).toBe('See [OpenAI docs](https://platform.openai.com/docs).')
    expect(result.outputItems?.[0]).toMatchObject({ type: 'web_search_call', status: 'completed' })
  })

  it('injects configurable math formatting instructions', async () => {
    const createResponse = () => new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'OK' }],
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => createResponse())
    const profile = createDefaultOpenAIProfile({
      apiKey: 'test-key',
      apiMode: 'responses',
    })

    await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    let body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.instructions).toContain('## Math formatting')
    expect(body.instructions).toContain('Use `$...$` for inline formulas.')

    await callAgentResponsesApi({
      settings: { ...DEFAULT_SETTINGS, agentMathFormattingPrompt: false },
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'prompt' }] }],
    })

    body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.instructions).not.toContain('## Math formatting')
  })

  it("does not duplicate the assistant message item when response.completed lacks an item id", async () => {
    // `response.completed` can repeat the streamed item without id; it should merge, not append.
    const itemId = "msg_abc123"
    const streamBody = [
      `data: {"type":"response.created","response":{"id":"resp_1","output":[]}}`,
      ``,
      `data: {"type":"response.output_item.added","item":{"id":"${itemId}","type":"message","status":"in_progress","content":[],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"hi","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_text.delta","delta":"!","item_id":"${itemId}"}`,
      ``,
      `data: {"type":"response.output_item.done","item":{"id":"${itemId}","type":"message","status":"completed","content":[{"type":"output_text","text":"hi!"}],"role":"assistant"}}`,
      ``,
      `data: {"type":"response.completed","response":{"id":"resp_1","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi!"}]}]}}`,
      ``,
      `data: [DONE]`,
      ``,
    ].join("\n")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }))
    const outputItemSnapshots: number[] = []
    const profile = createDefaultOpenAIProfile({
      apiKey: "test-key",
      apiMode: "responses",
      streamImages: true,
    })

    const result = await callAgentResponsesApi({
      settings: DEFAULT_SETTINGS,
      profile,
      params: DEFAULT_PARAMS,
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      onOutputItems: (items) => outputItemSnapshots.push(items.length),
    })

    const messageItems = (result.outputItems ?? []).filter((item) => item.type === "message")
    expect(messageItems).toHaveLength(1)
    expect(result.text).toBe("hi!")
    expect(outputItemSnapshots[outputItemSnapshots.length - 1]).toBe(1)
  })
})
