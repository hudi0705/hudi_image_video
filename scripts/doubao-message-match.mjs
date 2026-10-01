// 豆包渲染数字、单位和段落时会增删空白，匹配内容时忽略这些排版差异。
export function promptPattern(prompt) {
  const characters = [...prompt.replace(/[\s\u200b-\u200d\ufeff]/g, '')]
  if (!characters.length) throw new Error('提示词为空')
  return new RegExp(characters.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\u200b-\\u200d\\ufeff]*'))
}

export function sentMessagesForPrompt(page, prompt) {
  return page.getByTestId('send_message').filter({ hasText: promptPattern(prompt) })
}
