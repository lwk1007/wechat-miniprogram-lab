// 宠物口吻对话的"大脑"：关键词命中 → 情绪 → 文案池
// 为什么先做模板不接大模型：
//   1) 零延迟、零费用，冷启动体验更好
//   2) 文案可控，不会说出不该说的话（审核友好）
//   3) 接口随时能换，页面代码一行不用动

const POOLS = {
  miss: [
    '你今天回来得好晚，我趴在门口数了很久的脚步声。',
    '我把你昨天坐过的那个位置又暖了一遍。',
    '刚才窗外有动静，我以为是你。',
    '你不在的时候，我把家里每个角落都巡视了三遍。'
  ],
  hungry: [
    '那个…碗好像空了。我不是催你，就是提一下。',
    '我闻到厨房的味道了，是给我的吗？',
    '我今天的表现很好，配得上一块小零食吧。',
    '我不饿，但我可以陪你吃。'
  ],
  happy: [
    '你回来啦！尾巴它自己动起来了，我控制不住。',
    '今天也是最喜欢你的一天。',
    '我刚刚打了个滚，你要不要看第二遍？',
    '我在沙发上给你留了个位置，是热的。'
  ],
  sleepy: [
    '我先眯一会儿，你说话我听得见。',
    '别关灯，我怕黑…好吧关吧，我闭眼了。',
    '梦里有你，还有一大片草地。',
    '今天的电量用完了，明天再陪你玩。'
  ],
  play: [
    '那个球！就是那个球！扔一下嘛，就一下。',
    '我准备好了，你看我这姿势，专业不专业。',
    '追到了！…再扔一次。',
    '我可以玩到天黑，你不用管我。'
  ],
  default: [
    '嗯嗯，我在听。',
    '你说什么我都爱听，真的。',
    '我歪着头是因为我在努力理解你。',
    '那你今天开心吗？'
  ]
}

// 关键词 → 情绪。顺序有意义：越具体的放越前面
const RULES = [
  { mood: 'hungry', words: ['吃', '饭', '饿', '罐头', '零食', '罐头', '喂'] },
  { mood: 'play', words: ['玩', '球', '散步', '出去', '遛', '公园'] },
  { mood: 'sleepy', words: ['睡', '晚安', '困', '夜', '休息'] },
  { mood: 'miss', words: ['想你', '下班', '回来', '等我', '对不起', '忙'] },
  { mood: 'happy', words: ['乖', '可爱', '喜欢', '爱你', '宝贝', '好棒'] }
]

function detectMood(text) {
  for (const rule of RULES) {
    if (rule.words.some((w) => text.indexOf(w) > -1)) return rule.mood
  }
  return 'default'
}

// 随机但不连着重复：上一次用过的那条排除掉
function pick(list, last) {
  const pool = list.length > 1 ? list.filter((t) => t !== last) : list
  return pool[Math.floor(Math.random() * pool.length)]
}

// 返回 { text, mood, nextLast }
function reply(userText, state) {
  const mood = detectMood(userText || '')
  const text = pick(POOLS[mood], state.lastText)

  return { text, mood, nextLast: text }
}

// 冷启动的第一句话
const GREETING = '你回来啦，我一直在等你。'

module.exports = { reply, GREETING, POOLS }
