import { checkTaskWindow } from './doubao-task-target.mjs'
import { sentMessagesForPrompt } from './doubao-message-match.mjs'
import { currentReplies, markRepliesBeforePrompt, videoReplyStatus, activateReplyVideo } from './doubao-submit.mjs'
import { videoReplyFailure } from '../src/lib/doubaoGenerationFailure.mjs'

export async function readTaskConversation(page, record, initialUrl) {
  if (!record.taskUrl) throw new Error('尚未取得本次原对话地址，请检查豆包历史记录；未重新提交')
  await checkTaskWindow(page, { active: false, conversationUrl: record.taskUrl, initialUrl, prompt: record.requestText })
  const anchor = record.replyAnchor || record.requestText
  await sentMessagesForPrompt(page, anchor).first().waitFor({ state: 'visible', timeout: 15000 })
  await markRepliesBeforePrompt(page, anchor)
  await activateReplyVideo(currentReplies(page)).catch((err) => console.warn('[豆包] 恢复视频预览失败', err))
  const replies = currentReplies(page)
  const responseText = (await replies.allInnerTexts()).join('\n\n').trim()
  const latestReply = await replies.last().innerText().catch(() => '')
  const video = await replies.locator('video').count() ? replies.locator('video').last() : null
  const src = video ? await video.evaluate((el) => el.currentSrc || el.src) : ''
  const ready = video && await video.evaluate((el) => el.readyState >= 2 && Number.isFinite(el.duration) && el.duration > 0)
  const failureReason = videoReplyFailure(latestReply)
  if (!video && failureReason) return { status: 'failed', failureReason, responseText, tracking: false }
  return src && ready
    ? { status: 'completed', url: src, responseText, tracking: false }
    : { status: videoReplyStatus(latestReply, true), responseText, tracking: false }
}
