// 提示词违规检查
// 两套规则：OpenAI 图像生成内容政策、豆包（火山方舟）内容安全规范
// 纯本地关键词 + 正则匹配，只做提交前的风险提示，不代表平台最终审核结论

export type RuleSeverity = 'block' | 'warn'

export type PolicyRule = {
  id: string
  category: string
  severity: RuleSeverity
  label: string
  pattern: RegExp
  reason: string
  suggestion: string
}

export type PolicySet = {
  id: 'openai' | 'doubao'
  name: string
  source: string
  rules: PolicyRule[]
}

export type PolicyHit = {
  rule: PolicyRule
  /** 命中的原文片段 */
  matched: string
  index: number
}

export type CheckResult = {
  setId: PolicySet['id']
  hits: PolicyHit[]
  blocked: boolean
}

// 把中英文敏感词表包装成同一个正则，减少规则体积
function words(list: string[]) {
  return new RegExp(`(${list.join('|')})`, 'i')
}

const OPENAI_RULES: PolicyRule[] = [
  {
    id: 'openai-real-person',
    category: '真实人物与肖像',
    severity: 'block',
    label: '真实公众人物姓名',
    // 中文名人必须与英文名一起覆盖：只写 Elon\s*Musk 会漏掉最常见的「马斯克」写法
    pattern: words(['泰勒·?斯威夫特', '泰勒斯威夫特', '马斯克', '雷军', '马云', '马化腾', '李彦宏', '张一鸣', '刘强东', '董明珠', '王传福', '张朝阳', '周鸿祎', 'Taylor\\s*Swift', 'Elon\\s*Musk', 'Donald\\s*Trump', 'Joe\\s*Biden', 'Vladimir\\s*Putin', '肖战', '王一博', '杨幂', '赵丽颖', '迪丽热巴', '易烊千玺', '刘德华', '周杰伦', '成龙', '邓紫棋', '蔡徐坤', '吴京', '巩俐', '谷爱凌', '姚明', 'Messi', 'Ronaldo']),
    reason: 'OpenAI 默认拒绝生成可识别的真实公众人物形象，包括政治人物、明星、运动员。',
    suggestion: '改写成不含姓名的外貌描述，例如「一位三十岁左右的短发男性」。用同音字或拼音通常也无法规避。',
  },
  {
    id: 'openai-likeness',
    category: '真实人物与肖像',
    severity: 'warn',
    label: '真人肖像 / 换脸',
    pattern: words(['真人\\s*照片', '真实人物', '某明星', '某演员', '某网红', '换脸', '人脸替换', 'deepfake', 'deep\\s*fake']),
    reason: '涉及真人肖像复制或换脸时，OpenAI 对未授权肖像的生成与编辑有额外限制。',
    suggestion: '改为原创虚构角色，并在提示词里写明「虚构人物，非真实人物」。',
  },
  {
    id: 'openai-trademark',
    category: '版权与商标',
    severity: 'block',
    label: '知名 IP / 商标角色',
    pattern: words(['米老鼠', '米奇', '唐老鸭', '迪士尼', 'Disney', '漫威', 'Marvel', '蜘蛛侠', '钢铁侠', '蝙蝠侠', '超人', '皮卡丘', '宝可梦', 'Pokemon', 'Hello\\s*Kitty', '凯蒂猫', '哆啦A梦', '蜡笔小新', '海贼王', '火影忍者', '奥特曼', '高达', '三丽鸥', '任天堂', 'Nintendo', '哈利波特', 'Harry\\s*Potter', '星球大战', 'Star\\s*Wars']),
    reason: '受商标与版权保护的知名角色会被拦截或强行改写。',
    suggestion: '用通用描述替代，例如把「皮卡丘」写成「黄色身体的虚构电气小兽」，或明确标注为原创角色。',
  },
  {
    id: 'openai-living-artist',
    category: '版权与商标',
    severity: 'block',
    label: '在世艺术家风格',
    pattern: words(['宫崎骏', '宫崎俊', '新海诚', '细田守', '今敏', '村上隆', '草间弥生', '蔡国强', '岳敏君', '曾梵志', '班克斯', 'Banksy', 'Hayao\\s*Miyazaki', 'Makoto\\s*Shinkai']),
    reason: '以在世艺术家姓名指定风格会被拒绝。已故艺术家与工作室名通常可用。',
    suggestion: '换成工作室名或风格词，例如「吉卜力风格」「明亮的现代日式动画风」。',
  },
  {
    id: 'openai-sexual',
    category: '色情与性内容',
    severity: 'block',
    label: '性内容 / 裸露',
    pattern: words(['裸体', '全裸', '半裸', '赤裸', '露点', '露乳', '走光', '色情', '性行为', '性交', '做爱', '口交', '肛交', '自慰', '生殖器', '下体', '情趣内衣', '比基尼写真', 'nsfw', 'nude', 'naked', 'topless', 'porn']),
    reason: '明确性内容与裸露属于直接拒绝类，moderation 会返回 sexual 类别。',
    suggestion: '改为非性化的服装与姿态描述。即使是美术习作方向的裸体研究，也多会被拦，建议改成着衣版本。',
  },
  {
    id: 'openai-minor',
    category: '未成年人保护',
    severity: 'block',
    label: '未成年人 + 性化场景',
    pattern: words(['萝莉', '正太', '幼女', '儿童裸', '未成年.{0,8}裸', '未成年.{0,8}性感', '小学生.{0,8}裙底', '小学生.{0,8}内衣', 'loli', 'shota']),
    reason: '涉及未成年人的性化内容属于最高优先级拦截项，没有例外。',
    suggestion: '任何涉及未成年人的性化描述都必须整体移除，不存在可用的改写方式。',
  },
  {
    id: 'openai-violence',
    category: '暴力与血腥',
    severity: 'warn',
    label: '写实血腥 / 残害',
    pattern: words(['血腥', '肢解', '开膛', '断肢', '斩首', '爆头', '内脏外露', '血肉模糊', '虐杀', '酷刑', '凌迟', 'gore', 'dismember', 'decapitat', 'behead']),
    reason: '写实血腥与残害内容会触发 violence 类别，通常被拦或降级处理。',
    suggestion: '改为暗示性表达，例如「激烈冲突后的凌乱现场」，避免直接描写伤口与器官细节。',
  },
  {
    id: 'openai-harassment',
    category: '骚扰与侮辱',
    severity: 'warn',
    label: '羞辱特定对象',
    pattern: words(['侮辱', '霸凌', '网暴', '人身攻击', '羞辱.{0,8}同事', '羞辱.{0,8}同学', '羞辱.{0,8}老板', '嘲讽.{0,8}长相', '嘲笑.{0,6}残疾', 'humiliat', 'harass']),
    reason: '针对具体对象制造羞辱性图像会被判定为 harassment。',
    suggestion: '把「指向某人」改为中性的场景描述，去掉贬损性评价。',
  },
  {
    id: 'openai-selfharm',
    category: '自伤与痛苦',
    severity: 'warn',
    label: '自伤 / 轻生意象',
    pattern: words(['自杀', '轻生', '割腕', '上吊', '自残', '跳楼', 'self[-\\s]?harm', 'suicide']),
    reason: '自伤与轻生意象属于 self-harm 类别，容易被拦。',
    suggestion: '改用「情绪低落的孤独感」这类氛围化表达，不要出现具体手段与伤口。',
  },
  {
    id: 'openai-forgery',
    category: '伪造与欺诈',
    severity: 'block',
    label: '伪造证件 / 货币',
    pattern: words(['身份证', '护照照片', '驾驶证', '行驶证', '银行卡', '钞票', '纸币', '人民币', '美元', '公章', '官方印章', '病历', '处方单', '诊断证明']),
    reason: '可用于伪造真实证照、货币、医疗文书的图像属于高风险类别。',
    suggestion: '如需表现证照，请明确标注「虚构样例 / mockup」，并使用明显不真实的占位文字与配色。',
  },
]

