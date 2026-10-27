#!/usr/bin/env node
// 业务代码提交脚本：文件暂存 -> 状态检查 -> 提交
// 提交信息遵循中文格式规范，见 scripts/commit-message.mjs
//
// 用法：
//   node scripts/commit.mjs -t feat -m "新增导出功能" -b "支持 PNG 与 JPG" -b "导出保留原文件夹"
//   node scripts/commit.mjs --staged-only -t fix -m "修正时序" --no-verify
//   node scripts/commit.mjs --list
//   node scripts/commit.mjs --dry-run -t docs -m "更新说明"
//
// 说明：默认显式暂存本次涉及的文件，不使用 `git add -A`，
// 避免把工作区里未完成的改动一并提交。

import { spawnSync } from 'node:child_process'
import { normalizeAndValidate, TYPE_NAMES, TYPES } from './commit-message.mjs'

// 子命令执行器：默认继承标准输入输出，便于查看进度
function git(args, opts = {}) {
  const result = spawnSync('git', args, {
    stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  return result
}

// 捕获式执行，成功返回标准输出，失败返回 null
// 保留原始输出：状态行以空格开头有意义（如「 M 文件」），不能用 trim 破坏首行
function gitOutRaw(args) {
  const result = git(args, { capture: true })
  if (result.status !== 0) return null
  return result.stdout ?? ''
}

// 捕获式执行并去掉首尾空白，适用于单行或多行纯文本结果
function gitOut(args) {
  const out = gitOutRaw(args)
  if (out === null) return null
  return out.replace(/\r\n/g, '\n').trim()
}

const USAGE = `
业务代码提交脚本（提交信息使用中文规范）

用法：
  node scripts/commit.mjs [选项]

选项：
  -t, --type <类型>       提交类型，必填。可用：${TYPE_NAMES.join('、')}
  -s, --scope <范围>      可选范围，写入「类型(范围): 描述」
  -m, --message <描述>    中文描述，必填
  -b, --body <要点>       正文要点，可重复传入；编写时用「,」分隔分句
  -f, --file <路径>       本次提交的文件，可重复传入；默认取工作区全部改动
      --staged-only       只提交已暂存的改动，不自动暂存其余文件
      --allow-empty-body  允许没有正文要点
      --skip-tests        跳过提交前的 npm test
      --require-tests     测试未通过时中止提交（默认仅提示）
      --no-verify         提交时跳过 git 钩子校验
      --dry-run           只展示将要提交的内容，不真正提交
  -l, --list              查看当前工作区状态后退出
  -h, --help              显示本帮助

示例：
  node scripts/commit.mjs -t feat -m "新增批量提交" -b "支持一次提交多条提示词" -b "输入栏宽度自适应"
  node scripts/commit.mjs -t fix -s 重试 -m "修正重试时序" -b "修复时间戳错乱"
`

// 解析命令行参数，未知选项直接报错退出，避免静默忽略
function parseArgs(argv) {
  const opts = { type: '', scope: '', message: '', body: [], files: [], flags: {} }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const needValue = (name) => {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`选项 ${name} 缺少参数值`)
      }
      return value
    }

    switch (arg) {
      case '-t':
      case '--type':
        opts.type = needValue(arg)
        break
      case '-s':
      case '--scope':
        opts.scope = needValue(arg)
        break
      case '-m':
      case '--message':
        opts.message = needValue(arg)
        break
      case '-b':
      case '--body':
        opts.body.push(needValue(arg))
        break
      case '-f':
      case '--file':
        opts.files.push(needValue(arg))
        break
      case '--staged-only':
      case '--allow-empty-body':
      case '--skip-tests':
      case '--require-tests':
      case '--no-verify':
      case '--dry-run':
      case '--list':
      case '-l':
      case '--help':
      case '-h':
        opts.flags[arg.replace(/^--?/, '')] = true
        break
      default:
        throw new Error(`无法识别的选项：${arg}`)
    }
  }

  return opts
}

// 确认当前目录在 git 仓库内
function ensureRepo() {
  const root = gitOut(['rev-parse', '--show-toplevel'])
  if (!root) {
    console.error('错误：当前目录不在 git 仓库中，请先进入项目根目录。')
    process.exit(1)
  }
  return root
}

// 列出工作区改动，返回 [{ status, path }, ...]
// status --porcelain 每行格式为「XY 路径」：XY 占两列，其后一个空格，再接路径
function listChanges() {
  const out = gitOutRaw(['status', '--porcelain'])
  if (!out) return []

  return out
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      // 前两列为状态码，部分行首列可能是空格，统一从第 3 个字符起取路径
      const status = line.slice(0, 2).trim() || '??'
      const path = line.slice(3).replace(/^"|"$/g, '')
      return { status, path }
    })
    .filter((item) => item.path)
}

const STATUS_LABEL = {
  M: '已修改',
  A: '已新增',
  D: '已删除',
  R: '已重命名',
  C: '已复制',
  '??': '未跟踪',
  UU: '冲突',
  U: '冲突',
}

// 打印工作区状态，返回改动列表
function printStatus(changes) {
  if (!changes.length) {
    console.log('\n工作区干净，没有需要提交的改动。')
    return changes
  }

  console.log('\n当前工作区改动：')
  for (const item of changes) {
    const label = STATUS_LABEL[item.status] ?? item.status
    console.log(`  [${label}] ${item.path}`)
  }
  console.log(`\n共 ${changes.length} 处改动。`)
  return changes
}

