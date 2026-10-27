import { expect, test } from 'vitest'
import { buildShotPolicyReport, collectShotPolicySections, checkShotPolicySections, shotPolicyCardKey } from './shotPolicyCheck'
import type { ParsedShot } from './shotTemplate'

function shot(overrides: Partial<ParsedShot> & { index: number }): ParsedShot {
  return { title: `片段 0${overrides.index}`, shot: '', action: '', sound: '', ...overrides }
}

test('统一提示词为空时不产生 shared 分段', () => {
  const sections = collectShotPolicySections('   ', [shot({ index: 1, shot: '一张木质工作台' })])
  expect(sections.some((section) => section.kind === 'shared')).toBe(false)
  expect(sections).toHaveLength(1)
})

test('多镜头分段顺序：shared → 画面 → 动作 → 下一个镜头', () => {
  const sections = collectShotPolicySections('16:9 横屏', [
    shot({ index: 1, shot: '钥匙在桌面中央', action: '手掌伸入画面' }),
    shot({ index: 2, shot: '钥匙滑到右侧', action: '手指合拢' }),
  ])
  expect(sections.map((section) => section.key)).toEqual([
    'shared',
    'shot-0-body',
    'shot-0-action',
    'shot-1-body',
    'shot-1-action',
  ])
  expect(sections.map((section) => section.text)).toEqual([
    '16:9 横屏',
    '钥匙在桌面中央',
    '手掌伸入画面',
    '钥匙滑到右侧',
    '手指合拢',
  ])
  expect(sections[1].kind).toBe('shot')
  expect(sections[2].kind).toBe('action')
  expect(sections[2].shotIndex).toBe(1)
})

test('action 为空时跳过，只保留画面描述分段', () => {
  const sections = collectShotPolicySections('', [shot({ index: 1, shot: '空荡的房间', action: '   ' })])
  expect(sections).toHaveLength(1)
  expect(sections[0].kind).toBe('shot')
})

test('声音不出现在任何分段里', () => {
  const sections = collectShotPolicySections('电影感光影', [
    shot({ index: 1, shot: '钥匙落在桌面', action: '钥匙滑走', sound: '金属与木头的碰撞声' }),
  ])
  expect(sections).toHaveLength(3)
  for (const section of sections) {
    expect(section.text).not.toContain('金属与木头的碰撞声')
  }
  expect(sections.some((section) => section.kind === 'shared' && section.text.includes('钥匙'))).toBe(false)
})

test('重复的镜头序号不会导致 key 冲突', () => {
  const sections = collectShotPolicySections('', [
    shot({ index: 1, shot: 'A 画面' }),
    shot({ index: 1, shot: 'B 画面' }),
  ])
  const keys = sections.map((section) => section.key)
  expect(new Set(keys).size).toBe(keys.length)
})

test('逐段检查返回与分段一一对应的结果', () => {
  const sections = collectShotPolicySections('', [shot({ index: 1, shot: '一只皮卡丘站在森林里' })])
  const checked = checkShotPolicySections(sections, 'openai')
  expect(checked).toHaveLength(1)
  expect(checked[0].result.blocked).toBe(true)
  expect(checked[0].result.hits[0].rule.id).toBe('openai-trademark')
})

test('报告把统一提示词命中计入总数，并单独暴露 shared', () => {
  const report = buildShotPolicyReport('画一张 Taylor Swift 在演唱会上的照片', [
    shot({ index: 1, shot: '清晨的山谷，薄雾与小溪' }),
  ], 'openai')
  expect(report.shared).not.toBeNull()
  expect(report.shared?.result.blocked).toBe(true)
  expect(report.totalHits).toBe(1)
  expect(report.sectionsWithHits).toBe(1)
  expect(report.blocked).toBe(true)
  expect(report.allClear).toBe(false)
  expect(report.shots).toHaveLength(1)
  expect(report.shots[0].hits).toHaveLength(0)
})

test('动作分段的风险独立记在对应镜头下', () => {
  const report = buildShotPolicyReport('', [
    shot({ index: 1, shot: '工作台与钥匙', action: '角色掏出身份证对准镜头' }),
    shot({ index: 2, shot: '钥匙滑向右侧' }),
  ], 'doubao')
  expect(report.shots[0].hits.length).toBeGreaterThan(0)
  expect(report.shots[0].blocked).toBe(true)
  expect(report.shots[1].hits).toHaveLength(0)
  expect(report.totalHits).toBe(report.shots[0].hits.length)
  expect(report.checkedShotCount).toBe(2)
  expect(report.shared).toBeNull()
})

test('全部通过时 allClear 为真且没有命中', () => {
  const report = buildShotPolicyReport('16:9 横屏，电影感光影', [
    shot({ index: 1, shot: '木桌上放着一把黄铜钥匙', sound: '纸张翻动声' }),
    shot({ index: 2, shot: '钥匙沿轨道滑到画面右侧' }),
  ], 'openai')
  expect(report.totalHits).toBe(0)
  expect(report.sectionsWithHits).toBe(0)
  expect(report.blocked).toBe(false)
  expect(report.allClear).toBe(true)
  expect(report.shots.map((group) => group.hits.length)).toEqual([0, 0])
})

test('切换规则集时同一份文本会得到不同结果', () => {
  const shots = [shot({ index: 1, shot: '一位演员站在舞台中央' })]
  const openaiReport = buildShotPolicyReport('', shots, 'openai')
  const doubaoReport = buildShotPolicyReport('', shots, 'doubao')
  expect(openaiReport.totalHits).toBe(0)
  expect(doubaoReport.totalHits).toBeGreaterThan(0)
  expect(doubaoReport.setId).toBe('doubao')
})

test('卡片标识由内容派生：镜头前移后 key 不变', () => {
  const third = shot({ index: 3, shot: '一只皮卡丘站在山顶', action: '镜头推进' })
  const before = buildShotPolicyReport('', [shot({ index: 1, shot: '开头' }), shot({ index: 2, shot: '中间' }), third], 'openai')
  // 删掉第一个镜头，原来的第三个镜头 position 从 2 变成 1，key 必须还是同一个
  const after = buildShotPolicyReport('', [shot({ index: 2, shot: '中间' }), third], 'openai')
  expect(before.shots[2].key).toBe(after.shots[1].key)
  expect(after.shots[1].position).toBe(1)
})

test('卡片标识区分内容：画面或动作改一个字就换 key', () => {
  const base = shot({ index: 1, shot: '钥匙落在桌面' })
  expect(shotPolicyCardKey(base)).not.toBe(shotPolicyCardKey({ ...base, shot: '钥匙落在桌上' }))
  expect(shotPolicyCardKey(base)).not.toBe(shotPolicyCardKey({ ...base, action: '钥匙滑走' }))
  expect(shotPolicyCardKey(base)).toBe(shotPolicyCardKey({ ...base }))
})

test('不同内容的镜头不会共享卡片标识', () => {
  const report = buildShotPolicyReport('', [
    shot({ index: 1, shot: '一只皮卡丘站在森林里' }),
    shot({ index: 2, shot: '一只皮卡丘站在海边' }),
    shot({ index: 3, shot: '一只皮卡丘站在山顶' }),
  ], 'openai')
  const keys = report.shots.map((group) => group.key)
  expect(new Set(keys).size).toBe(keys.length)
})
