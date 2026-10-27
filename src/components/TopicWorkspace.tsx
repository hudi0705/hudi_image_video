import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { getTextApiProfile } from '../lib/apiProfiles'
import { copyTextToClipboard } from '../lib/clipboard'
import { setWorkMode } from '../lib/workMode'
import { TOPIC_PLATFORMS, type TopicIdea } from '../lib/topicResearch'
import { cancelTopicResearch, clearTopics, removeTopic, runTopicResearch, useTopicDesk } from '../lib/topicDesk'

const PLATFORM_DOT: Record<string, string> = {
  抖音: 'bg-gray-900 dark:bg-gray-100',
  小红书: 'bg-[#ff2e4d]',
  B站: 'bg-[#00aeec]',
}

const COUNT_OPTIONS = [6, 9, 12]

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40'

function formatUpdatedAt(ts: number) {
  const date = new Date(ts)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type TopicRowProps = {
  topic: TopicIdea
  rank: number
  onUse: () => void
  onCopy: () => void
  onRemove: () => void
}

function TopicRow({ topic, rank, onUse, onCopy, onRemove }: TopicRowProps) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 border-b border-gray-100 px-4 py-4 transition-colors last:border-0 hover:bg-gray-50/80 dark:border-white/[0.06] dark:hover:bg-white/[0.03] sm:gap-4">
      <span className="pt-0.5 text-right font-mono text-sm tabular-nums text-gray-300 dark:text-gray-600">{rank}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="text-[15px] font-semibold leading-6 text-gray-900 dark:text-gray-100">{topic.title}</h4>
          {topic.platforms.map((platform) => (
            <span
              key={platform}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.08] dark:text-gray-300"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT[platform] ?? 'bg-gray-400'}`} />
              {platform}
            </span>
          ))}
          {topic.heat && <span className="text-[11px] text-gray-400">{topic.heat}</span>}
        </div>
        {topic.angle && <p className="mt-1.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{topic.angle}</p>}
        {topic.reason && <p className="mt-1 text-xs leading-relaxed text-gray-400">{topic.reason}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="flex items-end gap-[3px]" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((step) => (
                <span
                  key={step}
                  style={{ height: `${4 + step * 2}px` }}
                  className={`w-[3px] rounded-full ${step <= topic.fit ? 'bg-blue-500 dark:bg-blue-400' : 'bg-gray-200 dark:bg-white/10'}`}
                />
              ))}
            </span>
            <span className="text-[11px] text-gray-400">适配 {topic.fit}/5</span>
          </span>
          <span className="hidden h-3 w-px bg-gray-200 dark:bg-white/10 sm:block" />
          <button
            type="button"
            onClick={onUse}
            className={`rounded-md px-1.5 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 ${FOCUS_RING}`}
          >
            去做图
          </button>
          <button
            type="button"
            onClick={onCopy}
            className={`rounded-md px-1.5 py-0.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 ${FOCUS_RING}`}
          >
            复制
          </button>
          <button
            type="button"
            onClick={onRemove}
            className={`rounded-md px-1.5 py-0.5 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 ${FOCUS_RING}`}
          >
            移除
          </button>
          {topic.source && (
            <a
              href={topic.source}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs text-gray-400 underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-700 dark:decoration-gray-600 dark:hover:text-gray-200 ${FOCUS_RING}`}
            >
              来源
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

export default function TopicWorkspace() {
  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setPrompt = useStore((s) => s.setPrompt)
  const showToast = useStore((s) => s.showToast)
  const desk = useTopicDesk()
  const textProfile = useMemo(() => getTextApiProfile(settings), [settings])

  const [query, setQuery] = useState(desk.query)
  const [platforms, setPlatforms] = useState<string[]>(desk.platforms.length > 0 ? desk.platforms : [...TOPIC_PLATFORMS])
  const [count, setCount] = useState(6)
  const [onlyTopFit, setOnlyTopFit] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!desk.running) return
    const startedAt = Date.now()
    setElapsed(0)
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [desk.running])

  const topics = onlyTopFit ? desk.topics.filter((topic) => topic.fit >= 4) : desk.topics

  const togglePlatform = (platform: string) => {
    setPlatforms((prev) => (prev.includes(platform) ? prev.filter((item) => item !== platform) : [...prev, platform]))
  }

  const start = () => {
    if (platforms.length === 0) {
      showToast('先选一个平台', 'error')
      return
    }
    void runTopicResearch({ settings, query, platforms, count })
  }

  const useTopicForImage = (topic: TopicIdea) => {
    const detail = topic.angle ? `，用来解释：${topic.angle}` : ''
    setPrompt(`以「${topic.title}」为主题，画一张 Vox 风格科普配图${detail}`)
    setWorkMode('image')
    showToast('已带入生图提示词', 'success')
  }

  const copyTopic = async (topic: TopicIdea) => {
    try {
      await copyTextToClipboard([topic.title, topic.heat, topic.angle].filter(Boolean).join('\n'))
      showToast('已复制词条', 'success')
    } catch {
      showToast('复制失败，请手动选中复制', 'error')
    }
  }

  return (
    <main className="safe-area-x mx-auto max-w-7xl pb-24">
      <section className="pt-14 sm:pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[22px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">选题台</h2>
          <p className="text-xs text-gray-400">
            {desk.updatedAt ? `上次更新 ${formatUpdatedAt(desk.updatedAt)} · ${desk.topics.length} 条候选` : '还没有选题记录'}
          </p>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          获取抖音、小红书、B站的热门词条，由你配置的生文模型筛出能讲清机制、能拍出来的 Vox 科普选题。
        </p>
      </section>

      <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
        <label htmlFor="topic-query" className="text-xs font-medium text-gray-500 dark:text-gray-400">方向</label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="topic-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !desk.running) start()
            }}
            placeholder="可留空，例如：为什么大家突然都在算每天的热量"
            className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-white/[0.06]"
          />
          <button
            type="button"
            onClick={desk.running ? cancelTopicResearch : start}
            disabled={!desk.running && platforms.length === 0}
            className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${desk.running
              ? 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.06]'
              : 'bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'} ${FOCUS_RING}`}
          >
            {desk.running ? '取消' : desk.topics.length > 0 ? '重新选题' : '开始选题'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5" role="group" aria-label="平台">
            {TOPIC_PLATFORMS.map((platform) => {
              const active = platforms.includes(platform)
              return (
                <button
                  key={platform}
                  type="button"
                  aria-pressed={active}
                  onClick={() => togglePlatform(platform)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors ${active
                    ? 'border-gray-300 bg-white font-medium text-gray-900 shadow-sm dark:border-white/[0.18] dark:bg-white/[0.08] dark:text-white'
                    : 'border-transparent text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'} ${FOCUS_RING}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full transition-opacity ${PLATFORM_DOT[platform]} ${active ? '' : 'opacity-40'}`} />
                  {platform}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="条数">
            <span className="mr-0.5 text-xs text-gray-400">条数</span>
            {COUNT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={count === option}
                onClick={() => setCount(option)}
                className={`rounded-md px-2 py-1 font-mono text-xs tabular-nums transition-colors ${count === option
                  ? 'bg-gray-100 font-medium text-gray-900 dark:bg-white/10 dark:text-white'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'} ${FOCUS_RING}`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {desk.running && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-blue-50/70 px-3 py-2 text-[13px] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
            <span className="min-w-0 flex-1">正在搜 {platforms.join('、')} 的热门词条，筛完自动出结果</span>
            <span className="shrink-0 font-mono text-xs tabular-nums opacity-70">{elapsed}s</span>
          </div>
        )}

        {!desk.running && desk.error && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-600 dark:bg-red-500/10 dark:text-red-300">
            <span className="min-w-0 flex-1">{desk.error}</span>
            <button
              type="button"
              onClick={() => setShowSettings(true, 'text')}
              className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium underline decoration-red-300 underline-offset-2 hover:bg-red-100/70 dark:hover:bg-red-500/15 ${FOCUS_RING}`}
            >
              去设置
            </button>
          </div>
        )}

        <p className="mt-2 text-[11px] text-gray-400">
          使用生文模型：{textProfile.model}
        </p>
      </section>

      <section className="mt-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">候选选题</h3>
            <span className="font-mono text-xs tabular-nums text-gray-400">{topics.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {[
              { key: false, label: '全部' },
              { key: true, label: '只看高适配' },
            ].map((item) => (
              <button
                key={String(item.key)}
                type="button"
                aria-pressed={onlyTopFit === item.key}
                onClick={() => setOnlyTopFit(item.key)}
                className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${onlyTopFit === item.key
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'} ${FOCUS_RING}`}
              >
                {item.label}
              </button>
            ))}
            {desk.topics.length > 0 && (
              <button
                type="button"
                onClick={clearTopics}
                className={`ml-1 rounded-lg px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 ${FOCUS_RING}`}
              >
                清空
              </button>
            )}
          </div>
        </div>

        {desk.note && <p className="mt-1.5 text-xs leading-relaxed text-gray-400">{desk.note}</p>}

        {!desk.running && desk.updatedAt > 0 && !desk.searched && (
          <p className="mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
            上次未取得可核验的实时热榜。请重新选题，应用会获取热榜后交给你配置的生文模型筛选。
          </p>
        )}

        {topics.length > 0 ? (
          <ol className="mt-3 animate-fade-in overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]">
            {topics.map((topic, index) => (
              <TopicRow
                key={`${topic.title}-${index}`}
                topic={topic}
                rank={index + 1}
                onUse={() => useTopicForImage(topic)}
                onCopy={() => { void copyTopic(topic) }}
                onRemove={() => removeTopic(desk.topics.indexOf(topic))}
              />
            ))}
          </ol>
        ) : desk.running ? null : desk.topics.length > 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400 dark:border-white/[0.08]">
            这一批没有到 4 分的词条，切回「全部」看看，或者换个方向重新选题。
          </p>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-gray-200 px-5 py-10 text-center dark:border-white/[0.08]">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">还没有候选选题</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-gray-400">
              选好平台后点「开始选题」。获取所选平台的热榜后，模型会按「有机制、有画面、有时效」筛选科普选题。
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
