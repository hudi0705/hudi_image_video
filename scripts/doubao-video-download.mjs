export async function downloadTaskVideo(page, url) {
  if (!page || page.isClosed()) throw new Error('请先打开本次豆包窗口，再保存视频')
  if (url.startsWith('blob:')) {
    const data = await page.evaluate(async src => {
      const response = await fetch(src)
      if (!response.ok) throw new Error(`视频下载失败：HTTP ${response.status}`)
      const blob = await response.blob()
      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = () => reject(new Error('视频读取失败'))
        reader.readAsDataURL(blob)
      })
    }, url)
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length) throw new Error('视频下载结果为空')
    return bytes
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('视频地址无效')
  const response = await page.context().request.get(url, { headers: { Referer: page.url() }, timeout: 120000 })
  try {
    if (!response.ok()) throw new Error(`视频下载失败：HTTP ${response.status()}`)
    if (/^(text\/|application\/(json|xml))/i.test(response.headers()['content-type'] || '')) throw new Error('下载结果不是有效视频')
    const bytes = await response.body()
    if (!bytes.length) throw new Error('视频下载结果为空')
    return bytes
  } finally {
    await response.dispose()
  }
}
