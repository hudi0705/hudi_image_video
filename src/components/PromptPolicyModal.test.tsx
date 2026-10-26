// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { ApiProfile, AppSettings } from '../types'
import PromptPolicyModal from './PromptPolicyModal'

// AI 检查要联网，测试里整体替换成 mock，只验证交互与展示
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
  codexCli: false,
  apiProxy: false,
  transparentBackgroundMethod: 'api',
} as unknown as ApiProfile

const testSettings = {
  profiles: [testProfile],
  activeProfileId: testProfile.id,
} as unknown as AppSettings

afterEach(() => {
  vi.unstubAllGlobals()
  reviewMock.mockReset()
  document.body.innerHTML = ''
})

// 组件通过 createPortal 渲染到 body，所以查询范围必须是 document.body 而不是挂载容器
function mount(ui: React.ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { unmount: () => { act(() => root.unmount()); container.remove() } }
}

function buttonByText(text: string) {
  return [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === text)
}

test('打开后带入输入框的提示词，并展示两套规则入口', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const onClose = vi.fn()
  const view = mount(<PromptPolicyModal prompt="清晨的山谷与雪山" referenceCount={0} onClose={onClose} />)
  try {
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('清晨的山谷与雪山')
    expect(document.body.textContent).toContain('OpenAI 图像生成规则')
    expect(document.body.textContent).toContain('豆包（火山方舟）内容安全规则')
    expect(onClose).not.toHaveBeenCalled()
  } finally {
    view.unmount()
  }
})

test('干净提示词检查后给出未命中结论', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="一只橘猫趴在窗台上晒太阳" referenceCount={0} onClose={vi.fn()} />)
  try {
    act(() => { buttonByText('开始检查')!.click() })
    expect(document.body.textContent).toContain('没有命中规则库里的违规特征')
  } finally {
    view.unmount()
  }
})

test('违规提示词逐条列出原因与建议', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="画一张 Taylor Swift 的演唱会照片" referenceCount={0} onClose={vi.fn()} />)
  try {
    act(() => { buttonByText('开始检查')!.click() })
    const text = document.body.textContent || ''
    expect(text).toContain('会被拒绝')
    expect(text).toContain('真实公众人物姓名')
    expect(text).toContain('原因：')
    expect(text).toContain('建议：')
    const marks = document.body.querySelectorAll('mark')
    expect(marks).toHaveLength(1)
    expect(marks[0].textContent).toBe('Taylor Swift')
  } finally {
    view.unmount()
  }
})

test('切换到豆包规则后重新计算，结果不同', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="宫崎骏风格的山林" referenceCount={0} onClose={vi.fn()} />)
  try {
    act(() => { buttonByText('开始检查')!.click() })
    expect(document.body.textContent).toContain('在世艺术家风格')

    act(() => { buttonByText('豆包（火山方舟）内容安全规则')!.click() })
    expect(document.body.textContent).toContain('没有命中规则库里的违规特征')
    expect(document.body.textContent).toContain('豆包模型服务协议')
  } finally {
    view.unmount()
  }
})

test('有参考图时展示图片风险提示', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="把参考图里的人换成古装" referenceCount={2} onClose={vi.fn()} />)
  try {
    act(() => { buttonByText('开始检查')!.click() })
    expect(document.body.textContent).toContain('参考图风险')
    expect(document.body.textContent).toContain('已附带 2 张参考图')
  } finally {
    view.unmount()
  }
})

test('空提示词时检查按钮禁用', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="   " referenceCount={0} onClose={vi.fn()} />)
  try {
    expect(buttonByText('开始检查')!.disabled).toBe(true)
  } finally {
    view.unmount()
  }
})

test('修改文本后清空旧结果', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="皮卡丘" referenceCount={0} onClose={vi.fn()} />)
  try {
    act(() => { buttonByText('开始检查')!.click() })
    expect(document.body.textContent).toContain('知名 IP / 商标角色')

    const textarea = document.body.querySelector('textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '一座海边的灯塔')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.body.textContent).not.toContain('知名 IP / 商标角色')
    expect(document.body.textContent).toContain('选择规则后点「开始检查」')
  } finally {
    view.unmount()
  }
})

test('没有可用接口配置时 AI 深度检查按钮禁用', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const view = mount(<PromptPolicyModal prompt="一座海边的灯塔" referenceCount={0} onClose={vi.fn()} />)
  try {
    const button = buttonByText('AI 深度检查') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('title')).toContain('API Key')
  } finally {
    view.unmount()
  }
})

test('配置缺 apiKey 时 AI 深度检查按钮禁用', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const noKeyProfile = { ...testProfile, apiKey: '' } as ApiProfile
  const view = mount(
    <PromptPolicyModal prompt="一座海边的灯塔" referenceCount={0} settings={testSettings} profile={noKeyProfile} onClose={vi.fn()} />,
  )
  try {
    expect((buttonByText('AI 深度检查') as HTMLButtonElement).disabled).toBe(true)
  } finally {
    view.unmount()
  }
})

