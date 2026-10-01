import { taskUrlFromCandidates } from './doubao-task-url.mjs'
import { sentMessagesForPrompt } from './doubao-message-match.mjs'

// 活动窗口只读检查。点击“查看”不能刷新/导航正在发送或生成的页面。
export async function checkTaskWindow(target, { originalPage, active, conversationUrl, initialUrl, prompt }) {
  if (target === originalPage && active) return
  if (!conversationUrl) return
  if (taskUrlFromCandidates([target.url()], initialUrl) !== conversationUrl) {
    throw new Error('当前窗口已切换到其他页面。为避免打断任务，未自动跳转；可关闭此窗口后点击查看恢复原对话。')
  }
  await sentMessagesForPrompt(target, prompt).first().waitFor({ state: 'visible', timeout: 15000 })
}
