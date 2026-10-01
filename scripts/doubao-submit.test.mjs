import { test, expect } from 'vitest'
import { chromium } from 'playwright'
import { submitVideoMessage, currentReplies, markRepliesBeforePrompt, videoReplyStatus, activateReplyVideo } from './doubao-submit.mjs'
import { watchCompletion } from './doubao-submit-response.mjs'
import { verifySavedConversation } from './doubao-saved-conversation.mjs'
import { interruptedTaskResult } from './doubao-window-interruption.mjs'
import { TaskBinding } from './doubao-task-binding.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('只有消息列表确认发送才继续；排除首页示例及旧回复', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-submit-'))
  const browser = await chromium.launch({ headless: true })
  try {
    const file = path.join(dir, 'frame.png')
    await fs.writeFile(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
    const page = await browser.newPage()
    const html = `<video src="sample.mp4"></video><div data-testid="receive_message"><video src="old.mp4"></video>旧回复</div>
      <button onclick="document.querySelector('[data-value]').hidden=false">视频生成</button>
      <div data-testid="skill_input_exit_button" data-value="17" hidden>视频生成</div>
      <input data-testid="upload-file-input" type="file" onchange="fetch('/alice/message/pre_handle_v2_without_conv', {method:'POST'})">
      <div data-testid="attachment-image-card"><img alt="frame.png" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="></div>
      <div data-testid="chat_input_input"><div contenteditable="true"></div></div><button data-testid="chat_input_send_button">发送</button>`
    await page.route('https://www.doubao.com/**', route => route.fulfill({
      contentType: route.request().method() === 'POST' ? 'application/json' : 'text/html',
      body: route.request().method() === 'POST' ? '{"code":0}' : html,
    }))
    await page.goto('https://www.doubao.com/chat/')
    await page.setContent(html)
    await page.getByTestId('chat_input_send_button').evaluate(el => el.onclick = () => {
      const sent = document.createElement('div')
      sent.dataset.testid = 'send_message'
      sent.textContent = document.querySelector('[contenteditable]').textContent
      document.body.append(sent)
      const reply = document.createElement('div')
      reply.dataset.testid = 'receive_message'
      reply.textContent = '先确认动效方向和时长'
      document.body.append(reply)
    })
    await submitVideoMessage(page, file, '动起来', 1000)
    expect(await currentReplies(page).allInnerTexts()).toEqual(['先确认动效方向和时长'])
    expect(await currentReplies(page).locator('video').count()).toBe(0)
    // 恢复页面后 DOM 标记丢失，重新以本次发送消息为界限排除旧视频。
    await page.locator('[data-before-submit]').evaluateAll(nodes => nodes.forEach(node => node.removeAttribute('data-before-submit')))
    await markRepliesBeforePrompt(page, '动起来')
    expect(await currentReplies(page).allInnerTexts()).toEqual(['先确认动效方向和时长'])
    expect(await currentReplies(page).locator('video').count()).toBe(0)
    // DOM fill 能显示文字，但模拟编辑器仅在 keyup 同步内部提交状态。
    await page.setContent(html)
    await editorKeyboardFixture(page)
    await submitVideoMessage(page, file, '镜头推进\n保持风格', 1000)
    expect(await page.getByTestId('send_message').innerText()).toContain('镜头推进')
    expect(await page.getByTestId('send_message').innerText()).toContain('保持风格')
    await page.setContent(html)
    await page.getByTestId('chat_input_send_button').evaluate(button => {
      button.onclick = () => {
        const sent = document.createElement('div')
        sent.dataset.testid = 'send_message'
        sent.innerHTML = '<p>动作：推进</p><p>时长：8 秒</p><p>视频比例：16:9，10s</p>'
        document.body.append(sent)
      }
    })
    await submitVideoMessage(page, file, '动作：推进\n时长：8秒\n视频比例：16:9', 1000)
    await markRepliesBeforePrompt(page, '动作：推进\n时长：8秒\n视频比例：16:9')
    await page.setContent(html)
    await expect(submitVideoMessage(page, file, '动起来', 200)).rejects.toThrow('未确认消息发送成功')
  } finally {
    await browser.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 20000)

test('确认后的生成回复不再被之前的参数确认误判，等待人工确认时保持跟踪', () => {
  expect(videoReplyStatus('视频生成参数确认。确认后我再开始生成视频。', true)).toBe('needs_attention')
  expect(videoReplyStatus('视频生成参数确认。确认后我再开始生成视频。', false)).toBe('generating')
  expect(videoReplyStatus('本次使用 Seedance 2.0 Mini 生成，预计等待 5 分钟。', true)).toBe('generating')
  expect(videoReplyStatus('你的视频生成好了。', true)).toBe('generating')
})

test('本次回复的视频封面点击后加载播放器，排除旧回复并只激活一次', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`
      <div data-testid="receive_message" data-before-submit="true"><video src="old.mp4"></video></div>
      <div data-testid="receive_message">你的视频生成好了。
        <div class="video-player-wrapper-test" style="width:100px;height:60px" onclick="this.innerHTML='<video src=&quot;current.mp4&quot;></video>';window.plays=(window.plays||0)+1"></div>
        <div data-video-conner-tag="true"></div>
      </div>`)
    const replies = currentReplies(page)
    expect(await activateReplyVideo(replies)).toBe(true)
    expect(await replies.locator('video').getAttribute('src')).toBe('current.mp4')
    expect(await activateReplyVideo(replies)).toBe(false)
    expect(await page.evaluate(() => window.plays)).toBe(1)
  } finally { await browser.close() }
})

