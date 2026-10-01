import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { submitVideoMessage, currentReplies, markRepliesBeforePrompt, videoReplyStatus, activateReplyVideo } from './doubao-submit.mjs'
import { randomUUID } from 'node:crypto'
import { TaskWindows } from './doubao-task-windows.mjs'
import { taskUrlFromCandidates } from './doubao-task-url.mjs'
import { accountPaths, loadAccountStore, readSession, saveAccount } from './doubao-account-store.mjs'
import { interruptedTaskResult, isWindowInterruption } from './doubao-window-interruption.mjs'
import { TaskBinding } from './doubao-task-binding.mjs'
import { verifySavedConversation } from './doubao-saved-conversation.mjs'
import { taskDiagnostics } from './doubao-diagnostics.mjs'
import { checkTaskWindow } from './doubao-task-target.mjs'
import { watchCompletion } from './doubao-submit-response.mjs'
import { sentMessagesForPrompt } from './doubao-message-match.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { AccountQueue } from './doubao-account-queue.mjs'
import { VideoConfirmation, VIDEO_CONFIRMATION_TEXT } from './doubao-video-confirmation.mjs'
import { AccountBrowserPool } from './doubao-browser-pool.mjs'
import { hasGenerationStarted } from './doubao-generation-start.mjs'
import { downloadTaskVideo } from './doubao-video-download.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'doubao-accounts')
const port = Number(process.env.DOUBAO_PORT || 8787)
const entryUrl = new URL(process.env.DOUBAO_URL || 'https://www.doubao.com/chat/')
// 旧视频专页仍能加载，但提交走旧协议并返回 SYSTEM_ERROR。
if (/^\/chat\/create-video\/?$/.test(entryUrl.pathname)) entryUrl.pathname = '/chat/'
const url = entryUrl.href

await fs.mkdir(dataDir, { recursive: true })

const accounts = await loadAccountStore(dataDir)
let loggingIn = false
const taskWindows = new TaskWindows()
const accountQueue = new AccountQueue()
const browserPool = new AccountBrowserPool(chromium, readSession)
const accountWrites = new Map()

function writeAccountState(item, operation) {
  const previous = accountWrites.get(item.id) || Promise.resolve()
  const next = previous.catch(() => {}).then(operation)
  accountWrites.set(item.id, next)
  void next.catch(() => {}).finally(() => {
    if (accountWrites.get(item.id) === next) accountWrites.delete(item.id)
  })
  return next
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(body))
}

async function body(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  return text ? JSON.parse(text) : {}
}

async function login(item) {
  const browser = await chromium.launch({ headless: false })
  try {
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  console.log(`[豆包] ${item.name} 已打开，请扫码登录；确认进入视频生成页面后回终端按回车`)
  await new Promise((resolve) => process.stdin.once('data', resolve))
  await context.storageState({ path: item.storageState, indexedDB: true })
  await readSession(item)
  } finally {
    await browser.close()
  }
}

