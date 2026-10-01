// 使用同一账号的独立页面只读验证，不能仅凭发送页的乐观 UI 判定已保存。
export async function verifySavedConversation(context, url, prompt, timeout = 15000) {
  const check = await context.newPage()
  try {
    await check.goto(url, { waitUntil: 'domcontentloaded', timeout })
    await sentMessagesForPrompt(check, prompt).first().waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  } finally {
    await check.close().catch(() => {})
  }
}
import { sentMessagesForPrompt } from './doubao-message-match.mjs'
