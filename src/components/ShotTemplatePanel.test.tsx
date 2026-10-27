// @vitest-environment jsdom
// 接线层测试：只管「按钮 → 报告 → 渲染」这条链路，规则本身由 shotPolicyCheck.test.ts 覆盖。
// 组件通过 createPortal 渲染到 document.body，所以查询范围是 document.body。
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ApiProfile, AppSettings } from '../types'
import ShotTemplatePanel from './ShotTemplatePanel'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  settings: {} as unknown,
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({
    showToast: mocks.toast,
    params: { n: 1 },
    settings: mocks.settings,
  }),
  submitShotBatch: vi.fn(),
  createInputImageFromFile: vi.fn(),
}))
vi.mock('../lib/db', () => ({ getImage: async () => undefined }))
vi.mock('../lib/imageCache', () => ({ cacheImage: () => {} }))
vi.mock('../lib/agentApi', () => ({ callPromptPolicyReviewApi: vi.fn() }))

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

const RISKY_TEMPLATE = `### 片段 01
镜头：一只皮卡丘站在森林里。

### 片段 02
镜头：一只皮卡丘站在海边。

### 片段 03
镜头：一只皮卡丘站在山顶。`

const SOUND_TEMPLATE = `### 片段 01
镜头：一只皮卡丘站在森林里。
声音：画面里有自杀的字幕提示。`

let roots: Root[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const saved = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  })
  mocks.settings = testSettings
  mocks.toast.mockReset()
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mountPanel() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<ShotTemplatePanel onClose={() => {}} />)
  })
}

/** 受控 textarea 必须走原生 setter + input 事件，React 19 才会收到变更 */
function setValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function textareaByPlaceholder(fragment: string): HTMLTextAreaElement {
  const found = Array.from(document.body.querySelectorAll('textarea')).find((node) => node.placeholder.includes(fragment))
  if (!found) throw new Error(`找不到 placeholder 含「${fragment}」的输入框`)
  return found
}

const templateTextarea = () => textareaByPlaceholder('片段 01')
const sharedPromptTextarea = () => textareaByPlaceholder('所有镜头都会带上这段')

function clickButton(text: string): boolean {
  const button = Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === text)
  if (!button) return false
  act(() => button.click())
  return true
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll('button')).find((node) => node.textContent?.trim() === text)
}

function articleByContent(fragment: string): HTMLElement {
  const found = Array.from(document.body.querySelectorAll('article')).find((node) => node.textContent?.includes(fragment))
  if (!found) throw new Error(`找不到包含「${fragment}」的镜头卡片`)
  return found
}

test('无镜头且无统一提示词时检查按钮禁用，填了模板后可用', async () => {
  await mountPanel()
  const checkButton = buttonByText('检查提示词')
  expect(checkButton).toBeTruthy()
  expect(checkButton?.disabled).toBe(true)

  setValue(templateTextarea(), '镜头：一只猫坐在窗台上。')
  expect(buttonByText('检查提示词')?.disabled).toBe(false)
})

test('点检查出现汇总条与徽标，收起后全部消失', async () => {
  await mountPanel()
  setValue(templateTextarea(), RISKY_TEMPLATE)

  expect(document.body.textContent).not.toContain('已检查')
  clickButton('检查提示词')

  expect(document.body.textContent).toContain('已检查 3 个镜头')
  expect(buttonByText('查看 2 项') || buttonByText('查看 1 项')).toBeTruthy()

  clickButton('收起检查结果')

  expect(document.body.textContent).not.toContain('已检查')
  expect(document.body.textContent).not.toContain('通过')
  expect(Array.from(document.body.querySelectorAll('button')).some((node) => node.textContent?.startsWith('查看'))).toBe(false)
})

test('切换规则集后用同一段文本重算，结论随规则集变化', async () => {
  await mountPanel()
  setValue(templateTextarea(), '### 片段 01\n镜头：一位演员站在舞台中央。')
  clickButton('检查提示词')

  // OpenAI 规则里「演员」不是命中词
  expect(document.body.textContent).toContain('全部通过')
  expect(Array.from(document.body.querySelectorAll('button')).some((node) => node.textContent?.startsWith('查看'))).toBe(false)

  clickButton('豆包')

  // 豆包把「演员」判定为真实人物肖像风险
  expect(document.body.textContent).not.toContain('全部通过')
  expect(document.body.textContent).toContain('处风险')
  expect(Array.from(document.body.querySelectorAll('button')).some((node) => node.textContent?.startsWith('查看'))).toBe(true)
})

test('展开状态跟随镜头内容，前面的镜头被删掉也不会错位到别的镜头', async () => {
  await mountPanel()
  setValue(templateTextarea(), RISKY_TEMPLATE)
  clickButton('检查提示词')

  // 展开第 3 个镜头（片段 03 · 山顶）
  const opened = Array.from(articleByContent('山顶').querySelectorAll('button')).find((node) => node.textContent?.startsWith('查看'))
  expect(opened).toBeTruthy()
  act(() => opened?.click())
  expect(articleByContent('山顶').textContent).toContain('收起详情')

  // 删掉「片段 01」，导致后面的镜头整体前移一位
  setValue(templateTextarea(), `### 片段 02
镜头：一只皮卡丘站在海边。

### 片段 03
镜头：一只皮卡丘站在山顶。`)

  const articles = Array.from(document.body.querySelectorAll('article'))
  expect(articles).toHaveLength(2)
  // 展开的还是「山顶」那一张，没有串到「海边」
  expect(articleByContent('山顶').textContent).toContain('收起详情')
  expect(articleByContent('海边').textContent).toContain('查看')
  expect(articleByContent('海边').textContent).not.toContain('收起详情')
})

test('音频行只在检查开启后标注「未检查」', async () => {
  await mountPanel()
  setValue(templateTextarea(), SOUND_TEMPLATE)

  expect(document.body.textContent).toContain('音频：')
  expect(document.body.textContent).not.toContain('未检查')

  clickButton('检查提示词')
  expect(document.body.textContent).toContain('未检查')

  clickButton('收起检查结果')
  expect(document.body.textContent).not.toContain('未检查')
})

test('无风险的镜头只显示通过徽标，不出现展开入口', async () => {
  await mountPanel()
  setValue(templateTextarea(), '### 片段 01\n镜头：木桌上放着一把黄铜钥匙。')
  clickButton('检查提示词')

  expect(document.body.textContent).toContain('全部通过')
  expect(articleByContent('黄铜钥匙').textContent).toContain('通过')
  expect(articleByContent('黄铜钥匙').textContent).not.toContain('查看')
  expect(articleByContent('黄铜钥匙').className).not.toContain('bg-red-50')
})