async function generate(item, prompt, imageDataUrl, windowId, generationStarted) {
  let retained = false
  let page
  let binding
  let previousReply = ''
  let submitted = false
  let messageVisible = false
  let savedConversationVerified = false
  let diagnostics
  let active = true
  let completion
  let replyStatus = 'generating'
  let generationAccepted = false
  const confirmation = new VideoConfirmation()
  let replyAnchor = prompt
  try {
  const context = await browserPool.context(item)
  page = await context.newPage()
  const originalPage = page
  diagnostics = taskDiagnostics(page, path.join(root, 'data', 'doubao-diagnostics'), windowId)
  binding = new TaskBinding(page, url)
  const ensureTarget = async (target) => {
    const conversationUrl = binding.recoveryUrl
    if (!conversationUrl) return
    try {
      if (target === originalPage && active) return
      await checkTaskWindow(target, { originalPage, active, conversationUrl, initialUrl: url, prompt })
      await markRepliesBeforePrompt(target, prompt)
    } catch (error) {
      if (isWindowInterruption(error, target)) throw error
      const recoveryDiagnostics = taskDiagnostics(target, path.join(root, 'data', 'doubao-diagnostics'), `${windowId}-reopen`)
      recoveryDiagnostics.stage('restored_message_missing')
      await recoveryDiagnostics.save('恢复地址未读取到本次提示词，保留窗口供检查').catch(console.error)
      recoveryDiagnostics.dispose()
      const missing = new Error('已打开原对话地址，但未读取到本次发送的消息。窗口已保留，请检查是否为空白、登录失效或消息发送失败；未重新提交任务。', { cause: error })
      missing.code = 'TASK_MESSAGE_MISSING'
      throw missing
    }
  }
  taskWindows.register(windowId, page, async () => {
    const conversationUrl = binding.recoveryUrl
    if (!conversationUrl) throw new Error('豆包尚未返回本次对话地址，窗口已关闭。请先检查豆包历史记录确认是否已发送；取得对话地址后才能恢复本次任务。')
    let restoredPage
    try {
      const restoredContext = await browserPool.context(item)
      restoredPage = await restoredContext.newPage()
      await restoredPage.goto(conversationUrl, { waitUntil: 'domcontentloaded' })
      // 先交给窗口管理器登记。消息验证失败时保留窗口，不能关闭诊断现场。
      return restoredPage
    } catch (error) {
      await restoredPage?.close().catch(() => {})
      throw error
    }
  }, async (target) => {
    diagnostics.event('view_task_window', { currentUrl: taskUrlFromCandidates([target.url()], url), boundUrl: binding.recoveryUrl, active })
    // 上传/发送阶段只聚焦原窗口，不能导航或等待尚未出现的消息。
    if (messageVisible || target !== originalPage) await ensureTarget(target)
  })
  retained = true
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  if (/登录|扫码登录|手机号登录/.test((await page.locator('body').innerText()).slice(0, 4000))) {
    const error = new Error('账号未登录或登录态已过期')
    error.code = 'LOGIN_REQUIRED'
    throw error
  }
  const bytes = Buffer.from(imageDataUrl.split(',')[1], 'base64')
  const imagePath = path.join(dataDir, `${windowId}-input.png`)
  await fs.writeFile(imagePath, bytes)
  await submitVideoMessage(page, imagePath, prompt, 30000, () => {
    binding.startSending()
    completion = watchCompletion(page, (type, details) => diagnostics.event(type, details))
    return completion
  }, stage => diagnostics.stage(stage))
  completion.throwIfFailed()
  messageVisible = true
  binding.confirm()
  diagnostics.stage('waiting_for_doubao_acceptance')
  let stableSince = Date.now()
  let missingMessageSince = null
  let replyDeadline = Date.now() + 60000
  const deadline = Date.now() + 600000
  while (Date.now() < deadline) {
    completion.throwIfFailed()
    const activePage = taskWindows.current(windowId)
    if (!activePage) {
      // 等待用户重新打开窗口，保留同一请求，不自动创建新生成任务。
      await delay(500)
      continue
    }
    if (page !== activePage) {
      page = activePage
      stableSince = Date.now()
    }
    try {
    const hasMessage = await sentMessagesForPrompt(page, prompt).count() > 0
    if (!hasMessage) {
      if (missingMessageSince === null) {
        missingMessageSince = Date.now()
        diagnostics.event('sent_message_disappeared', { currentUrl: taskUrlFromCandidates([page.url()], url), boundUrl: binding.recoveryUrl })
      }
      // 给正常的前端路由重新渲染留时间，但不能继续读取其他对话的回复。
      if (Date.now() - missingMessageSince < 15000) {
        await delay(500)
        continue
      }
      await diagnostics.save('本次消息出现后消失，15 秒内未恢复；未导航或重新提交').catch(console.error)
      return { url: '', taskUrl: '', requestText: prompt, status: 'unconfirmed', responseText: '本次消息曾出现在页面，但随后消失且未恢复，无法确认豆包已保存或受理任务。程序已停止读取，没有跳转或重新发送。请保留原窗口查看页面提示；本地诊断已记录地址变化和接口响应状态。' }
    }
    missingMessageSince = null
    const previousUrl = binding.url
    binding.confirmVisibleMessage(page.url())
    if (binding.url !== previousUrl) diagnostics.event('task_url_updated', { previousUrl, currentUrl: binding.url })
    const conversationUrl = binding.recoveryUrl
    if (conversationUrl && taskUrlFromCandidates([page.url()], url) !== conversationUrl) {
      throw new Error('窗口已离开本次对话，已停止读取结果。请点击查看本次豆包窗口或原对话链接。')
    }
    await markRepliesBeforePrompt(page, replyAnchor)
    const replies = currentReplies(page)
    const responseText = (await replies.allInnerTexts()).join('\n\n').trim()
    const videos = replies.locator('video')
    const videoCount = await videos.count()
    if (!responseText && videoCount === 0 && Date.now() >= replyDeadline) {
      await diagnostics.save('发送页面显示消息后 60 秒仍未收到豆包回复').catch(console.error)
      return {
        url: '', taskUrl: '', requestText: prompt, status: 'unconfirmed',
        responseText: '发送页面显示了消息，但 60 秒内未收到豆包回复，尚未确认豆包受理。请保留原窗口，检查是否有发送失败、上传失败、登录或验证提示。诊断已保存到 data/doubao-diagnostics；不要直接重复提交。',
      }
    }
    if (binding.url && !savedConversationVerified && (responseText || videoCount > 0)) {
      diagnostics.stage('verifying_saved_conversation')
      const verified = await completion.race(verifySavedConversation(page.context(), binding.url, replyAnchor))
      if (!verified) {
        await diagnostics.save('独立打开对话未读取到本次消息').catch(console.error)
        await page.bringToFront().catch(() => {})
        return {
          url: '', taskUrl: '', requestText: prompt, status: 'unconfirmed',
          responseText: '发送页面出现了本次消息，但独立打开对话后未能读取到它，尚不能确认豆包已保存任务（也可能是网络、加载或登录异常）。已保留原窗口，请检查消息是否发送失败，不要直接重复生成。',
        }
      }
      // 校验标签加载期间，原窗口也可能被关闭或切走；不能提交过期校验结果。
      if (taskUrlFromCandidates([page.url()], url) !== conversationUrl ||
          !await sentMessagesForPrompt(page, prompt).count()) {
        continue
      }
      savedConversationVerified = binding.markVerified(conversationUrl)
      await completion.flush()
      completion.throwIfFailed()
      submitted = savedConversationVerified
      if (!submitted) continue
      diagnostics.event('task_accepted', { currentUrl: conversationUrl })
      diagnostics.stage('waiting_for_video')
      await writeAccountState(item, () => page.context().storageState({ path: item.storageState, indexedDB: true }))
      await page.bringToFront()
    }
    if (responseText !== previousReply) { previousReply = responseText; stableSince = Date.now() }
    if (savedConversationVerified) {
      const confirmed = !videoCount && await confirmation.reply(page, replies, {
        stable: Date.now() - stableSince > 5000,
        onSending: () => {
          completion.throwIfFailed()
          if (taskUrlFromCandidates([page.url()], url) !== conversationUrl) {
            throw new Error('窗口已离开本次对话，已停止自动确认；没有发送确认消息。')
          }
          completion.dispose()
          completion = watchCompletion(page, (type, details) => diagnostics.event(type, details))
          submitted = false
          taskWindows.update(windowId, { status: 'confirming', taskUrl: conversationUrl, responseText, requestText: prompt })
          diagnostics.event('auto_confirmation_requested')
          return completion
        },
        onStage: stage => diagnostics.stage(`confirmation_${stage}`),
      })
      if (confirmed) {
        replyAnchor = VIDEO_CONFIRMATION_TEXT
        savedConversationVerified = false
        previousReply = ''
        stableSince = Date.now()
        replyDeadline = Date.now() + 60000
        diagnostics.stage('waiting_for_confirmation_reply')
        continue
      }
      const latestReply = await replies.last().innerText().catch(() => '')
      replyStatus = videoReplyStatus(latestReply, Date.now() - stableSince > 5000)
      if (hasGenerationStarted(latestReply, { verified: savedConversationVerified, stable: Date.now() - stableSince > 5000, videoCount })) {
        generationAccepted = true
        generationStarted()
      }
      taskWindows.update(windowId, { status: replyStatus === 'generating' && !generationAccepted ? 'waiting' : replyStatus, taskUrl: conversationUrl, responseText, requestText: prompt })
      if (!videoCount) {
        await activateReplyVideo(replies).catch(error => diagnostics.event('video_preview_unavailable', { message: error.message }))
      }
    }
    if (videoCount > 0) {
      const candidate = videos.last()
      const src = await candidate.evaluate((video) => video.currentSrc || video.src)
      const ready = await candidate.evaluate((video) => video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0).catch(() => false)
      if (src && ready && savedConversationVerified) {
        const taskUrl = conversationUrl
        await writeAccountState(item, () => page.context().storageState({ path: item.storageState, indexedDB: true }))
        return { url: src, taskUrl, requestText: prompt, responseText, status: 'completed' }
      }
    }
    await delay(1000)
    } catch (error) {
      if (!page.isClosed()) throw error
      // 点击与读取之间关闭窗口时也进入同一恢复等待。
    }
  }
  await diagnostics.save('等待视频结果超时').catch(console.error)
  return { url: '', taskUrl: savedConversationVerified ? binding.url : '', requestText: prompt, responseText: previousReply || '尚未确认豆包已保存并处理任务，请查看原窗口。', status: savedConversationVerified && (generationAccepted || replyStatus === 'needs_attention') ? replyStatus : 'unconfirmed' }
  } catch (error) {
    // DOM 等待超时也优先报告已观察到的发送接口失败，避免被通用错误覆盖。
    try { completion?.throwIfFailed() } catch (submissionError) { error = submissionError }
    await diagnostics?.save(error.message).catch(console.error)
    return interruptedTaskResult(error, page, { submitted, conversationUrl: binding?.recoveryUrl || '', prompt, previousReply })
  } finally {
    completion?.dispose()
    active = false
    diagnostics?.dispose()
    // 标签页共享账号会话；关闭单个任务不能终止其他任务。
    if (!retained) {
      taskWindows.fail(windowId, new Error('本次任务窗口初始化失败，请检查登录状态后重试。'))
      await page?.close().catch(() => {})
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {})
    if (req.method === 'GET' && req.url.startsWith('/task-window/video?')) {
      const windowId = new URL(req.url, `http://127.0.0.1:${port}`).searchParams.get('windowId')
      const task = taskWindows.status(windowId)
      if (task?.status !== 'completed' || !task.url) return json(res, 404, { message: '本次任务尚未生成视频' })
      const bytes = await downloadTaskVideo(taskWindows.current(windowId), task.url)
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*' })
      return res.end(bytes)
    }
    if (req.method === 'GET' && req.url.startsWith('/task-window/status?')) {
      const windowId = new URL(req.url, `http://127.0.0.1:${port}`).searchParams.get('windowId')
      const status = taskWindows.status(windowId)
      return json(res, status ? 200 : 404, status || { message: '任务尚未登记' })
    }
    if (req.method === 'POST' && req.url === '/task-window/open') {
      const input = await body(req)
      const result = await taskWindows.open(String(input.windowId), 5000)
      return json(res, 200, { ok: true, message: result.reopened ? '已用原账号打开本次消息绑定的对话，未重新提交生成。' : '' })
    }
    if (req.method === 'GET' && req.url === '/accounts') return json(res, 200, [...accounts.values()].map(({ storageState, ...item }) => item))
    if (req.method === 'POST' && req.url === '/accounts') {
      if (loggingIn) return json(res, 409, { message: '请先完成当前账户登录并在终端按回车' })
      loggingIn = true
      try {
      const input = await body(req)
      const id = String(input.id || `doubao-${Date.now().toString(36)}`)
      if (accountQueue.states.get(id)?.active) return json(res, 409, { message: '该账户正在生成视频，请任务结束后重新登录' })
      const item = { id, name: String(input.name || id), storageState: accountPaths(dataDir, id).storageState, dailyQuota: Number(input.dailyQuota) || 5, usedToday: accounts.get(id)?.usedToday || 0 }
      await login(item)
      await browserPool.invalidate(id)
      await saveAccount(dataDir, item)
      accounts.set(id, item)
      return json(res, 200, { ...item, storageState: undefined })
      } finally {
        loggingIn = false
      }
    }
    if (req.method === 'POST' && req.url === '/generate') {
      const input = await body(req)
      const item = accounts.get(String(input.accountId))
      if (!item) return json(res, 404, { message: '账号不存在' })
      const windowId = String(input.windowId || randomUUID())
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(windowId)) return json(res, 400, { message: '任务窗口 ID 无效' })
      taskWindows.reserve(windowId)
      taskWindows.update(windowId, { status: 'queued', responseText: '等待该账号前序镜头开始生成，本次消息尚未发送。' })
      let result
      try {
        result = await accountQueue.run(item.id, async generationStarted => {
          taskWindows.update(windowId, { status: 'sending', responseText: '' })
          const generated = await generate(item, String(input.prompt || ''), String(input.imageDataUrl || ''), windowId, generationStarted)
          await writeAccountState(item, async () => {
            if (generated.status === 'completed') item.usedToday += 1
            await saveAccount(dataDir, item)
          })
          return generated
        })
      } catch (error) {
        taskWindows.update(windowId, { status: 'failed', responseText: error.message })
        taskWindows.fail(windowId, error)
        throw error
      }
      taskWindows.update(windowId, result)
      return json(res, 200, { ...result, accountName: item.name })
    }
    return json(res, 404, { message: 'Not found' })
  } catch (error) {
    console.error(`[豆包] ${req.method} ${req.url}：`, error)
    return json(res, error.code === 'LOGIN_REQUIRED' ? 401 : 500, { message: error.message || '豆包服务失败', code: error.code })
  }
})
server.listen(port, '127.0.0.1', () => console.log(`豆包本地服务：http://127.0.0.1:${port}`))
