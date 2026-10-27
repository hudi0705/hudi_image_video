export function videoReplyFailure(text) {
  const value = text.replace(/\s+/g, '')
  // 只识别明确的拒绝结果，避免把正常的版权说明或生成进度判为失败。
  const refused = /(?:无法|不能|不支持|拒绝|不予|未能)[^。！？!?；;，,]{0,40}(?:生成|创作|制作)|(?:无法|不能|拒绝)[^。！？!?；;，,]{0,20}提供[^。！？!?；;，,]{0,20}(?:视频|图片|图像|音频|内容)|(?:生成|创作|制作)(?:失败|被拒绝|未通过)/.test(value)
  if (refused && /版权|著作权|知识产权|商标/.test(value)) return '版权限制'
  if (refused && /肖像|隐私|个人信息/.test(value)) return '肖像或隐私限制'
  if ((refused && /内容安全|安全政策|社区规范|违规|违法|敏感|审核|相关政策|平台规则/.test(value)) || /(?:内容|安全)?审核(?:未通过|不通过|失败)/.test(value)) return '内容安全限制'
  if (/(?:视频生成|生成任务|本次生成)(?:失败|出错)/.test(value)) return '生成失败'
  return ''
}
