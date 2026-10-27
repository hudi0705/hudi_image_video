// 模型输出 JSON 时经常带 ``` 围栏或前后说明文字，这里做一次容错解析
export function parseJsonObject(raw: string, label: string): unknown {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) throw new Error(`${label}返回格式无效`)
  try {
    return JSON.parse(text)
  } catch {
    // 整体解析失败，截取第一个 { 到最后一个 } 再试一次
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error(`${label}返回格式无效`)
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error(`${label}返回格式无效`)
  }
}
