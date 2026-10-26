// 提示词 AI 深度检查：本地关键词只能覆盖显性表述，语义擦边（例如"两个人靠得很近，气氛暧昧"）需要模型判断
// 这里只放纯函数（instructions / input / 解析），网络请求在 agentApi 里，方便单独测试与复用

import type { PolicySet } from './promptPolicyCheck'

export type PolicyReviewRisk = 'safe' | 'warn' | 'block'

export type PolicyReviewItem = {
  label: string
  severity: 'block' | 'warn'
  quote: string
  reason: string
  suggestion: string
}

export type PolicyReviewResult = {
  risk: PolicyReviewRisk
  summary: string
  items: PolicyReviewItem[]
}

/** 生成给模型的 system instructions，带上规则集名与来源，让模型知道判据出处 */
export function buildPolicyReviewInstructions(set: PolicySet): string {
  return [
    '你是图像生成平台的提示词合规审核员，只做一件事：判断给定的提示词提交到指定平台后，是否会被拒绝生成或被降级处理。',
    '',
    '## 判据来源',
    `- 规则集：${set.name}`,
    `- 依据：${set.source}`,
    '',
    '## 审核范围',
    '- 只判断这段提示词提交到该平台是否会被拒绝或降级，不评价提示词写得好不好、不提供绘画建议、不做润色。',
    '- 重点识别语义层面的擦边内容：真实人物指向、未成年人相关、性暗示与低俗、血腥暴力、违法与伪造、政治敏感、版权与商标。',
    '- 关键词已经能覆盖的显性违规也要指出，但优先给出关键词抓不到的语义风险。',
    '- 不要因为提示词本身简短、抽象就判为安全，要按最可能的落地画面判断风险。',
    '',
    '## 输出要求',
    '- 严格只输出一个 JSON 对象，不要任何解释性文字、不要 Markdown 代码围栏、不要前后缀。',
    '- JSON 形状：{"risk":"safe" | "warn" | "block","summary":"一句话结论","items":[{"label":"风险点名称","severity":"block" | "warn","quote":"原文片段","reason":"为什么","suggestion":"怎么改"}]}',
    '- risk 取三项中最严重的等级；items 最多 5 条，按严重程度降序排列。',
    '- quote 必须逐字摘自提示词原文，不要改写；reason 说明会被哪个判据命中；suggestion 给出可直接替换的中文改写建议。',
    '- 如果不存在任何风险，输出 {"risk":"safe","summary":"一句话结论","items":[]}。',
  ].join('\n')
}

/** 生成 user content 文本，包含待检查提示词与参考图数量 */
export function buildPolicyReviewInput(text: string, referenceCount: number): string {
  const referenceLine = referenceCount > 0
    ? `参考图数量：${referenceCount} 张（图片内容不会传给你，请只按提示词文字与"存在参考图"这一事实判断风险）`
    : '参考图数量：0 张（纯文生图，没有参考图）'
  return [
    '请审核下面这段提示词。',
    '',
    '待检查的提示词：',
    '<<<',
    text,
    '>>>',
    '',
    referenceLine,
  ].join('\n')
}

/** 读字符串字段，类型不对时给空串，避免把 undefined / 数字渲染到界面上 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把单条 item 规整成固定结构，字段缺失一律补安全默认值 */
function normalizeItem(value: unknown): PolicyReviewItem {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    label: readString(record.label),
    // 只认 block，其余（含非法值、缺失）一律回落 warn，避免误报为"会被拒绝"
    severity: record.severity === 'block' ? 'block' : 'warn',
    quote: readString(record.quote),
    reason: readString(record.reason),
    suggestion: readString(record.suggestion),
  }
}

/** risk 非法时按 items 反推：有 block → block，有其它条目 → warn，否则 safe */
function normalizeRisk(value: unknown, items: PolicyReviewItem[]): PolicyReviewRisk {
  if (value === 'safe' || value === 'warn' || value === 'block') return value
  if (items.some((item) => item.severity === 'block')) return 'block'
  return items.length > 0 ? 'warn' : 'safe'
}

/** 容错解析：模型可能用 ```json 围栏包裹，也可能在前后带说明文字 */
function parseJsonObject(raw: string): unknown {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) throw new Error('AI 检查返回格式无效')
  try {
    return JSON.parse(text)
  } catch {
    // 整体解析失败，截取第一个 { 到最后一个 } 再试一次
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('AI 检查返回格式无效')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('AI 检查返回格式无效')
  }
}

/** 解析模型返回的审核结果，任何脏数据都要降级成可用结构而不是抛错 */
export function parsePolicyReviewResult(raw: string): PolicyReviewResult {
  const data = parseJsonObject(raw)
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const rawItems = Array.isArray(record.items) ? record.items : []
  const items = rawItems.slice(0, 5).map(normalizeItem)
  return {
    risk: normalizeRisk(record.risk, items),
    summary: readString(record.summary),
    items,
  }
}
