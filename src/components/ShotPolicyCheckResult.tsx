// 「镜头模板生图」的批量检查结果展示件。
// 拆成独立文件，避免 ShotTemplatePanel 继续膨胀；这里只做渲染与单镜头 AI 深检。
// 本地规则检查的结果完全由 shotPolicyCheck.ts 算出（纯函数，可在别处复用）。

import { useEffect, useMemo, useRef, useState } from 'react'
import { callPromptPolicyReviewApi } from '../lib/agentApi'
import { getTextApiProfile } from '../lib/apiProfiles'
import { copyTextToClipboard } from '../lib/clipboard'
import {
  parsePolicyReviewResult,
  type PolicyReviewItem,
  type PolicyReviewResult,
  type PolicyReviewRisk,
} from '../lib/promptPolicyAiCheck'
import { POLICY_SETS, splitByHits, type PolicyHit, type PolicySet } from '../lib/promptPolicyCheck'
import type { ShotPolicyReport, ShotPolicyShotGroup } from '../lib/shotPolicyCheck'
import type { AppSettings } from '../types'
import { SeverityTag, severityMarkClass } from './policyCheckTags'

/** 汇总条上的规则集短名，正式名称太长会挤掉汇总文案 */
const SET_SHORT_LABEL: Record<PolicySet['id'], string> = {
  openai: 'OpenAI',
  doubao: '豆包',
}

function AlertIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

/** 逐条列出本地规则的命中项：等级 + 规则名 + 命中原文 + 原因 + 建议 */
export function PolicyHitList({ hits }: { hits: PolicyHit[] }) {
  if (!hits.length) return null
  return (
    <div className="mt-1.5 space-y-1.5">
      {hits.map((hit, index) => (
        <div
          key={`${hit.rule.id}-${index}`}
          className="rounded-xl border border-gray-200 bg-white px-2.5 py-2 dark:border-white/[0.08] dark:bg-white/[0.02]"
        >
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <SeverityTag severity={hit.rule.severity} />
            <span className="text-[12.5px] font-medium text-gray-900 dark:text-gray-100">{hit.rule.label}</span>
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">
              {hit.rule.category}
            </span>
            <mark className={`rounded px-0.5 text-[12px] ${severityMarkClass(hit.rule.severity)}`}>{hit.matched}</mark>
          </div>
          <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">原因：{hit.rule.reason}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
            <span className="text-emerald-700 dark:text-emerald-400">建议：</span>{hit.rule.suggestion}
          </p>
        </div>
      ))}
    </div>
  )
}

/** 把一段文本按命中位置渲染成带 <mark> 的句子 */
function HighlightedText({ text, hits }: { text: string; hits: PolicyHit[] }) {
  const parts = useMemo(() => splitByHits(text, hits), [text, hits])
  return (
    <p className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-[12.5px] leading-relaxed text-gray-700 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-200">
      {parts.map((part, index) => part.hit
        ? <mark key={index} className={`rounded px-0.5 ${severityMarkClass(part.hit.rule.severity)}`}>{part.text}</mark>
        : <span key={index}>{part.text}</span>)}
    </p>
  )
}