test('AI 结果出现后自动滚进结果区可视范围', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockResolvedValue('{"risk":"block","summary":"会被拒绝","items":[]}')
  // jsdom 没有实现 scrollIntoView，这里临时补一个探针验证滚动调用
  const proto = Element.prototype as unknown as Record<string, unknown>
  const original = proto.scrollIntoView
  const scrollSpy = vi.fn()
  proto.scrollIntoView = scrollSpy
  const view = mount(
    <PromptPolicyModal prompt="一座海边的灯塔" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    await act(async () => { buttonByText('AI 深度检查')!.click() })
    // 滚动发生在 requestAnimationFrame 回调里，等一帧再断言
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)) })
    expect(scrollSpy).toHaveBeenCalled()
  } finally {
    proto.scrollIntoView = original
    view.unmount()
  }
})

test('AI 返回全空条目时给出兜底说明而不是空白面板', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockResolvedValue('{"risk":"warn","summary":"","items":[{},null]}')
  const view = mount(
    <PromptPolicyModal prompt="两个人在昏暗的房间里靠得很近" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    await act(async () => { buttonByText('AI 深度检查')!.click() })
    const text = document.body.textContent || ''
    // 有结论：保留 warn 徽标
    expect(text).toContain('AI 判断：可能被降级')
    // 有依据的替代说明：解释为什么没有条目，并给出下一步
    expect(text).toContain('没有返回具体风险条目')
    expect(text).toContain('重试')
    // 不渲染任何空卡片：既没有等级标签，也没有原因/建议行
    expect(text).not.toContain('可能被拦')
    expect(text).not.toContain('原因：')
    expect(text).not.toContain('建议：')
    expect(document.body.querySelectorAll('mark')).toHaveLength(0)
  } finally {
    view.unmount()
  }
})

test('AI 深度检查成功后展示结果区与等级徽标', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockResolvedValue(JSON.stringify({
    risk: 'block',
    summary: '指向真实人物，会被直接拒绝',
    items: [
      { label: '真实人物指向', severity: 'block', quote: 'Taylor Swift', reason: '平台禁止生成可识别真实人物', suggestion: '改为虚构歌手' },
    ],
  }))
  const view = mount(
    <PromptPolicyModal prompt="画一张 Taylor Swift 的演唱会照片" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    await act(async () => { buttonByText('AI 深度检查')!.click() })
    const text = document.body.textContent || ''
    expect(reviewMock).toHaveBeenCalledTimes(1)
    expect(text).toContain('AI 深度检查结果')
    expect(text).toContain('AI 判断：可能被拒绝')
    expect(text).toContain('指向真实人物，会被直接拒绝')
    expect(text).toContain('真实人物指向')
    expect(text).toContain('改为虚构歌手')
    const marks = [...document.body.querySelectorAll('mark')].map((mark) => mark.textContent)
    expect(marks).toContain('Taylor Swift')
  } finally {
    view.unmount()
  }
})

test('AI 判定安全且无条目时给出语义层无风险结论', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockResolvedValue('{"risk":"safe","summary":"没有语义层风险","items":[]}')
  const view = mount(
    <PromptPolicyModal prompt="一只橘猫趴在窗台上晒太阳" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    await act(async () => { buttonByText('AI 深度检查')!.click() })
    const text = document.body.textContent || ''
    expect(text).toContain('AI 判断：可提交')
    expect(text).toContain('AI 也未发现语义层风险')
  } finally {
    view.unmount()
  }
})

test('AI 检查失败时显示错误且保留本地结果', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockRejectedValue(new Error('接口返回 500'))
  const view = mount(
    <PromptPolicyModal prompt="皮卡丘" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    act(() => { buttonByText('开始检查')!.click() })
    expect(document.body.textContent).toContain('知名 IP / 商标角色')

    await act(async () => { buttonByText('AI 深度检查')!.click() })
    const text = document.body.textContent || ''
    expect(text).toContain('接口返回 500')
    expect(text).toContain('重试')
    // 本地结果不能被 AI 失败影响
    expect(text).toContain('知名 IP / 商标角色')
    // 失败后按钮恢复可点，允许重试
    expect((buttonByText('AI 深度检查') as HTMLButtonElement).disabled).toBe(false)
  } finally {
    view.unmount()
  }
})

test('修改文本后清空 AI 结果', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reviewMock.mockResolvedValue('{"risk":"warn","summary":"气氛暧昧","items":[]}')
  const view = mount(
    <PromptPolicyModal prompt="两个人在昏暗的房间里靠得很近" referenceCount={0} settings={testSettings} profile={testProfile} onClose={vi.fn()} />,
  )
  try {
    await act(async () => { buttonByText('AI 深度检查')!.click() })
    expect(document.body.textContent).toContain('气氛暧昧')

    const textarea = document.body.querySelector('textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '一座海边的灯塔')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.body.textContent).not.toContain('气氛暧昧')
    expect(document.body.textContent).not.toContain('AI 深度检查结果')
  } finally {
    view.unmount()
  }
})
