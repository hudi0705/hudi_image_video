// @vitest-environment jsdom
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ApiProfile, AppSettings } from '../types'
import { POLICY_SETS } from '../lib/promptPolicyCheck'
import { buildShotPolicyReport } from '../lib/shotPolicyCheck'
import type { ParsedShot } from '../lib/shotTemplate'
import {
  ShotPolicyBadge,
  ShotPolicyDetail,
  ShotPolicySharedBlock,
  ShotPolicySummary,
} from './ShotPolicyCheckResult'

// AI 深检要联网，测试里整体替换成 mock，只验证按钮状态、请求参数与结果展示
const reviewMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/agentApi', () => ({ callPromptPolicyReviewApi: reviewMock }))

const testProfile = {
  id: 'profile-1',
  name: '测试配置',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4.1-mini',
  timeout: 120,
  apiMode: 'responses',
} as unknown as ApiProfile

const testSettings = {
  profiles: [testProfile],
  activeProfileId: testProfile.id,
} as unknown as AppSettings

function shot(overrides: Partial<ParsedShot> & { index: number }): ParsedShot {
  return { title: `片段 0${overrides.index}`, shot: '', action: '', sound: '', ...overrides }
}

function mount(ui: ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => act(() => root.unmount()),
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text))
}

beforeEach(() => {
  // jsdom 下 React 19 需要显式声明这是 act 环境，否则每个测试都会打一条告警
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  reviewMock.mockReset()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

test('汇总条展示镜头数与风险数，并支持切换规则集', () => {
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '一只皮卡丘站在森林里' })], 'openai')
  const onSwitchSet = vi.fn()
  const { container } = mount(<ShotPolicySummary report={report} onSwitchSet={onSwitchSet} />)

  expect(container.textContent).toContain('已检查 1 个镜头')
  expect(container.textContent).toContain('处风险')
  expect(container.textContent).not.toContain('全部通过')

  const doubaoBtn = buttonByText(container, '豆包')
  expect(doubaoBtn).toBeTruthy()
  act(() => {
    doubaoBtn?.click()
  })
  expect(onSwitchSet).toHaveBeenCalledWith('doubao')
})

test('全部通过时汇总条显示绿色文案', () => {
  const report = buildShotPolicyReport('16:9 横屏', [shot({ index: 1, shot: '木桌上放着一把黄铜钥匙' })], 'openai')
  const { container } = mount(<ShotPolicySummary report={report} onSwitchSet={() => {}} />)
  expect(container.textContent).toContain('全部通过')
  expect(container.textContent).toContain('已检查 1 个镜头')
})

test('镜头徽标无风险显示「通过」，有风险显示命中项数', () => {
  const clean = buildShotPolicyReport('', [shot({ index: 1, shot: '木桌上放着一把黄铜钥匙' })], 'openai')
  const risky = buildShotPolicyReport('', [shot({ index: 1, shot: '一只皮卡丘站在森林里' })], 'openai')

  const cleanView = mount(<ShotPolicyBadge group={clean.shots[0]} />)
  expect(cleanView.container.textContent).toBe('通过')
  cleanView.unmount()

  const riskyView = mount(<ShotPolicyBadge group={risky.shots[0]} />)
  expect(riskyView.container.textContent).toBe(`${risky.shots[0].hits.length} 项`)
  riskyView.unmount()
})

test('统一提示词块标题写明影响全部镜头，并高亮命中原文', () => {
  const report = buildShotPolicyReport('画一张 Taylor Swift 的照片', [
    shot({ index: 1, shot: '木桌' }),
  ], 'openai')
  const shared = report.shared
  expect(shared).not.toBeNull()
  const { container } = mount(
    <ShotPolicySharedBlock
      text={shared!.section.text}
      hits={shared!.result.hits}
      shotCount={2}
    />,
  )
  expect(container.textContent).toContain('统一提示词（影响全部 2 个镜头）')
  expect(container.textContent).toContain('会被拒绝')
  expect(container.querySelector('mark')?.textContent).toBe('Taylor Swift')
})