/** 顶部汇总条：检查范围 + 风险总数 + 规则集切换 */
export function ShotPolicySummary({ report, onSwitchSet }: {
  report: ShotPolicyReport
  onSwitchSet: (setId: PolicySet['id']) => void
}) {
  const allClear = report.allClear
  return (
    <div
      className={`mb-2 rounded-2xl border px-3 py-2.5 ${allClear
        ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/[0.08]'
        : 'border-red-200 bg-red-50/60 dark:border-red-500/25 dark:bg-red-500/[0.08]'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`flex items-center gap-1.5 text-[12.5px] font-medium ${allClear
          ? 'text-emerald-800 dark:text-emerald-200'
          : 'text-red-700 dark:text-red-200'}`}
        >
          {allClear
            ? <CheckIcon className="h-3.5 w-3.5 shrink-0" />
            : <AlertIcon className="h-3.5 w-3.5 shrink-0" />}
          <span>
            已检查 {report.checkedShotCount} 个镜头 · {allClear ? '全部通过' : `${report.totalHits} 处风险`}
          </span>
        </p>
        <div className="flex gap-1.5">
          {POLICY_SETS.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => onSwitchSet(set.id)}
              aria-pressed={report.setId === set.id}
              title={set.name}
              className={`rounded-lg border px-2 py-0.5 text-[11.5px] font-medium transition-colors ${report.setId === set.id
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/[0.12] dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/[0.1] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
            >
              {SET_SHORT_LABEL[set.id]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
        本地关键词检查，
        {/* 主文案说的是「处」（命中条目），副文案必须说明段落与条目的关系，避免同屏两个数各说各的 */}
        {allClear
          ? '未命中规则库'
          : `${report.sectionsWithHits} 段命中，共 ${report.totalHits} 处`}。
        {report.shared ? ' 统一提示词会拼进每个镜头，已单独检查。' : ''}
        动作只影响生视频阶段；声音不进入画面提示词，不参与检查。
      </p>
    </div>
  )
}

/** 统一提示词块：影响全部镜头，因此优先级最高、始终展开 */
export function ShotPolicySharedBlock({ text, hits, shotCount }: {
  text: string
  hits: PolicyHit[]
  shotCount: number
}) {
  const hasRisk = hits.length > 0
  return (
    <div
      className={`mb-2 rounded-2xl border px-3 py-2.5 ${hasRisk
        ? 'border-red-300 bg-red-50/70 dark:border-red-500/30 dark:bg-red-500/[0.08]'
        : 'border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[12.5px] font-medium text-gray-800 dark:text-gray-100">
          统一提示词（影响全部 {shotCount} 个镜头）
        </p>
        {hasRisk
          ? <span className="shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/[0.15] dark:text-red-300">{hits.length} 项</span>
          : <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">通过</span>}
      </div>
      <HighlightedText text={text} hits={hits} />
      <PolicyHitList hits={hits} />
    </div>
  )
}

/** 镜头卡片右上角的徽标：无风险=绿色「通过」，有风险=红色「N 项」 */
export function ShotPolicyBadge({ group }: { group: ShotPolicyShotGroup }) {
  if (!group.hits.length) {
    return (
      <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">
        通过
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/[0.15] dark:text-red-300">
      {group.hits.length} 项
    </span>
  )
}

// AI 结果的等级配色沿用本地检查语义：绿=安全、琥珀=可能被降级、红=会被拒绝
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

function AiItemList({ items, onCopyRewrite }: { items: PolicyReviewItem[]; onCopyRewrite?: (item: PolicyReviewItem) => void }) {
  if (!items.length) return null
  return (
    <div className="space-y-1.5">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="rounded-xl border border-gray-200 bg-white px-2.5 py-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <SeverityTag severity={item.severity} />
            {item.label && <span className="text-[12.5px] font-medium text-gray-900 dark:text-gray-100">{item.label}</span>}
          </div>
          {item.quote && (
            <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
              原文：<mark className={`rounded px-0.5 ${severityMarkClass(item.severity)}`}>{item.quote}</mark>
            </p>
          )}
          {item.reason && <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">原因：{item.reason}</p>}
          {item.suggestion && (
            <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600 dark:text-gray-300">
              <span className="text-emerald-700 dark:text-emerald-400">建议：</span>{item.suggestion}
            </p>
          )}
          {item.rewrite && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-1 dark:border-emerald-500/25 dark:bg-emerald-500/[0.08]">
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-200">
                <span className="font-medium">安全改写：</span>{item.rewrite}
              </p>
              {onCopyRewrite && (
                <button
                  type="button"
                  onClick={() => onCopyRewrite(item)}
                  className="h-6 shrink-0 rounded-lg border border-emerald-300 bg-white px-2 text-[11.5px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-500/[0.12]"
                >
                  复制建议
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export interface ShotPolicyDetailProps {
  group: ShotPolicyShotGroup
  /** 该镜头真正会送给模型的完整提示词（样式图提示 + 统一提示词 + 画面描述） */
  imagePrompt: string
  policySet: PolicySet
  settings: AppSettings
  referenceCount: number
}

/**
 * 单个镜头的展开详情：分段命中明细 + 可选的 AI 语义深检。
 * AI 请求的生命周期跟随本组件：折叠卡片（卸载）或切换镜头时自动 abort，
 * 并用 ref 比对丢弃过期响应。
 */
export function ShotPolicyDetail({
  group,
  imagePrompt,
  policySet,
  settings,
  referenceCount,
}: ShotPolicyDetailProps) {
  const [aiResult, setAiResult] = useState<PolicyReviewResult | null>(null)
  const [aiError, setAiError] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const aiAbortRef = useRef<AbortController | null>(null)

  // AI 深检走「生文（文本模型）」配置，与图像生成配置解耦；无可用文本配置时直接禁用
  const textProfile = useMemo(() => getTextApiProfile(settings), [settings])
  const canRunAi = Boolean(textProfile && textProfile.baseUrl.trim() && textProfile.model.trim() && textProfile.apiKey.trim())
  const aiDisabledTitle = canRunAi ? '' : '未配置生文（文本模型）API，请先在设置 → 生文配置里指定文本模型接口'

  useEffect(() => () => {
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
  }, [])

  /** 镜头提示词是模板解析出来的，自动回写会破坏 ### 片段结构，这里只复制 rewrite 供用户手动粘贴 */
  async function copyRewrite(item: PolicyReviewItem) {
    if (!item.rewrite) return
    try {
      await copyTextToClipboard(item.rewrite)
      setCopyNotice('已复制安全改写')
    } catch {
      setCopyNotice('复制失败，请手动复制')
    }
  }

  async function runAiCheck() {
    if (!textProfile) return
    const text = imagePrompt.trim()
    if (!canRunAi || !text) return
    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiLoading(true)
    setAiResult(null)
    setAiError('')
    setCopyNotice('')
    try {
      const raw = await callPromptPolicyReviewApi({
        settings,
        profile: textProfile,
        text: imagePrompt,
        policySet,
        referenceCount,
        signal: controller.signal,
      })
      // 组件已卸载或发起了新的请求，响应过期直接丢弃
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

  const visibleItems = (aiResult?.items ?? []).filter((item) => Boolean(item.label || item.quote || item.reason || item.suggestion))
  const aiMeta = aiResult ? AI_RISK_META[aiResult.risk] : AI_RISK_META.safe

  return (
    <div className="mt-2 space-y-2 border-t border-dashed border-gray-200 pt-2 dark:border-white/[0.1]">
      {group.sections.map(({ section, result }) => {
        const isAction = section.kind === 'action'
        return (
          <div key={section.key}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-[11.5px] font-medium ${isAction ? 'text-gray-500 dark:text-gray-400' : 'text-gray-600 dark:text-gray-300'}`}>
                {isAction ? '动作' : '画面描述'}
              </span>
              {isAction && (
                <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10.5px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">
                  只影响生视频，不进入生图提示词
                </span>
              )}
              {result.hits.length > 0
                ? <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10.5px] font-medium text-red-700 dark:bg-red-500/[0.15] dark:text-red-300">{result.hits.length} 项</span>
                : <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:bg-emerald-500/[0.12] dark:text-emerald-300">通过</span>}
            </div>
            <HighlightedText text={section.text} hits={result.hits} />
            <PolicyHitList hits={result.hits} />
          </div>
        )
      })}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => void runAiCheck()}
          disabled={aiLoading || !canRunAi || !imagePrompt.trim()}
          aria-busy={aiLoading}
          title={aiDisabledTitle || undefined}
          className="flex items-center gap-1.5 rounded-xl border border-violet-300 bg-white px-2.5 py-1 text-[12px] font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-violet-500/30 dark:bg-white/[0.04] dark:text-violet-300 dark:hover:bg-violet-500/[0.12]"
        >
          {aiLoading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
          {aiLoading ? '检查中…' : 'AI 深检这个镜头'}
        </button>
        {/* 禁用原因必须是可见文字：触屏和部分浏览器不显示 title，用户会不知道为什么点不动 */}
        {canRunAi
          ? (
            <span className="text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
              会把该镜头拼装后的完整提示词发给当前模型，只做语义判断
            </span>
          )
          : (
            <span className="text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
              {aiDisabledTitle || '需先在设置里填写 API Key'}
            </span>
          )}
      </div>

      {aiError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 dark:border-red-500/25 dark:bg-red-500/[0.08]">
          <AlertIcon className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
          <p className="min-w-0 flex-1 break-words text-[12px] leading-relaxed text-red-700 dark:text-red-300">{aiError}</p>
          <button
            type="button"
            onClick={() => void runAiCheck()}
            className="h-6 shrink-0 rounded-lg border border-red-300 bg-white px-2 text-[11.5px] font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-500/[0.12]"
          >
            重试
          </button>
        </div>
      )}

      {aiResult && (
        <div className="space-y-1.5 rounded-xl border border-violet-200 bg-violet-50/40 px-2.5 py-2 dark:border-violet-500/25 dark:bg-violet-500/[0.06]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${aiMeta.badge}`}>{aiMeta.label}</span>
            {aiResult.summary && (
              <span className="min-w-0 break-words text-[12px] leading-relaxed text-gray-700 dark:text-gray-200">{aiResult.summary}</span>
            )}
          </div>
          {visibleItems.length === 0 && (
            aiResult.risk === 'safe'
              ? <p className="text-[12px] leading-relaxed text-emerald-700 dark:text-emerald-300">AI 也没发现这个镜头的语义风险。</p>
              : (
                <p className={`text-[12px] leading-relaxed ${aiResult.risk === 'block' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  模型给出了「{aiResult.risk === 'block' ? '可能被拒绝' : '可能被降级'}」的结论，但没有返回具体条目，可以点「AI 深检这个镜头」再跑一次。
                </p>
              )
          )}
          <AiItemList items={visibleItems} onCopyRewrite={copyRewrite} />
          {copyNotice && (
            <p role="status" className="text-[11.5px] leading-relaxed text-emerald-700 dark:text-emerald-300">{copyNotice}</p>
          )}
        </div>
      )}
    </div>
  )
}
