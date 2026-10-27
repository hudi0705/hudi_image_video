// 镜头模板的批量违规检查
// 「镜头模板生图」弹窗里真正送进模型的是「统一提示词 + 每个镜头的画面描述」，
// 所以本地检查要把这两部分拆成独立分段后逐段跑 checkText。
//
// 范围约定（不要随意扩大）：
// - 统一提示词 sharedPrompt：会拼进每个镜头的提示词，必须检查
// - 镜头画面描述 shot.shot：真正进入生图提示词，必须检查
// - 镜头动作 shot.action：只进入生视频提示词，检查但要在 UI 上标注影响范围
// - 镜头声音 shot.sound：只用于人工核对，不进入任何提示词，不检查
//
// 这里全部是纯函数，方便单独测试；网络请求（AI 深检）留在组件里。

import { checkText, type CheckResult, type PolicyHit, type PolicySet } from './promptPolicyCheck'
import type { ParsedShot } from './shotTemplate'

export type ShotPolicySectionKind = 'shared' | 'shot' | 'action'

/** 一个待检查的文本分段 */
export interface ShotPolicySection {
  /** 稳定且唯一的 key，用于 React 列表与展开状态 */
  key: string
  label: string
  text: string
  kind: ShotPolicySectionKind
  /** 镜头自身的序号（来自模板解析结果），统一提示词分段没有这个字段 */
  shotIndex?: number
}

/** 分段 + 该分段的检查结果 */
export interface ShotPolicySectionResult {
  section: ShotPolicySection
  result: CheckResult
}

/** 单个镜头的检查汇总 */
export interface ShotPolicyShotGroup {
  key: string
  /** 在 shots 数组里的位置，0 开始 */
  position: number
  /** 模板里解析出的镜头序号 */
  index: number
  title: string
  shot: string
  action: string
  sections: ShotPolicySectionResult[]
  /** 该镜头所有分段的命中项（画面描述 + 动作） */
  hits: PolicyHit[]
  blocked: boolean
}

/** 一次批量检查的完整结果 */
export interface ShotPolicyReport {
  setId: PolicySet['id']
  /** 统一提示词分段；sharedPrompt 为空时是 null */
  shared: ShotPolicySectionResult | null
  shots: ShotPolicyShotGroup[]
  /** 全部分段的命中总数 */
  totalHits: number
  /** 有命中的分段数量 */
  sectionsWithHits: number
  /** 参与检查的镜头数量 */
  checkedShotCount: number
  /** 是否存在 block 级命中 */
  blocked: boolean
  /** 一处命中都没有 */
  allClear: boolean
}

function sectionLabel(shot: ParsedShot, position: number, kind: 'shot' | 'action'): string {
  const title = shot.title.trim() || `镜头 ${String(position + 1).padStart(2, '0')}`
  return kind === 'shot' ? `${title} · 画面描述` : `${title} · 动作`
}

/**
 * 镜头卡片的稳定标识，用于记住「哪个镜头是展开的」。
 *
 * 不能用 `shot-${position}`：检查开启后改模板会实时重算，删掉前面的镜头会让
 * 后面镜头的 position 前移，展开状态就错位到另一个镜头上了。
 * 这里改成由镜头内容派生（序号 + 标题 + 画面 + 动作的轻量 hash）：
 * 内容没变则 key 不变（保持展开），内容变了 key 就换了（自动折叠），不会串镜头。
 */
export function shotPolicyCardKey(shot: ParsedShot): string {
  const source = `${shot.index}\u0000${shot.title}\u0000${shot.shot}\u0000${shot.action}`
  // FNV-1a 32 位：改动一个字 hash 就变，且长度固定，适合直接当 React key / 状态键
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `shot-${shot.index}-${(hash >>> 0).toString(36)}`
}

/**
 * 把「统一提示词 + 镜头列表」转成待检查分段。
 * 顺序固定为：统一提示词 → 镜头 1 画面 → 镜头 1 动作 → 镜头 2 画面 → …
 * 空文本直接跳过，声音永远不产生分段。
 */
export function collectShotPolicySections(sharedPrompt: string, shots: ParsedShot[]): ShotPolicySection[] {
  const sections: ShotPolicySection[] = []
  const shared = sharedPrompt.trim()
  if (shared) {
    sections.push({ key: 'shared', label: '统一提示词', text: shared, kind: 'shared' })
  }

  shots.forEach((shot, position) => {
    const body = shot.shot.trim()
    if (body) {
      sections.push({
        // 用位置而不是 shot.index 做 key：模板里允许出现重复序号，位置一定唯一
        key: `shot-${position}-body`,
        label: sectionLabel(shot, position, 'shot'),
        text: body,
        kind: 'shot',
        shotIndex: shot.index,
      })
    }
    const action = shot.action.trim()
    if (action) {
      sections.push({
        key: `shot-${position}-action`,
        label: sectionLabel(shot, position, 'action'),
        text: action,
        kind: 'action',
        shotIndex: shot.index,
      })
    }
  })

  return sections
}

/** 逐段跑本地规则。纯同步、无网络，几十个镜头也不会有性能问题 */
export function checkShotPolicySections(sections: ShotPolicySection[], setId: PolicySet['id']): ShotPolicySectionResult[] {
  return sections.map((section) => ({ section, result: checkText(section.text, setId) }))
}

/**
 * 生成一次批量检查的完整报告。
 * 切换规则集时用同一份文本重新调用即可，不需要重新请求任何接口。
 */
export function buildShotPolicyReport(
  sharedPrompt: string,
  shots: ParsedShot[],
  setId: PolicySet['id'],
): ShotPolicyReport {
  const sections = collectShotPolicySections(sharedPrompt, shots)
  const sharedSection = sections.find((section) => section.kind === 'shared') ?? null
  const shared = sharedSection ? { section: sharedSection, result: checkText(sharedSection.text, setId) } : null

  const shotGroups: ShotPolicyShotGroup[] = shots.map((shot, position) => {
    const own = sections.filter((section) => section.key.startsWith(`shot-${position}-`))
    const checked = checkShotPolicySections(own, setId)
    const hits = checked.flatMap((item) => item.result.hits)
    return {
      key: shotPolicyCardKey(shot),
      position,
      index: shot.index,
      title: shot.title,
      shot: shot.shot,
      action: shot.action,
      sections: checked,
      hits,
      blocked: hits.some((hit) => hit.rule.severity === 'block'),
    }
  })

  const allSections: ShotPolicySectionResult[] = [
    ...(shared ? [shared] : []),
    ...shotGroups.flatMap((group) => group.sections),
  ]
  const totalHits = allSections.reduce((sum, item) => sum + item.result.hits.length, 0)

  return {
    setId,
    shared,
    shots: shotGroups,
    totalHits,
    sectionsWithHits: allSections.filter((item) => item.result.hits.length > 0).length,
    checkedShotCount: shots.length,
    blocked: allSections.some((item) => item.result.blocked),
    allClear: totalHits === 0,
  }
}