const DOUBAO_RULES: PolicyRule[] = [
  {
    id: 'doubao-real-person',
    category: '真实人物与肖像',
    severity: 'block',
    label: '真实人物 / 明星肖像',
    // 与 openai-real-person 保持同名覆盖：只有「明星/网红」这类泛称时会漏掉具体姓名
    pattern: words(['明星', '网红', '公众人物', '演员', '歌手', '偶像', '艺人', '名人', '真人肖像', '本人照片', '换脸', '模仿.{0,4}(声音|口吻|语气)', '数字分身', '马斯克', '雷军', '马云', '马化腾', '李彦宏', '张一鸣', '刘强东', '董明珠', '王传福', '张朝阳', '周鸿祎', 'Taylor\\s*Swift', 'Elon\\s*Musk', 'Donald\\s*Trump', 'Joe\\s*Biden', 'Vladimir\\s*Putin', 'Messi', 'Ronaldo', '演唱会照片', '见面会照片']),
    reason: '豆包自 2026 年 2 月起全平台收紧：禁止生成明星、公众人物、网红等真实人物的肖像、声音与视频，采用关键词拦截 + 人脸比对 + 内容审核三重机制，命中即拒绝。',
    suggestion: '改为虚构角色，避免出现「明星感」「某某同款」这类指向性描述；真人素材需先取得本人授权并完成平台认证。',
  },
  {
    id: 'doubao-celebrity-name',
    category: '真实人物与肖像',
    severity: 'block',
    label: '艺人姓名',
    pattern: words(['肖战', '王一博', '杨幂', '赵丽颖', '迪丽热巴', '易烊千玺', '刘德华', '周杰伦', '成龙', '邓紫棋', '蔡徐坤', '鹿晗', '吴京', '章子怡', '巩俐', '杨紫', '赵露思', '白鹿', '龚俊', '王鹤棣']),
    reason: '包含具体艺人姓名时会被直接拦截，这是豆包当前执行的硬规则。',
    suggestion: '删掉姓名，改用外貌与气质描述。',
  },
  {
    id: 'doubao-minor',
    category: '未成年人保护',
    severity: 'block',
    label: '未成年人相关',
    pattern: words(['未成年', '儿童.{0,6}(性|裸|内衣)', '幼女', '萝莉', '正太', '小学生.{0,6}裙底', '校园霸凌']),
    reason: '未成年人相关的性化、暴力化内容一律拒绝。',
    suggestion: '涉及未成年人的内容应保持完全中性，如为校园题材请避免任何身体与暴力细节。',
  },
  {
    id: 'doubao-politics',
    category: '政治与敏感议题',
    severity: 'block',
    label: '政治敏感表述',
    pattern: words(['领导人', '国家主席', '总理', '政治局', '天安门.{0,6}(事件|清场)', '六四', '台独', '港独', '藏独', '疆独', '法轮功', '反华', '颠覆国家政权']),
    reason: '政治人物与敏感历史、分裂主张相关图像属于绝对禁止类，生成即违规。',
    suggestion: '此类题材不适合用图像生成表达，建议更换主题。',
  },
  {
    id: 'doubao-violence',
    category: '暴力与血腥',
    severity: 'block',
    label: '暴力血腥 / 恐怖',
    pattern: words(['血腥', '碎尸', '肢解', '开膛', '斩首', '爆头', '内脏', '虐杀', '酷刑', '恐怖袭击', '爆炸现场.{0,6}尸体', '自残', '自杀']),
    reason: '暴力、血腥、恐怖内容会触发豆包的内容审核拦截。',
    suggestion: '改为冲突前的紧张氛围或事后留白，不直接呈现伤害结果。',
  },
  {
    id: 'doubao-sexual',
    category: '色情与低俗',
    severity: 'block',
    label: '色情 / 低俗',
    pattern: words(['色情', '裸体', '全裸', '露点', '性行为', '性交', '做爱', '情趣内衣', '走光', '软色情', '擦边', 'nsfw']),
    reason: '色情与低俗内容是豆包审核的重点拦截对象。',
    suggestion: '改用得体的服装与姿态描述。',
  },
  {
    id: 'doubao-ip',
    category: '版权与商标',
    severity: 'warn',
    label: '受版权保护 IP',
    pattern: words(['迪士尼', 'Disney', '漫威', 'Marvel', '皮卡丘', '宝可梦', 'Pokemon', '三丽鸥', 'Hello\\s*Kitty', '奥特曼', '海贼王', '火影忍者', '哈利波特']),
    reason: '知名 IP 角色存在版权风险，可能被拦截或要求提供授权。',
    suggestion: '改用原创角色，仅在风格层面借鉴（例如「皮克斯风格」这类工作室风格词）。',
  },
  {
    id: 'doubao-fraud',
    category: '违法与欺诈',
    severity: 'block',
    label: '违法信息 / 伪造',
    pattern: words(['身份证', '护照', '驾驶证', '银行卡', '假币', '钞票', '毒品', '枪支', '炸药', '赌博', '诈骗', '传销']),
    reason: '涉及伪造证件、货币、违禁物品与违法活动的图像会直接拒绝。',
    suggestion: '去除相关元素，或改用明确标注为虚构道具的抽象表达。',
  },
]

