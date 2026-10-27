import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { callPromptPolicyReviewApi } from '../lib/agentApi'
import { getTextApiProfile } from '../lib/apiProfiles'
import { copyTextToClipboard } from '../lib/clipboard'
import {
  applyRewrite,
  parsePolicyReviewResult,
  type PolicyReviewItem,
  type PolicyReviewResult,
  type PolicyReviewRisk,
} from '../lib/promptPolicyAiCheck'
import {
  checkReferenceImages,
  checkText,
  splitByHits,
  POLICY_SETS,
  type CheckResult,
  type PolicySet,
} from '../lib/promptPolicyCheck'
import type { AppSettings } from '../types'
import { SeverityTag } from './policyCheckTags'

interface PromptPolicyModalProps {
  prompt: string
  referenceCount: number
  /** AI 深度检查需要的全局设置；缺失时 AI 按钮置灰 */
  settings?: AppSettings
  onClose: () => void
}

function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M12 3l7 3v5.5c0 4.5-3 7.6-7 9.5-4-1.9-7-5-7-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </svg>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

/** 规则引擎读不到图片内容，只能就「有没有参考图」给出人脸相关提醒，所以独立于文本命中结果展示 */
function ImageRiskBlock({ hint }: { hint: string }) {
  return (
    <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/[0.08]">
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="text-[12.5px] font-medium text-amber-800 dark:text-amber-200">参考图风险</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">{hint}</p>
      </div>
    </div>
  )
}

