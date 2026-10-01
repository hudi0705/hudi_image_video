import { needsVideoConfirmation } from './doubao-video-confirmation.mjs'

export function hasGenerationStarted(text, { verified, stable, videoCount = 0 }) {
  if (!verified || needsVideoConfirmation(text)) return false
  if (videoCount > 0) return true
  return stable && !/无法生成|不能生成|生成失败|验证码|登录|请补充|请上传/.test(text) &&
    /预计等待|视频生成中|正在生成|视频生成已提交|视频生成好了|生成完成/.test(text)
}