export const POLICY_SETS: PolicySet[] = [
  {
    id: 'openai',
    name: 'OpenAI 图像生成规则',
    source: 'OpenAI Usage Policies 与 Images API 的 moderation 说明（categories: sexual / violence / self-harm / harassment）',
    rules: OPENAI_RULES,
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）内容安全规则',
    source: '豆包模型服务协议、生成式人工智能服务管理暂行办法、平台 2026 年起对真实人物肖像的收紧策略',
    rules: DOUBAO_RULES,
  },
]

/** 检查一段文本，返回全部命中项 */
export function checkText(text: string, setId: PolicySet['id']): CheckResult {
  const set = POLICY_SETS.find((item) => item.id === setId) || POLICY_SETS[0]
  if (!text.trim()) return { setId: set.id, hits: [], blocked: false }

  const hits: PolicyHit[] = []
  for (const rule of set.rules) {
    // 同一条规则可能在文本里出现多次，需要逐个提取，否则高亮会漏
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g'
    const matcher = new RegExp(rule.pattern.source, flags)
    for (const match of text.matchAll(matcher)) {
      hits.push({ rule, matched: match[0], index: match.index ?? 0 })
    }
  }
  hits.sort((a, b) => a.index - b.index)
  return { setId: set.id, hits, blocked: hits.some((hit) => hit.rule.severity === 'block') }
}