// 从工作区自动挑选本次提交的文件，显式列出以避开 `git add -A`
function pickFiles(changes) {
  return changes.map((item) => item.path)
}

// 暂存指定文件，返回是否全部成功
function stageFiles(files, dryRun) {
  if (!files.length) {
    console.log('没有需要暂存的文件。')
    return false
  }

  // 试运行只打印将要执行的命令，不做实际暂存，也不据此判定成败
  if (dryRun) {
    files.forEach((file) => console.log(`  [试运行] git add -- ${file}`))
    console.log(`\n[试运行] 将暂存 ${files.length} 个文件。`)
    return true
  }

  // 分条暂存：某个路径被 .gitignore 忽略时只跳过该条，不影响其余文件
  for (const file of files) {
    const result = git(['add', '--', file])
    if (result.status !== 0) {
      console.error(`暂存失败：${file}，请检查该路径是否被 .gitignore 忽略或是否存在。`)
      return false
    }
  }

  const staged = gitOut(['diff', '--cached', '--name-only'])
  const count = staged ? staged.split('\n').filter(Boolean).length : 0
  console.log(`\n已暂存 ${count} 个文件。`)
  return count > 0
}

// 提交前跑一次测试。默认只提示、不拦截：
// 本仓库部分测试依赖本地 Chromium 与网络，环境缺失时会超时失败，
// 若强制拦截会导致任何提交都无法完成。需要严格校验时加 --require-tests。
function runTests(flags) {
  if (flags['skip-tests']) {
    console.log('\n已跳过测试（--skip-tests）。')
    return true
  }

  console.log('\n运行测试 npm test ...')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['test'], { stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' })
  const passed = !result.error && result.status === 0

  if (passed) {
    console.log('\n测试通过。')
    return true
  }

  if (flags['require-tests']) {
    console.error('\n测试未通过，已按 --require-tests 中止提交。')
    return false
  }

  console.warn('\n注意：测试未全部通过，已按默认策略继续提交。')
  console.warn('如依赖本地 Chromium 的用例失败，可先运行 npm run doubao:install。')
  console.warn('需要严格拦截时请使用 --require-tests。')
  return true
}

// 生成并校验提交信息，校验不通过时打印问题清单
function buildMessage(opts) {
  const { message, issues } = normalizeAndValidate(
    { type: opts.type, scope: opts.scope, description: opts.message, body: opts.body },
    { minBodyLines: opts.flags['allow-empty-body'] ? 0 : 1 },
  )

  if (issues.length) {
    console.error('\n提交信息不符合中文格式规范：')
    issues.forEach((issue, idx) => console.error(`  ${idx + 1}. ${issue}`))
    console.error(`\n提示：提交类型可用 ${Object.entries(TYPES).map(([k, v]) => `${k}（${v}）`).join('、')}。`)
    process.exit(1)
  }

  return message
}

// 执行提交，用 -F - 通过标准输入传入信息，避免中文被 shell 转义
function commit(message, noVerify) {
  console.log('\n提交信息如下：')
  console.log('┄'.repeat(48))
  console.log(message)
  console.log('┄'.repeat(48))

  const args = ['commit', '-F', '-']
  if (noVerify) args.push('--no-verify')

  const result = spawnSync('git', args, { input: message, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
  if (result.error || result.status !== 0) {
    console.error('\n提交失败，请查看上方 git 输出。')
    process.exit(1)
  }

  const summary = gitOut(['log', '-1', '--pretty=format:%h %s'])
  console.log(`\n提交完成：${summary}`)
}

function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.flags.help) {
    console.log(USAGE)
    return
  }

  ensureRepo()
  console.log(`分支：${gitOut(['rev-parse', '--abbrev-ref', 'HEAD'])}`)

  const changes = listChanges()

  if (opts.flags.list) {
    printStatus(changes)
    return
  }

  // 第一步：确认要提交的文件并暂存
  const targets = opts.files.length ? opts.files : pickFiles(changes)
  if (!opts.files.length && !targets.length) {
    console.error('\n工作区没有改动，无需提交。')
    process.exit(1)
  }

  if (!opts.flags['staged-only'] && opts.files.length) {
    console.log(`\n本次提交涉及 ${targets.length} 个文件：`)
    targets.forEach((file) => console.log(`  ${file}`))
  } else if (!opts.flags['staged-only'] && !opts.files.length) {
    printStatus(changes)
  }

  if (!opts.flags['staged-only']) {
    if (!stageFiles(targets, opts.flags['dry-run'])) {
      process.exit(1)
    }
  } else {
    const staged = gitOut(['diff', '--cached', '--name-only'])
    if (!staged) {
      console.error('\n没有已暂存的改动，请先暂存文件或去掉 --staged-only。')
      process.exit(1)
    }
    console.log(`\n使用已暂存的 ${staged.split('\n').filter(Boolean).length} 个文件。`)
  }

  // 第二步：校验提交信息
  const message = buildMessage(opts)

  if (opts.flags['dry-run']) {
    console.log('\n试运行结束，未执行提交。将要使用：')
    console.log('┄'.repeat(48))
    console.log(message)
    console.log('┄'.repeat(48))
    return
  }

  // 第三步：跑测试后提交
  if (!runTests(opts.flags)) {
    process.exit(1)
  }

  commit(message, opts.flags['no-verify'])
}

try {
  main()
} catch (err) {
  console.error(`\n执行出错：${err.message}`)
  process.exit(1)
}
