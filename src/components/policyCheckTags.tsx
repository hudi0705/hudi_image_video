// 违规检查相关的最小展示件。
// 「提示词违规检查」弹窗与「镜头模板」的批量检查共用同一套配色语义，
// 抽到这里避免两份副本各自演化导致等级文案 / 配色漂移。

import type { RuleSeverity } from '../lib/promptPolicyCheck'

/** 命中等级对应的 <mark> 高亮样式：block 用红，warn 用琥珀 */
export function severityMarkClass(severity: RuleSeverity): string {
  return severity === 'block'
    ? 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-200'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-500/25 dark:text-amber-200'
}

/** 命中等级标签：block=会被拒绝，warn=可能被拦 */
export function SeverityTag({ severity }: { severity: RuleSeverity }) {
  return severity === 'block'
    ? <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-500/[0.12] dark:text-red-300">会被拒绝</span>
    : <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/[0.12] dark:text-amber-300">可能被拦</span>
}