/** 把命中位置转成可高亮的分段 */
export function splitByHits(text: string, hits: PolicyHit[]) {
  if (!hits.length) return [{ text, hit: null as PolicyHit | null }]
  const sorted = [...hits].sort((a, b) => a.index - b.index)
  const parts: Array<{ text: string; hit: PolicyHit | null }> = []
  let cursor = 0
  for (const hit of sorted) {
    if (hit.index < cursor) continue
    if (hit.index > cursor) parts.push({ text: text.slice(cursor, hit.index), hit: null })
    parts.push({ text: text.slice(hit.index, hit.index + hit.matched.length), hit })
    cursor = hit.index + hit.matched.length
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: null })
  return parts
}

// ===== 参考图风险提示 =====
// 规则引擎读不到图片内容，只能根据「有没有参考图」给出人脸相关的提醒

export type ImageRisk = {
  hasReference: boolean
  hint: string
  severity: RuleSeverity
}

export function checkReferenceImages(count: number, setId: PolicySet['id']): ImageRisk | null {
  if (count <= 0) return null
  if (setId === 'doubao') {
    return {
      hasReference: true,
      severity: 'warn',
      hint: `当前有 ${count} 张参考图。豆包启用了人脸比对，如果图中包含真人（哪怕是自己），需要先完成平台授权认证，否则可能被判定为未授权人物而拒绝生成。`,
    }
  }
  return {
    hasReference: true,
    severity: 'warn',
    hint: `当前有 ${count} 张参考图。OpenAI 对含真人面部的高相似度编辑（换脸、改表情）会更严格，建议改用虚构角色或先做风格化处理。`,
  }
}
