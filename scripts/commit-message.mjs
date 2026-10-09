// 提交信息的中文格式规范与校验，供 scripts/commit.mjs 使用
// 规范来源：本仓库既有历史提交与 RELEASE.md 的写法

// 允许的提交类型（冒号前的前缀），均为仓库既有用法
const TYPES = {
  feat: '新增功能',
  fix: '缺陷修复',
  docs: '文档变更',
  style: '代码格式调整',
  refactor: '代码重构',
  perf: '性能优化',
  test: '测试相关',
  build: '构建或依赖调整',
  ci: '持续集成调整',
  chore: '杂项事务',
  revert: '回滚提交',
}

// 类型白名单，校验时使用
const TYPE_NAMES = Object.keys(TYPES)

// 半角标点 -> 全角标点，正文一律使用中文标点
const PUNCT_MAP = {
  ',': '，',
  ';': '；',
  ':': '：',
  '?': '？',
  '!': '！',
  '(': '（',
  ')': '）',
  '<': '《',
  '>': '》',
}

// 保留半角横线、点号、斜杠和反引号：它们用于编号、路径、版本号与代码标记
const KEEP_HALF_WIDTH = /[-./`\\@#%&+*=~^"'[\]{}|_$]/

// 主题行前缀，形如 "feat: " 或 "fix(scope): "
const SUBJECT_RE = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/

// 形如 a:b 的 ASCII 片段（命令、标识符、时间等）整体保留，避免其中的冒号被误转
const ASCII_TOKEN_RE = /[A-Za-z0-9_.\-/]*(?::[A-Za-z0-9_.\-/*]+)+/g

// 转换单个字符：已保留的半角字符原样返回，其余按映射表替换
export function toFullWidthPunctuation(text) {
  // 先保护 ASCII 片段（如 commit:list、10:30），占位后再逐字转换
  const tokens = []
  const guarded = String(text ?? '').replace(ASCII_TOKEN_RE, (match) => {
    tokens.push(match)
    return `\u0000${tokens.length - 1}\u0000`
  })

  const converted = Array.from(guarded)
    .map((ch) => {
      if (KEEP_HALF_WIDTH.test(ch)) return ch
      return PUNCT_MAP[ch] ?? ch
    })
    .join('')

  // 还原被保护的片段
  return converted.replace(/\u0000(\d+)\u0000/g, (_, idx) => tokens[Number(idx)])
}

// 去掉首尾空白，并把连续的空白折叠为单个空格
export function tidy(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 解析提交信息为结构化对象，格式不合法时返回 null
export function parseCommitMessage(message) {
  const lines = String(message ?? '').split('\n')
  const subject = tidy(lines[0] ?? '')
  if (!subject) return null

  const match = subject.match(SUBJECT_RE)
  if (!match) return null

  const type = match[1]
  const scope = match[2] ? tidy(match[2]) : ''
  const description = tidy(match[3])

  // 正文：第一行之后的内容，去掉首尾空行
  const bodyLines = lines.slice(1)
  while (bodyLines.length && !tidy(bodyLines[0])) bodyLines.shift()
  while (bodyLines.length && !tidy(bodyLines[bodyLines.length - 1])) bodyLines.pop()

  return { type, scope, description, bodyLines }
}

// 校验提交信息，返回问题列表；列表为空表示通过
export function validateCommitMessage(message, opts = {}) {
  const issues = []
  const parsed = parseCommitMessage(message)

  if (!parsed) {
    issues.push('主题行需为「类型: 中文描述」或「类型(范围): 中文描述」格式，例如「feat: 新增批量提交」。')
    return issues
  }

  if (!TYPE_NAMES.includes(parsed.type)) {
    issues.push(`提交类型「${parsed.type}」不在允许范围内，可用：${TYPE_NAMES.join('、')}。`)
  }

  if (!parsed.description) {
    issues.push('冒号后需要填写中文描述。')
  } else {
    if (!/[\u4e00-\u9fa5]/.test(parsed.description)) {
      issues.push('主题描述需包含中文，不能只用英文或符号。')
    }
    if (/[.,;:!?()]/.test(parsed.description)) {
      issues.push('主题描述中存在半角标点，请改用中文标点。')
    }
    if (/[。；！？]$/.test(parsed.description)) {
      issues.push('主题描述末尾不要加句号或感叹号，保持一行紧凑表述。')
    }
    if (parsed.description.length > 60) {
      issues.push(`主题描述过长（${parsed.description.length} 字），建议控制在 60 字以内。`)
    }
  }

  const minBodyLines = opts.minBodyLines ?? 0
  if (parsed.bodyLines.length < minBodyLines) {
    const diff = minBodyLines - parsed.bodyLines.length
    issues.push(`正文至少需要 ${minBodyLines} 条要点，当前还缺 ${diff} 条。`)
  }

  for (const line of parsed.bodyLines) {
    const text = tidy(line)
    if (!text) {
      issues.push('正文中存在空行，请删除多余空行。')
      continue
    }
    if (!text.startsWith('- ')) {
      issues.push(`正文「${text}」需以「- 」开头，每条要点单独一行。`)
      continue
    }
    const item = text.slice(2).trim()
    if (!item) {
      issues.push('正文中存在内容为空的要点。')
      continue
    }
    if (!/[\u4e00-\u9fa5]/.test(item)) {
      issues.push(`要点「${item}」需使用中文描述。`)
    }
    if (/[.,;:!?]/.test(item)) {
      issues.push(`要点「${item}」中存在半角标点，请改用中文标点。`)
    }
    if (/[。；！？]$/.test(item)) {
      issues.push(`要点「${item}」末尾不要加句号，保持通顺的一句表述。`)
    }
  }

  return issues
}

// 组装最终提交信息：主题行 + 空行 + 正文
export function formatCommitMessage({ type, scope, description, body }) {
  const head = scope ? `${type}(${scope}): ${description}` : `${type}: ${description}`
  const items = (body ?? [])
    .map((line) => tidy(line))
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? line : `- ${line}`))

  if (!items.length) return head
  return `${head}\n\n${items.join('\n')}`
}

// 一次完成规范化与校验，返回结果与问题列表
export function normalizeAndValidate({ type, scope, description, body }, opts = {}) {
  const cleanDescription = toFullWidthPunctuation(tidy(description))
  const cleanBody = (body ?? [])
    .map((line) => tidy(line).replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .map((line) => `- ${toFullWidthPunctuation(line)}`)

  const message = formatCommitMessage({
    type: tidy(type),
    scope: tidy(scope),
    description: cleanDescription,
    body: cleanBody,
  })

  return { message, issues: validateCommitMessage(message, opts) }
}

export { TYPES, TYPE_NAMES }
