import { expect, test } from 'vitest'
import { checkReferenceImages, checkText, POLICY_SETS, splitByHits } from './promptPolicyCheck'

test('空提示词不产生命中', () => {
  expect(checkText('', 'openai').hits).toHaveLength(0)
  expect(checkText('   ', 'doubao').blocked).toBe(false)
})

test('正常风景提示词两套规则都不命中', () => {
  const text = '清晨的山谷，薄雾中有一条小溪，远处是连绵的雪山，柔和自然光'
  expect(checkText(text, 'openai').hits).toHaveLength(0)
  expect(checkText(text, 'doubao').hits).toHaveLength(0)
})

test('OpenAI 规则拦截真实人物姓名', () => {
  const result = checkText('画一张 Taylor Swift 在演唱会上的照片', 'openai')
  expect(result.blocked).toBe(true)
  expect(result.hits[0].rule.id).toBe('openai-real-person')
  expect(result.hits[0].matched).toBe('Taylor Swift')
})

test('OpenAI 规则拦截知名 IP', () => {
  const result = checkText('一只皮卡丘站在森林里', 'openai')
  expect(result.blocked).toBe(true)
  expect(result.hits.map((hit) => hit.rule.id)).toContain('openai-trademark')
})

test('OpenAI 规则拦截在世艺术家风格', () => {
  expect(checkText('宫崎骏风格的天空', 'openai').blocked).toBe(true)
})

test('OpenAI 规则对血腥只警告不阻断', () => {
  const result = checkText('战场上的血腥场面', 'openai')
  expect(result.hits[0].rule.severity).toBe('warn')
  expect(result.blocked).toBe(false)
})

test('豆包规则拦截明星与政治敏感', () => {
  expect(checkText('生成一位明星的写真', 'doubao').blocked).toBe(true)
  expect(checkText('领导人讲话的画面', 'doubao').blocked).toBe(true)
})

test('豆包规则拦截具体艺人姓名', () => {
  expect(checkText('肖战古装造型', 'doubao').blocked).toBe(true)
})

test('豆包规则同样拦截英文名人姓名', () => {
  const result = checkText('画一张 Taylor Swift 的演唱会照片', 'doubao')
  expect(result.blocked).toBe(true)
  expect(result.hits[0].rule.id).toBe('doubao-real-person')
})

test('豆包规则对知名 IP 只警告', () => {
  const result = checkText('迪士尼城堡', 'doubao')
  expect(result.blocked).toBe(false)
  expect(result.hits[0].rule.severity).toBe('warn')
})

test('两套规则命中项不同', () => {
  expect(checkText('宫崎骏风格', 'doubao').hits).toHaveLength(0)
  expect(checkText('宫崎骏风格', 'openai').hits).toHaveLength(1)
})

test('命中位置按出现顺序排序并可高亮分段', () => {
  const result = checkText('米老鼠和皮卡丘一起玩', 'openai')
  const parts = splitByHits('米老鼠和皮卡丘一起玩', result.hits)
  const highlighted = parts.filter((part) => part.hit).map((part) => part.text)
  expect(highlighted).toEqual(['米老鼠', '皮卡丘'])
  expect(parts.map((part) => part.text).join('')).toBe('米老鼠和皮卡丘一起玩')
})

test('无命中时 splitByHits 返回整段', () => {
  const parts = splitByHits('一段干净的文字', [])
  expect(parts).toEqual([{ text: '一段干净的文字', hit: null }])
})

test('参考图提醒按规则集区分', () => {
  expect(checkReferenceImages(0, 'openai')).toBeNull()
  expect(checkReferenceImages(2, 'doubao')?.hint).toContain('人脸比对')
  expect(checkReferenceImages(2, 'openai')?.hint).toContain('换脸')
})

test('每个规则集都有唯一 id 与来源说明', () => {
  const ids = POLICY_SETS.flatMap((set) => set.rules.map((rule) => rule.id))
  expect(new Set(ids).size).toBe(ids.length)
  for (const set of POLICY_SETS) {
    expect(set.source.length).toBeGreaterThan(10)
    expect(set.rules.length).toBeGreaterThan(3)
  }
})

test('中文商业与科技名人姓名两套规则都能识别', () => {
  // 用户最常写的句式：只出现中文姓名，没有任何「明星/网红」这类泛称
  const text = '马斯克公开表达过对人工智能风险的担忧'
  for (const setId of ['openai', 'doubao'] as const) {
    const result = checkText(text, setId)
    expect(result.blocked).toBe(true)
    expect(result.hits.some((hit) => hit.rule.id === `${setId}-real-person`)).toBe(true)
    expect(result.hits.find((hit) => hit.rule.id === `${setId}-real-person`)?.matched).toBe('马斯克')
  }
})

test('中文名人的中英覆盖一致：逐个姓名在两套规则下都命中', () => {
  const names = ['马斯克', '雷军', '马云', '马化腾', '李彦宏', '张一鸣', '刘强东', '董明珠', '王传福', '张朝阳', '周鸿祎']
  for (const name of names) {
    for (const setId of ['openai', 'doubao'] as const) {
      const result = checkText(`画一张${name}的肖像`, setId)
      expect(result.blocked, `${setId} 漏掉 ${name}`).toBe(true)
      expect(result.hits.map((hit) => hit.rule.id), `${setId} 漏掉 ${name}`).toContain(`${setId}-real-person`)
    }
  }
})
