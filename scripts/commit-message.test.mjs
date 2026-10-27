import { describe, it, expect } from 'vitest'
import {
  toFullWidthPunctuation,
  tidy,
  parseCommitMessage,
  validateCommitMessage,
  formatCommitMessage,
  normalizeAndValidate,
} from './commit-message.mjs'

describe('toFullWidthPunctuation', () => {
  it('把半角标点转为中文标点', () => {
    expect(toFullWidthPunctuation('新增导出,支持批量(含视频)')).toBe('新增导出，支持批量（含视频）')
  })

  it('保留路径与版本号里的半角符号', () => {
    expect(toFullWidthPunctuation('更新 src/lib/db.ts 与 v0.7.17')).toBe('更新 src/lib/db.ts 与 v0.7.17')
  })

  it('保留反引号代码标记', () => {
    expect(toFullWidthPunctuation('默认模型改为 `gpt-6.1-sol`')).toBe('默认模型改为 `gpt-6.1-sol`')
  })

  it('保留命令与标识符里的冒号', () => {
    expect(toFullWidthPunctuation('新增 commit:list 命令入口')).toBe('新增 commit:list 命令入口')
  })

  it('保留时间等带冒号的 ASCII 片段', () => {
    expect(toFullWidthPunctuation('每天 09:30 执行,超时 10:00 结束')).toBe('每天 09:30 执行，超时 10:00 结束')
  })

  it('中文分句的冒号仍转为全角', () => {
    expect(toFullWidthPunctuation('说明:新增导出')).toBe('说明：新增导出')
  })
})

describe('tidy', () => {
  it('去除首尾空白并折叠连续空格', () => {
    expect(tidy('  新增  批量提交  ')).toBe('新增 批量提交')
  })

  it('空值返回空字符串', () => {
    expect(tidy(undefined)).toBe('')
  })
})

describe('parseCommitMessage', () => {
  it('解析带类型的主题与正文', () => {
    const parsed = parseCommitMessage('fix: 修正重试时序\n\n- 修复时间戳错乱\n- 补充测试')
    expect(parsed.type).toBe('fix')
    expect(parsed.scope).toBe('')
    expect(parsed.description).toBe('修正重试时序')
    expect(parsed.bodyLines).toEqual(['- 修复时间戳错乱', '- 补充测试'])
  })

  it('解析带范围的主题', () => {
    const parsed = parseCommitMessage('feat(设置): 新增重试方式')
    expect(parsed.type).toBe('feat')
    expect(parsed.scope).toBe('设置')
  })

  it('格式不合法时返回 null', () => {
    expect(parseCommitMessage('随便写一句提交说明')).toBeNull()
  })
})

describe('validateCommitMessage', () => {
  it('通过规范的提交信息', () => {
    const message = 'feat: 新增批量提交\n\n- 支持一次提交多条提示词\n- 输入栏宽度随参数自适应'
    expect(validateCommitMessage(message)).toEqual([])
  })

  it('拒绝未知类型', () => {
    const issues = validateCommitMessage('feature: 新增功能')
    expect(issues.join('\n')).toContain('不在允许范围内')
  })

  it('拒绝缺少中文描述的主题', () => {
    const issues = validateCommitMessage('feat: add batch submit')
    expect(issues.join('\n')).toContain('需包含中文')
  })

  it('拒绝主题里的半角标点', () => {
    const issues = validateCommitMessage('feat: 新增导出,支持批量')
    expect(issues.join('\n')).toContain('半角标点')
  })

  it('拒绝主题末尾的句号', () => {
    const issues = validateCommitMessage('feat: 新增批量提交。')
    expect(issues.join('\n')).toContain('末尾不要加句号')
  })

  it('拒绝未以「- 」开头的正文', () => {
    const issues = validateCommitMessage('feat: 新增功能\n\n支持批量提交')
    expect(issues.join('\n')).toContain('需以「- 」开头')
  })

  it('拒绝正文要点末尾的句号', () => {
    const issues = validateCommitMessage('fix: 修正时序\n\n- 修复时间戳错乱。')
    expect(issues.join('\n')).toContain('末尾不要加句号')
  })

  it('按 minBodyLines 要求正文条数', () => {
    const issues = validateCommitMessage('feat: 新增功能\n\n- 只有一条', { minBodyLines: 2 })
    expect(issues.join('\n')).toContain('至少需要 2 条要点')
  })
})

describe('formatCommitMessage', () => {
  it('组装主题与正文', () => {
    expect(formatCommitMessage({ type: 'feat', description: '新增导出', body: ['支持 PNG', '- 支持 JPG'] })).toBe(
      'feat: 新增导出\n\n- 支持 PNG\n- 支持 JPG',
    )
  })

  it('无正文时只返回主题行', () => {
    expect(formatCommitMessage({ type: 'chore', description: '忽略本地目录' })).toBe('chore: 忽略本地目录')
  })
})

describe('normalizeAndValidate', () => {
  it('自动修正标点后再校验', () => {
    const result = normalizeAndValidate({
      type: 'feat',
      description: '新增导出,支持批量(含视频)',
      body: ['支持 PNG 与 JPG', '导出保留原文件夹'],
    })
    expect(result.message).toContain('新增导出，支持批量（含视频）')
    expect(result.issues).toEqual([])
  })
})