/** 结果以「命中高亮 + 逐条解释」呈现，用户可以照着建议直接改提示词 */
function ResultPanel({ result, prompt, setId, referenceCount }: { result: CheckResult; prompt: string; setId: PolicySet['id']; referenceCount: number }) {
  const parts = useMemo(() => splitByHits(prompt, result.hits), [prompt, result.hits])
  const imageRisk = checkReferenceImages(referenceCount, setId)

  if (!result.hits.length) {
    return (
      <div className="space-y-4">
        {imageRisk && <ImageRiskBlock hint={imageRisk.hint} />}
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/[0.12] dark:text-emerald-300">
            <CheckIcon className="h-6 w-6" />
          </span>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">没有命中规则库里的违规特征</p>
          <p className="mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
            这是本地关键词检查，只能覆盖显性表述。语义层面的擦边内容仍可能被平台拦截，可以再用「AI 深度检查」判断一遍。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {imageRisk && <ImageRiskBlock hint={imageRisk.hint} />}

      <div>
        <p className="mb-2 text-[12px] font-medium text-gray-500 dark:text-gray-400">命中位置</p>
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-700 custom-scrollbar dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200">
          {parts.map((part, index) => part.hit
            ? (
              <mark
                key={index}
                className={`rounded px-0.5 ${part.hit.rule.severity === 'block'
                  ? 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-200'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200'}`}
              >
                {part.text}
              </mark>
            )
            : <span key={index}>{part.text}</span>)}
        </p>
      </div>

      <div className="space-y-2.5">
        <p className="text-[12px] font-medium text-gray-500 dark:text-gray-400">逐条说明 · {result.hits.length} 项</p>
        {result.hits.map((hit, index) => (
          <div key={`${hit.rule.id}-${index}`} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <SeverityTag severity={hit.rule.severity} />
              <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100">{hit.rule.label}</span>
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">{hit.rule.category}</span>
              <span className="ml-auto font-mono text-[11px] text-gray-400 dark:text-gray-500">第 {hit.index + 1} 字</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">原因：{hit.rule.reason}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="text-emerald-700 dark:text-emerald-400">建议：</span>{hit.rule.suggestion}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// AI 结果的等级配色沿用本地检查的语义：绿=安全、琥珀=可能被降级、红=会被拒绝
const AI_RISK_META: Record<PolicyReviewRisk, { label: string; badge: string }> = {
  safe: {
    label: 'AI 判断：可提交',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300',
  },
  warn: {
    label: 'AI 判断：可能被降级',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-500/[0.12] dark:text-amber-300',
  },
  block: {
    label: 'AI 判断：可能被拒绝',
    badge: 'bg-red-50 text-red-600 dark:bg-red-500/[0.12] dark:text-red-300',
  },
}

/** AI 语义层检查结果，独立于本地结果渲染，出错时不影响本地命中列表 */
function AiReviewPanel({ result, error, loading, onRetry, onApplyRewrite }: {
  result: PolicyReviewResult | null
  error: string
  loading: boolean
  onRetry: () => void
  onApplyRewrite: (item: PolicyReviewItem) => void
}) {
  const meta = result ? AI_RISK_META[result.risk] : AI_RISK_META.safe
  const panelRef = useRef<HTMLElement | null>(null)
  // 模型可能返回全空条目，直接渲染就是一张只有等级标签的空卡片，这里过滤掉
  const visibleItems = (result?.items ?? []).filter((item) => Boolean(item.label || item.quote || item.reason || item.suggestion || item.rewrite))

  // 面板追加在本地结果下方，而结果区高度有限，不主动滚动用户看不到任何反馈
  useEffect(() => {
    if (!loading && !result && !error) return
    const panel = panelRef.current
    if (!panel) return
    const frame = requestAnimationFrame(() => {
      // jsdom 没有实现 scrollIntoView，测试环境直接跳过
      if (typeof panel.scrollIntoView !== 'function') return
      panel.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, result, error])

  return (
    <section ref={panelRef} className="scroll-mt-1 space-y-2.5 rounded-2xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 dark:border-violet-500/25 dark:bg-violet-500/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-violet-800 dark:text-violet-200">AI 深度检查结果</p>
        {loading && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-violet-700 dark:text-violet-300">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            正在做语义分析…
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/25 dark:bg-red-500/[0.08]">
          <AlertIcon className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="min-w-0 flex-1 break-words text-[12px] leading-relaxed text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="h-7 shrink-0 rounded-lg border border-red-300 bg-white px-2 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/[0.12]"
          >
            重试
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${meta.badge}`}>{meta.label}</span>
            {result.summary && (
              <span className="min-w-0 break-words text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200">{result.summary}</span>
            )}
          </div>

          {/* 兜底说明必须与渲染口径一致：用过滤后的 visibleItems 判断，否则会出现「有结论无依据」的空白面板 */}
          {visibleItems.length === 0 && (
            result.risk === 'safe'
              ? <p className="text-[12.5px] leading-relaxed text-emerald-700 dark:text-emerald-300">AI 也未发现语义层风险。</p>
              : (
                <p className={`text-[12.5px] leading-relaxed ${result.risk === 'block' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  模型给出了「{result.risk === 'block' ? '可能被拒绝' : '可能被降级'}」的结论，但没有返回具体风险条目。可以先点「开始检查」跑一遍本地规则，或点「重试」再检查一次。
                </p>
              )
          )}

          {visibleItems.map((item, index) => (
            <div key={`${item.label}-${index}`} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.02]">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <SeverityTag severity={item.severity} />
                {item.label && <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100">{item.label}</span>}
              </div>
              {item.quote && (
                <p className="text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                  原文：
                  <mark className={`rounded px-0.5 ${item.severity === 'block'
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-200'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200'}`}
                  >
                    {item.quote}
                  </mark>
                </p>
              )}
              {item.reason && <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">原因：{item.reason}</p>}
              {item.suggestion && (
                <p className="mt-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                  <span className="text-emerald-700 dark:text-emerald-400">建议：</span>{item.suggestion}
                </p>
              )}
              {item.rewrite && (
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5 dark:border-emerald-500/25 dark:bg-emerald-500/[0.08]">
                  <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-emerald-800 dark:text-emerald-200">
                    <span className="font-medium">安全改写：</span>{item.rewrite}
                  </p>
                  <button
                    type="button"
                    onClick={() => onApplyRewrite(item)}
                    className="h-7 shrink-0 rounded-lg border border-emerald-300 bg-white px-2.5 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-500/[0.12]"
                  >
                    一键修改
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function PromptPolicyModal({ prompt, referenceCount, settings, onClose }: PromptPolicyModalProps) {
  const [activeId, setActiveId] = useState<PolicySet['id']>('openai')
  const [checkedPrompt, setCheckedPrompt] = useState(prompt)
  const [result, setResult] = useState<CheckResult | null>(null)
  // AI 深度检查的状态全部独立，失败或过期都不影响本地检查结果
  const [aiResult, setAiResult] = useState<PolicyReviewResult | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)

  const activeSet = POLICY_SETS.find((set) => set.id === activeId) || POLICY_SETS[0]
  // AI 深检走「生文（文本模型）」配置，与图像生成配置解耦；无可用文本配置时直接禁用
  const textProfile = useMemo(() => (settings ? getTextApiProfile(settings) : null), [settings])
  const canRunAi = Boolean(textProfile && textProfile.baseUrl.trim() && textProfile.model.trim() && textProfile.apiKey.trim())
  const aiDisabledTitle = canRunAi ? '' : '未配置生文（文本模型）API，请先在设置 → 生文配置里指定文本模型接口'

  // 关闭弹窗时中断仍在进行的请求
  useEffect(() => () => { aiAbortRef.current?.abort() }, [])

  function runCheck(setId: PolicySet['id']) {
    setResult(checkText(checkedPrompt, setId))
  }

  /** 清空 AI 结果（文本或规则变化后结果已过期） */
  function resetAi() {
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    setAiLoading(false)
    setAiResult(null)
    setAiError('')
  }

  /** 一键修改：把当前检查文本里 quote 第一次出现替换成 rewrite，并重新跑本地规则、清掉过期的 AI 结果 */
  function applyItemRewrite(item: PolicyReviewItem) {
    if (!item.rewrite) return
    const next = applyRewrite(checkedPrompt, item.quote, item.rewrite)
    if (next === null) {
      setNotice({ tone: 'error', text: '未在提示词中找到该片段，可能已修改' })
      return
    }
    setCheckedPrompt(next)
    setResult(checkText(next, activeId))
    resetAi()
    setNotice({ tone: 'success', text: '已替换该片段，本地检查已刷新' })
  }

  /** 复制弹窗内修改后的提示词，用户自行粘回输入框 */
  async function copyPrompt() {
    try {
      await copyTextToClipboard(checkedPrompt)
      setNotice({ tone: 'success', text: '已复制修改后的提示词' })
    } catch {
      setNotice({ tone: 'error', text: '复制失败，请手动全选复制' })
    }
  }

  async function runAiCheck() {
    if (!settings || !textProfile) return
    if (!textProfile.baseUrl.trim() || !textProfile.model.trim() || !textProfile.apiKey.trim()) return
    const text = checkedPrompt.trim()
    if (!text) return

    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiLoading(true)
    setAiResult(null)
    setAiError('')
    try {
      const raw = await callPromptPolicyReviewApi({
        settings,
        profile: textProfile,
        text: checkedPrompt,
        policySet: activeSet,
        referenceCount,
        signal: controller.signal,
      })
      // 期间切换了规则或改了文本，结果已过期，直接丢弃
      if (aiAbortRef.current !== controller) return
      setAiResult(parsePolicyReviewResult(raw))
    } catch (error) {
      if (aiAbortRef.current !== controller) return
      setAiError(error instanceof Error ? error.message : 'AI 检查失败，请稍后重试')
    } finally {
      if (aiAbortRef.current === controller) {
        aiAbortRef.current = null
        setAiLoading(false)
      }
    }
  }

  function switchSet(setId: PolicySet['id']) {
    setActiveId(setId)
    resetAi()
    if (result) setResult(checkText(checkedPrompt, setId))
  }

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[86vh] w-full max-w-2xl flex-col rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <ShieldIcon className="h-5 w-5 text-blue-500" />
            提示词违规检查
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 规则切换 */}
        <div className="mb-3 flex gap-2">
          {POLICY_SETS.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => switchSet(set.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[12.5px] font-medium transition-colors ${
                activeId === set.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/[0.12] dark:text-blue-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              {set.name}
            </button>
          ))}
        </div>
        <p className="mb-3 text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400">规则依据：{activeSet.source}</p>

        {/* 待检查文本 */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">待检查的提示词</span>
            <div className="flex items-center gap-2">
              <span className="text-[11.5px] text-gray-400 dark:text-gray-500">{checkedPrompt.length} 字</span>
              <button
                type="button"
                onClick={() => void copyPrompt()}
                disabled={!checkedPrompt.trim()}
                className="h-6 rounded-lg border border-gray-200 bg-white px-2 text-[11.5px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              >
                复制修改后的提示词
              </button>
            </div>
          </div>
          <textarea
            value={checkedPrompt}
            onChange={(event) => {
              setCheckedPrompt(event.target.value)
              setResult(null)
              resetAi()
              setNotice(null)
            }}
            rows={4}
            placeholder="这里会带入输入框里的提示词，也可以直接粘贴一段来检查"
            className="w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-[3px] focus:ring-blue-500/[0.12] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-blue-400"
          />
          {notice && (
            <p
              role="status"
              className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed ${
                notice.tone === 'success'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-500/[0.12] dark:text-red-300'
              }`}
            >
              {notice.text}
            </p>
          )}
        </div>

        {/* 结果区 */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar pr-1">
          <div className="space-y-4">
            {result && (
              <ResultPanel result={result} prompt={checkedPrompt} setId={activeId} referenceCount={referenceCount} />
            )}
            {!result && !aiLoading && !aiResult && !aiError && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertIcon className="mb-2.5 h-7 w-7 text-gray-300 dark:text-gray-600" />
                <p className="text-[12.5px] text-gray-500 dark:text-gray-400">选择规则后点「开始检查」，会逐条列出命中的规则与修改建议；「AI 深度检查」还能判断关键词抓不到的语义风险。</p>
              </div>
            )}
            {(aiLoading || aiResult || aiError) && (
              <AiReviewPanel result={aiResult} error={aiError} loading={aiLoading} onRetry={runAiCheck} onApplyRewrite={applyItemRewrite} />
            )}
          </div>
        </div>

        {/* 操作区：文案独占一行，按钮组右对齐，避免换行后按钮贴左留出大片空白 */}
        <div className="mt-4 flex flex-col gap-2.5 border-t border-gray-100 pt-4 dark:border-white/[0.06]">
          <p className="text-[11.5px] leading-relaxed text-gray-400 dark:text-gray-500">
            {referenceCount > 0
              ? `已附带 ${referenceCount} 张参考图，检查结果会一并提示图片风险。本地检查不上传任何内容；AI 深度检查只发送提示词文本与图片数量，不上传图片。`
              : '本地检查不上传任何内容；AI 深度检查会把提示词文本发送给当前配置的模型。'}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-xl border border-gray-200 bg-white px-3.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.12] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"
            >
              关闭
            </button>
            {/* 次要按钮：语义层检查要联网，本地检查仍是主操作 */}
            <button
              type="button"
              onClick={runAiCheck}
              disabled={aiLoading || !canRunAi || !checkedPrompt.trim()}
              aria-busy={aiLoading}
              title={aiDisabledTitle || undefined}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-violet-300 bg-white px-3.5 text-[13px] font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-violet-500/30 dark:bg-white/[0.04] dark:text-violet-300 dark:hover:bg-violet-500/[0.12]"
            >
              {aiLoading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
              {aiLoading ? '检查中…' : 'AI 深度检查'}
            </button>
            <button
              type="button"
              onClick={() => runCheck(activeId)}
              disabled={!checkedPrompt.trim()}
              className="h-9 rounded-xl bg-blue-500 px-4 text-[13px] font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              开始检查
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
