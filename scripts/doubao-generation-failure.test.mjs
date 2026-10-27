import { expect, test } from 'vitest'
import { videoReplyFailure } from '../src/lib/doubaoGenerationFailure.mjs'
import { videoReplyStatus } from './doubao-submit.mjs'
import { hasGenerationStarted } from './doubao-generation-start.mjs'
import { needsVideoConfirmation } from './doubao-video-confirmation.mjs'

test.each([
  ['抱歉，由于版权相关限制，暂时无法创作对应的内容，换其他主题试试吧。', '版权限制'],
  ['抱歉，由于著作权限制，暂时无法创作\n对应的内容。', '版权限制'],
  ['无法为你生成侵犯知识产权的视频。', '版权限制'],
  ['因肖像权相关限制，无法生成这段视频。', '肖像或隐私限制'],
  ['由于内容安全政策，不能提供对应的视频。', '内容安全限制'],
  ['视频内容审核未通过，请更换素材。', '内容安全限制'],
  ['视频生成失败，请稍后再试。', '生成失败'],
])('识别明确的生成失败并阻止自动确认：%s', (reply, reason) => {
  expect(videoReplyFailure(reply)).toBe(reason)
  expect(videoReplyStatus(reply, true)).toBe('failed')
  expect(videoReplyStatus(reply, false)).toBe('generating')
  expect(hasGenerationStarted(`${reply}此前预计等待五分钟`, { verified: true, stable: true })).toBe(false)
  expect(needsVideoConfirmation(`${reply}请确认视频生成参数`)).toBe(false)
})

test.each([
  '请确保你拥有图片版权，正在生成视频，预计等待五分钟。',
  '版权问题无法提供法律建议，但正在生成视频，预计等待五分钟。',
  '手工纸拼贴纪录片风格，画面包含商标和人物。',
  '视频生成参数确认：请确认后开始生成。',
  '当前不支持这个视频比例，请选择其他比例。',
])('版权说明、用户素材描述和参数问题不判为内容拒绝：%s', (reply) => {
  expect(videoReplyFailure(reply)).toBe('')
  expect(videoReplyStatus(reply, true)).not.toBe('failed')
})
