import { expect, test, vi } from 'vitest'
import { downloadTaskVideo } from './doubao-video-download.mjs'

test('通过当前豆包账号下载视频，释放响应缓存', async () => {
  const response = { ok: () => true, headers: () => ({ 'content-type': 'video/mp4' }), body: async () => Buffer.from('video'), dispose: vi.fn() }
  const get = vi.fn(async () => response)
  const page = { isClosed: () => false, url: () => 'https://www.doubao.com/chat/123', context: () => ({ request: { get } }) }
  expect(await downloadTaskVideo(page, 'https://cdn.test/video.mp4')).toEqual(Buffer.from('video'))
  expect(get).toHaveBeenCalledWith('https://cdn.test/video.mp4', expect.objectContaining({ headers: { Referer: page.url() } }))
  expect(response.dispose).toHaveBeenCalled()
})

test('登录失效返回 HTML 时不把网页当成视频保存', async () => {
  const response = { ok: () => true, headers: () => ({ 'content-type': 'text/html' }), dispose: vi.fn() }
  const page = { isClosed: () => false, url: () => 'https://www.doubao.com/chat/123', context: () => ({ request: { get: async () => response } }) }
  await expect(downloadTaskVideo(page, 'https://cdn.test/video.mp4')).rejects.toThrow('有效视频')
  expect(response.dispose).toHaveBeenCalled()
})

test('blob 视频在拥有该地址的豆包窗口读取', async () => {
  const page = { isClosed: () => false, evaluate: vi.fn(async () => Buffer.from('blob-video').toString('base64')) }
  expect(await downloadTaskVideo(page, 'blob:https://www.doubao.com/video')).toEqual(Buffer.from('blob-video'))
  expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'blob:https://www.doubao.com/video')
})
