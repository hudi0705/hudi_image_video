// 只处理窗口生命周期错误，不能把选择器、网络等错误误报为关闭窗口。
export function isWindowInterruption(error, page) {
  return Boolean(page?.isClosed() || /Target (?:page, context or browser|closed)|browser has been closed|Page crashed/i.test(error?.message || ''))
}

export function interruptedTaskResult(error, page, { submitted, conversationUrl, prompt, previousReply }) {
  if (error?.code === 'DOUBAO_SUBMIT_FAILED') throw error
  const closed = isWindowInterruption(error, page)
  if (!closed) throw error

  const message = submitted
    ? '豆包窗口已关闭或浏览器连接已断开，已停止读取结果。消息已发送，豆包端可能仍在生成，请勿重复提交。'
    : '豆包窗口已关闭或浏览器连接已断开，尚未确认消息是否发送成功，请先检查豆包历史对话，避免重复提交。'
  const recovery = conversationUrl
    ? '可点击“查看本次豆包窗口”重新打开原对话检查结果；重新打开不会自动恢复结果读取。'
    : '本次对话地址尚未取得，请手动打开豆包并用原账号检查历史对话。'
  return {
    url: '',
    taskUrl: conversationUrl,
    requestText: prompt,
    responseText: [previousReply, message, recovery].filter(Boolean).join('\n\n'),
    status: 'unconfirmed',
  }
}
