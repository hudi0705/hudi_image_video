import { expect, test } from 'vitest'
import { buildPolicyReviewInput, buildPolicyReviewInstructions, parsePolicyReviewResult } from './promptPolicyAiCheck'
import { POLICY_SETS } from './promptPolicyCheck'

const openaiSet = POLICY_SETS.find((set) => set.id === 'openai')!
const doubaoSet = POLICY_SETS.find((set) => set.id === 'doubao')!

test('instructions 带上规则集名称与判据来源', () => {
  const instructions = buildPolicyReviewInstructions(doubaoSet)
  expect(instructions).toContain(doubaoSet.name)
  expect(instructions).toContain(doubaoSet.source)
  // JSON 形状必须写死在 instructions 里，否则模型容易自由发挥
  expect(instructions).toContain('"risk"')
  expect(instructions).toContain('"items"')
  expect(instructions).toContain('最多 5 条')
})

test('不同规则集生成不同 instructions', () => {
  expect(buildPolicyReviewInstructions(openaiSet)).toContain('OpenAI 图像生成规则')
  expect(buildPolicyReviewInstructions(openaiSet)).not.toContain(doubaoSet.source)
})

test('input 包含待检查文本', () => {
  const text = '两个人在昏暗的房间里靠得很近，气氛暧昧'
  expect(buildPolicyReviewInput(text, 0)).toContain(text)
})

test('input 按有无参考图给出不同说明', () => {
  expect(buildPolicyReviewInput('一只猫', 0)).toContain('参考图数量：0 张')
  expect(buildPolicyReviewInput('一只猫', 3)).toContain('参考图数量：3 张')
})

test('解析标准 JSON 结果', () => {
  const raw = JSON.stringify({
    risk: 'block',
    summary: '涉及真实人物指向',
    items: [
      { label: '真实人物', severity: 'block', quote: 'Taylor Swift', reason: '会被直接拒绝', suggestion: '改为虚构角色' },
    ],
  })
  const result = parsePolicyReviewResult(raw)
  expect(result.risk).toBe('block')
  expect(result.summary).toBe('涉及真实人物指向')
  expect(result.items).toHaveLength(1)
  expect(result.items[0].label).toBe('真实人物')
  expect(result.items[0].severity).toBe('block')
  expect(result.items[0].quote).toBe('Taylor Swift')
})

test('解析 ```json 围栏包裹的结果', () => {
  const raw = '```json\n{"risk":"warn","summary":"气氛暧昧","items":[{"label":"性暗示","severity":"warn","quote":"靠得很近","reason":"可能被降级","suggestion":"改为并肩站立"}]}\n```'
  const result = parsePolicyReviewResult(raw)
  expect(result.risk).toBe('warn')
  expect(result.items[0].quote).toBe('靠得很近')
})

test('解析前后带说明文字的结果', () => {
  const raw = '好的，以下是检查结果：\n{"risk":"safe","summary":"没有风险","items":[]}\n希望有帮助。'
  const result = parsePolicyReviewResult(raw)
  expect(result.risk).toBe('safe')
  expect(result.summary).toBe('没有风险')
  expect(result.items).toHaveLength(0)
})

test('非法 JSON 抛出格式错误', () => {
  expect(() => parsePolicyReviewResult('模型这次没有按格式输出')).toThrow('AI 检查返回格式无效')
  expect(() => parsePolicyReviewResult('')).toThrow('AI 检查返回格式无效')
  expect(() => parsePolicyReviewResult('{risk: safe}')).toThrow('AI 检查返回格式无效')
})

test('字段缺失时补安全默认值', () => {
  const result = parsePolicyReviewResult(JSON.stringify({ items: [{}, { label: '血腥' }] }))
  // risk 缺失时按 items 反推：没有 block 条目即 warn
  expect(result.risk).toBe('warn')
  expect(result.summary).toBe('')
  expect(result.items[0]).toEqual({ label: '', severity: 'warn', quote: '', reason: '', suggestion: '' })
  expect(result.items[1].label).toBe('血腥')
})

test('items 非数组时回落空数组，risk 非法时按空 items 推断 safe', () => {
  const result = parsePolicyReviewResult(JSON.stringify({ risk: 'unknown', summary: '结论', items: 'nope' }))
  expect(result.items).toHaveLength(0)
  expect(result.risk).toBe('safe')
})

test('severity 非法时回落 warn', () => {
  const result = parsePolicyReviewResult(JSON.stringify({ risk: 'warn', items: [{ label: 'A', severity: 'high' }] }))
  expect(result.items[0].severity).toBe('warn')
})

test('items 超过 5 条时截断到 5 条', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ label: `风险${index}`, severity: 'warn' }))
  const result = parsePolicyReviewResult(JSON.stringify({ risk: 'warn', items }))
  expect(result.items).toHaveLength(5)
})