test('接口配置不全时 AI 按钮禁用，且禁用原因以可见文字展示', () => {
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '一只皮卡丘站在森林里' })], 'openai')
  const noKeyProfile = { ...testProfile, apiKey: '' } as ApiProfile
  const noKeySettings = { profiles: [noKeyProfile], activeProfileId: noKeyProfile.id } as unknown as AppSettings
  const { container } = mount(
    <ShotPolicyDetail
      group={report.shots[0]}
      imagePrompt="一只皮卡丘站在森林里"
      policySet={POLICY_SETS[0]}
      settings={noKeySettings}
      referenceCount={0}
    />,
  )
  const aiBtn = buttonByText(container, 'AI 深检这个镜头')
  expect(aiBtn?.disabled).toBe(true)
  expect(aiBtn?.getAttribute('title')).toContain('文本模型')
  // 触屏/部分浏览器不显示 title，所以原因必须是可见文本
  expect(container.textContent).toContain('文本模型')
})

test('汇总条的两个数字可以互相解释：段命中 + 共多少处', () => {
  // 同一段里同时命中「米老鼠」与「身份证」，命中条目数 2、分段数 1
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '米老鼠拿着一张身份证' })], 'openai')
  expect(report.totalHits).toBe(2)
  expect(report.sectionsWithHits).toBe(1)
  const { container } = mount(<ShotPolicySummary report={report} onSwitchSet={() => {}} />)
  expect(container.textContent).toContain('2 处风险')
  expect(container.textContent).toContain('1 段命中，共 2 处')
})

test('AI 深检发出该镜头拼装后的提示词，并展示模型结论', async () => {
  reviewMock.mockResolvedValue(JSON.stringify({
    risk: 'warn',
    summary: '存在擦边风险',
    items: [{ label: '真实人物指向', severity: 'warn', quote: '演员', reason: '平台禁止真实人物肖像', suggestion: '改成虚构角色' }],
  }))
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '一位演员站在舞台中央' })], 'doubao')
  const { container } = mount(
    <ShotPolicyDetail
      group={report.shots[0]}
      imagePrompt={'16:9 横屏\n一位演员站在舞台中央'}
      policySet={POLICY_SETS[1]}
      settings={testSettings}
      referenceCount={2}
    />,
  )

  const aiBtn = buttonByText(container, 'AI 深检这个镜头')
  expect(aiBtn?.disabled).toBe(false)
  await act(async () => {
    aiBtn?.click()
  })

  expect(reviewMock).toHaveBeenCalledTimes(1)
  const payload = reviewMock.mock.calls[0][0] as { text: string; referenceCount: number; policySet: { id: string } }
  expect(payload.text).toBe('16:9 横屏\n一位演员站在舞台中央')
  expect(payload.referenceCount).toBe(2)
  expect(payload.policySet.id).toBe('doubao')
  expect(container.textContent).toContain('AI 判断：可能被降级')
  expect(container.textContent).toContain('改成虚构角色')
})

test('AI 深检失败时展示真实错误信息，本地命中列表仍然可见', async () => {
  reviewMock.mockRejectedValue(new Error('401 Unauthorized'))
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '一位演员站在舞台中央' })], 'doubao')
  const { container } = mount(
    <ShotPolicyDetail
      group={report.shots[0]}
      imagePrompt="一位演员站在舞台中央"
      policySet={POLICY_SETS[1]}
      settings={testSettings}
      referenceCount={0}
    />,
  )

  await act(async () => {
    buttonByText(container, 'AI 深检这个镜头')?.click()
  })

  const alert = container.querySelector('[role="alert"]')
  expect(alert?.textContent).toContain('401 Unauthorized')
  expect(container.textContent).toContain('会被拒绝')
})

test('AI 条目带 rewrite 时显示复制建议按钮', async () => {
  reviewMock.mockResolvedValue(JSON.stringify({
    risk: 'warn',
    summary: '存在擦边风险',
    items: [{ label: '真实人物指向', severity: 'warn', quote: '演员', reason: '平台禁止真实人物肖像', suggestion: '改成虚构角色', rewrite: '一位虚构角色' }],
  }))
  const report = buildShotPolicyReport('', [shot({ index: 1, shot: '一位演员站在舞台中央' })], 'doubao')
  const { container } = mount(
    <ShotPolicyDetail
      group={report.shots[0]}
      imagePrompt="一位演员站在舞台中央"
      policySet={POLICY_SETS[1]}
      settings={testSettings}
      referenceCount={0}
    />,
  )

  await act(async () => {
    buttonByText(container, 'AI 深检这个镜头')?.click()
  })

  expect(container.textContent).toContain('复制建议')
  expect(container.textContent).toContain('一位虚构角色')
})
