// 选题台的运行状态：放在模块里而不是组件里，切到生图再生回来时不会丢掉搜索中的结果
import { useSyncExternalStore } from 'react'
import { callTopicResearchApi } from './agentApi'
import { getTextApiProfile } from './apiProfiles'
import { buildTopicResearchInput, groundTopicResearchResult, parseTopicResearchResult, type TopicIdea } from './topicResearch'
import type { AppSettings } from '../types'

const KEY = 'hudi-topic-desk'

export type TopicDeskState = {
  topics: TopicIdea[]
  note: string
  query: string
  platforms: string[]
  running: boolean
  error: string
  /** 上一次是否真的联网搜过，用来提示热度线索为什么是空的 */
  searched: boolean
  updatedAt: number
}

const EMPTY: TopicDeskState = { topics: [], note: '', query: '', platforms: [], running: false, error: '', searched: true, updatedAt: 0 }

function readStored(): TopicDeskState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const data = JSON.parse(raw) as Partial<TopicDeskState>
    return {
      ...EMPTY,
      topics: Array.isArray(data.topics) ? data.topics : [],
      note: typeof data.note === 'string' ? data.note : '',
      query: typeof data.query === 'string' ? data.query : '',
      platforms: Array.isArray(data.platforms) ? data.platforms.filter((item): item is string => typeof item === 'string') : [],
      searched: data.searched !== false,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    }
  } catch {
    return EMPTY
  }
}

let state: TopicDeskState = readStored()
let controller: AbortController | null = null
const listeners = new Set<() => void>()

function setState(patch: Partial<TopicDeskState>) {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify({ topics: state.topics, note: state.note, query: state.query, platforms: state.platforms, searched: state.searched, updatedAt: state.updatedAt }))
  } catch {
    // 隐私模式下写不进去，当前页面里的选题仍然可用
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTopicDesk() {
  return useSyncExternalStore(subscribe, () => state)
}

/** 跑一次选题；返回拿到的条数，0 表示失败或被取消（错误已经写进 state） */
export async function runTopicResearch(opts: { settings: AppSettings; query: string; platforms: string[]; count: number }) {
  if (state.running) return 0

  const profile = getTextApiProfile(opts.settings)
  if (!profile) {
    setState({ error: '还没有可用的生文模型，先在设置 → 生文配置里填好接口' })
    return 0
  }
  if (!profile.baseUrl.trim() || !profile.model.trim() || !profile.apiKey.trim()) {
    setState({ error: '当前 Agent 文本模型缺少接口地址、模型名或密钥，先去设置里补全' })
    return 0
  }

  const local = new AbortController()
  controller = local
  setState({ running: true, error: '', query: opts.query, platforms: opts.platforms })
  try {
    const research = await callTopicResearchApi({
      profile,
      input: buildTopicResearchInput(opts.query, opts.platforms, opts.count),
      platforms: opts.platforms,
      signal: local.signal,
    })
    const parsed = parseTopicResearchResult(research.text)
    const result = research.trends ? groundTopicResearchResult(parsed, research.trends, opts.count) : parsed
    setState({ topics: result.topics, note: [research.notice, result.note].filter(Boolean).join(' '), searched: research.searched, updatedAt: Date.now(), running: false })
    return result.topics.length
  } catch (error) {
    setState({
      running: false,
      error: local.signal.aborted ? '已取消本次选题' : error instanceof Error ? error.message : '选题失败，请重试',
    })
    return 0
  } finally {
    if (controller === local) controller = null
  }
}

export function cancelTopicResearch() {
  controller?.abort()
}

export function removeTopic(index: number) {
  setState({ topics: state.topics.filter((_, idx) => idx !== index) })
}

export function clearTopics() {
  setState({ topics: [], note: '', error: '', searched: true, updatedAt: 0 })
}