test('图片预处理尚未完成或返回业务错误时，不能点击发送', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-preprocess-'))
  const browser = await chromium.launch()
  let release
  try {
    const file = path.join(dir, 'frame.png')
    await fs.writeFile(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
    const page = await browser.newPage()
    const pending = new Promise(resolve => { release = resolve })
    await page.route('https://www.doubao.com/**', async route => {
      if (route.request().method() === 'POST') {
        await pending
        return route.fulfill({ contentType: 'application/json', body: '{"code":7100}' })
      }
      return route.fulfill({ contentType: 'text/html', body: `
        <div data-testid="skill_input_exit_button" data-value="17">视频生成</div>
        <div data-testid="chat_input_input"><div contenteditable="true"></div></div>
        <input data-testid="upload-file-input" type="file" onchange="fetch('/alice/message/pre_handle_v2_without_conv',{method:'POST'})">
        <button data-testid="chat_input_send_button" onclick="window.sent=true">发送</button>` })
    })
    await page.goto('https://www.doubao.com/chat/')
    const processing = page.waitForRequest('**/pre_handle_v2_without_conv')
    const submission = submitVideoMessage(page, file, '动起来')
    const rejected = expect(submission).rejects.toThrow('图片预处理失败（7100）')
    await processing
    expect(await page.evaluate(() => Boolean(window.sent))).toBe(false)
    release()
    await rejected
    expect(await page.evaluate(() => Boolean(window.sent))).toBe(false)
  } finally {
    release?.()
    await browser.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function editorKeyboardFixture(page) {
  await page.evaluate(() => {
    let editorState = ''
    const editor = document.querySelector('[contenteditable]')
    editor.addEventListener('keyup', () => { editorState = editor.innerText })
    document.querySelector('[data-testid="chat_input_send_button"]').onclick = () => {
      if (!editorState) return
      const sent = document.createElement('div')
      sent.dataset.testid = 'send_message'
      sent.textContent = editorState
      document.body.append(sent)
    }
  })
}

test.each(['message_missing', 'draft_visible', 'window_closed'])('草稿提交与接口失败联动：%s', async scenario => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doubao-rejected-draft-'))
  const browser = await chromium.launch()
  let release
  let completion
  try {
    const file = path.join(dir, 'frame.png')
    await fs.writeFile(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
    const context = await browser.newContext()
    const page = await context.newPage()
    const responseGate = new Promise(resolve => { release = resolve })
    await context.route('https://www.doubao.com/**', async route => {
      const url = new URL(route.request().url())
      if (url.pathname === '/chat/completion') {
        await responseGate
        return route.fulfill({ contentType: 'application/json', body: '{"code":710022004}' })
      }
      if (route.request().method() === 'POST') return route.fulfill({ contentType: 'application/json', body: '{"code":0}' })
      if (url.pathname !== '/chat/') return route.fulfill({ body: '<main>新对话</main>' })
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
        <div data-testid="skill_input_exit_button" data-value="17">视频生成</div>
        <input data-testid="upload-file-input" type="file" onchange="fetch('/alice/message/pre_handle_v2_without_conv',{method:'POST'})">
        <div data-testid="attachment-image-card"><img alt="frame.png"></div>
        <div data-testid="chat_input_input"><div contenteditable="true"></div></div>
        <button data-testid="chat_input_send_button">发送</button>` })
    })
    await page.goto('https://www.doubao.com/chat/')
    const binding = new TaskBinding(page, page.url())
    await page.getByTestId('chat_input_send_button').evaluate((button, scenario) => {
      button.onclick = () => {
        const sent = document.createElement('div')
        sent.dataset.testid = 'send_message'
        sent.textContent = scenario === 'message_missing' ? '本地草稿没有匹配提示词' : document.querySelector('[contenteditable]').innerText
        document.body.append(sent)
        history.pushState({}, '', '/chat/local_draft')
        void fetch('/chat/completion', { method: 'POST' }).catch(() => {})
      }
    }, scenario)
    const submission = submitVideoMessage(page, file, '动起来', 30000, () => {
      binding.startSending()
      completion = watchCompletion(page)
      return completion
    })
    if (scenario === 'message_missing') {
      const rejected = expect(submission).rejects.toThrow('710022004')
      await page.getByTestId('send_message').waitFor()
      release()
      await rejected
    } else {
      await submission
      binding.confirm()
      expect(binding.verified).toBe(false)
      expect(page.url()).toContain('local_draft')
      if (scenario === 'window_closed') {
        await page.close()
        const result = interruptedTaskResult(new Error('Target page has been closed'), page, {
          submitted: binding.verified, conversationUrl: binding.recoveryUrl, prompt: '动起来', previousReply: '',
        })
        expect(result.status).toBe('unconfirmed')
        expect(result.responseText).toContain('尚未确认消息是否发送成功')
        expect(result.responseText).not.toContain('消息已发送')
      } else {
        const verification = completion.race(verifySavedConversation(context, 'https://www.doubao.com/chat/123', '动起来'))
        const rejected = expect(verification).rejects.toThrow('710022004')
        release()
        await rejected
        expect(binding.verified).toBe(false)
      }
    }
  } finally {
    completion?.dispose()
    release?.()
    await browser.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 5000)
