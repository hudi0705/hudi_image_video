import { describe, expect, it } from 'vitest'
import { buildTopicResearchInput, buildTopicResearchInstructions, groundTopicResearchResult, parseTopicResearchResult } from './topicResearch'

describe('parseTopicResearchResult', () => {
  it('解析正常结果并按 fit 降序排列', () => {
    const raw = JSON.stringify({
      note: '抖音热榜偏娱乐，B站科技区线索更足',
      topics: [
        { title: '钠电池上车', platforms: ['B站', 'bilibili'], heat: 'B站热门第 8', fit: 3, angle: '为什么便宜电池先上两轮车', reason: '有机制', keywords: ['钠电池'], source: '' },
        { title: '血氧仪抢购', platforms: ['抖音', '小红书'], heat: '抖音热榜第 12 位', fit: 5, angle: '血氧数值到底在测什么', reason: '能画原理图', keywords: [], source: 'https://example.com/a' },
      ],
    })
    const result = parseTopicResearchResult(raw)
    expect(result.note).toContain('B站')
    expect(result.topics.map((topic) => topic.title)).toEqual(['血氧仪抢购', '钠电池上车'])
    // 「bilibili」和「B站」是同一个平台，去重后只剩一条
    expect(result.topics[1].platforms).toEqual(['B站'])
  })

  it('容错：围栏、脏字段、重复标题、缺标题', () => {
    const raw = '\u0060\u0060\u0060json\n' + JSON.stringify({
      topics: [
        { title: '同一个词条', fit: 9, platforms: ['微博', '抖音'] },
        { title: '同一个词条', fit: 2 },
        { title: '   ', fit: 4 },
        { fit: 4 },
      ],
    }) + '\n\u0060\u0060\u0060'
    const result = parseTopicResearchResult(raw)
    expect(result.topics).toHaveLength(1)
    // fit 超出范围要夹回 1-5，认不出的平台丢掉
    expect(result.topics[0].fit).toBe(5)
    expect(result.topics[0].platforms).toEqual(['抖音'])
    expect(result.note).toBe('')
  })

  it('空输出直接报错，并说明可能的原因', () => {
    expect(() => parseTopicResearchResult('   ')).toThrow('选题返回格式无效')
  })

  it('模型只回了解释文字时当作说明展示，不报错', () => {
    const result = parseTopicResearchResult('本次未能获取真实热度线索：当前会话没有可用的联网搜索通道。')
    expect(result.topics).toEqual([])
    expect(result.note).toContain('联网搜索通道')
  })

  it('JSON 被截断时报错，而不是把半截 JSON 塞进说明', () => {
    expect(() => parseTopicResearchResult('{"note":"搜到了","topics":[{"title":"钠电池')).toThrow('选题返回格式无效')
  })
})

describe('buildTopicResearchInput', () => {
  it('方向为空时退回泛热榜，平台与条数照写', () => {
    const input = buildTopicResearchInput('  ', ['抖音', 'B站'], 9)
    expect(input).toContain('泛热榜')
    expect(input).toContain('抖音、B站')
    expect(input).toContain('需要条数：9')
  })

  it('带方向时原样带进提示', () => {
    expect(buildTopicResearchInput('台风的路径怎么算', ['小红书'], 6)).toContain('方向：台风的路径怎么算')
  })
})

describe('热榜数据筛选', () => {
  it('附带热榜时不再要求模型自行联网', () => {
    expect(buildTopicResearchInstructions(true)).toContain('不需要调用联网工具')
    expect(buildTopicResearchInstructions(true)).not.toContain('每个平台至少搜两次')
  })

  it('过滤虚构词条并从真实数据回填平台、热度和来源，遵守条数', () => {
    const parsed = parseTopicResearchResult(JSON.stringify({ note: '选题说明', topics: [
      { title: '虚构热搜', fit: 5 },
      { title: '钠电池上车', fit: 4, platforms: ['B站'], heat: '全网第一', source: 'https://fake.example' },
      { title: '海鸥雨', fit: 3 },
    ] }))
    const result = groundTopicResearchResult(parsed, [
      { title: '钠电池上车', platform: '抖音', heat: '抖音热榜第 12 位', source: 'https://www.douyin.com/search/test' },
      { title: '钠电池上车', platform: '小红书', heat: '小红书热榜第 3 位', source: '' },
      { title: '海鸥雨', platform: '小红书', heat: '小红书热榜第 4 位', source: '' },
    ], 1)

    expect(result.topics).toHaveLength(1)
    expect(result.topics[0]).toMatchObject({ title: '钠电池上车', platforms: ['抖音', '小红书'], heat: '抖音热榜第 12 位；小红书热榜第 3 位', source: 'https://www.douyin.com/search/test' })
    expect(result.note).toBe('选题说明')
  })
})
