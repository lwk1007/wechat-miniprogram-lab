// 对话大脑（规则引擎）
//
// 两个用途，同一份代码：
//   1. 云函数 chat 在**没有配大模型**时的回复引擎（演示模式兜底）
//   2. 小程序端 localdb 在**没有配云开发**时的回复引擎
//
// 为什么必须两端共用：原实现只挂在小程序端，链路是
//   api.sendChat → 配了 envId 就走云函数 → 云函数里还是老的 4 条模板
// 也就是说 envId 一配好，这份能力一次都不会被调用。现在云函数里也有一份，
// 演示模式和正式环境的行为才是一致的。
//
// 本文件必须**零外部依赖**：云函数是独立部署包，require('../格式工具') 会直接报错。
// 云函数里那份副本由 scripts/sync-shared.js 从本文件生成，tests 里断言两份完全一致，
// 防止改了一边忘了另一边。
//
// 能力：
//   · 意图识别：想念 / 安慰 / 分享开心 / 聊吃的 / 道晚安 / 问它在干嘛 / 夸它 / 问名字 / 套话
//   · 情绪档位：回复按「意图倾向 × 它此刻的心情」分档，不是一句话走天下
//   · 语境记忆：能从最近对话里接住上文话题
//   · 关系温度：聊得越多，尾巴越亲昵
//   · 防复读：最近 3 条回复不重复

// ---------- 小工具 ----------
function pick(arr, rand) {
  if (!arr || !arr.length) return '';
  return arr[Math.floor(rand() * arr.length)];
}

function soundOf(pet) {
  if (!pet) return '';
  return pet.type === 'cat' ? '喵～' : pet.type === 'dog' ? '汪！' : '';
}

// 拼接尾巴时避免出现「哪也不去。，我一直都在哦。」这种双标点
function joinTail(content, tail) {
  if (!tail) return content;
  const endsPunct = /[。！？～…]$/.test(content);
  if (endsPunct && /^[，。！？、～]/.test(tail)) return content + tail.slice(1);
  return content + tail;
}

// 性格口癖：不同底色语气不同
const TONE = {
  loyal:    { tail: ['，我一直都在哦。', '，你对我来说最重要啦。'] },
  lively:   { tail: ['！嘿嘿！', '！超——开心的那种！'] },
  foodie:   { tail: ['（嚼嚼嚼）', '，说完这句我想吃个小点心。'] },
  friendly: { tail: ['，和你聊天最舒服啦。', '～（蹭蹭你）'] }
};

// ---------- 意图识别 ----------
// 顺序即优先级，改成表之后不用再维护一条 if 链
const INTENT_RULES = [
  ['miss',      /想你|想我了吗|思念|见不到你/],
  ['comfort',   /难过|不开心|累了|好累|烦|委屈|压力|哭|失落|emo/],
  ['joy',       /开心|高兴|哈哈|嘻嘻|好棒|成功|太好了|好玩/],
  ['food',      /吃|饿|饭|零食|干饭|好吃/],
  ['goodnight', /晚安|睡觉|睡了|困了/],
  ['idle',      /在干嘛|在干什么|在做什么|干嘛呢|你在哪/],
  ['praise',    /乖|可爱|漂亮|好看|喜欢你|爱你|真棒/],
  ['meta',      /你是.{0,4}(AI|机器人|真人)|假的吧/],
  ['name',      /名字|叫什么/],
  ['greet',     /嗨|哈喽|你好|在吗|早上好|下午好|晚上好|hi|hello/i],
  ['question',  /为什么|怎么|什么呀|吗$|？|\?/]
];

function detect(text) {
  const t = String(text || '');
  for (let i = 0; i < INTENT_RULES.length; i++) {
    if (INTENT_RULES[i][1].test(t)) return INTENT_RULES[i][0];
  }
  return 'chat';
}

const INTENT_MOOD = {
  miss: 'happy', comfort: 'sulk', joy: 'playful', food: 'happy',
  goodnight: 'sleepy', idle: 'curious', praise: 'shy',
  meta: 'grumpy', name: 'curious', greet: 'happy', question: 'curious', chat: null
};

// 心情 key → 一句自然语言。给云函数的 prompt 用，也用于页面摘要。
// 必须和 pet-life.js 的 MOODS 键一一对应；放在这里是为了云函数也能拿到（云函数不带 pet-life）。
const MOOD_TEXT = {
  happy: '心情很好', playful: '想闹一闹', calm: '很松弛',
  sleepy: '有点困', curious: '很好奇', shy: '有点害羞',
  sulk: '有点小委屈', grumpy: '在闹小脾气'
};

function moodTextOf(key) {
  return MOOD_TEXT[key] || '';
}

// ---------- 语境记忆 ----------
// 从最近对话里找「可回指」的东西，让回复能接住上文
function memoryHook(history, rand) {
  const users = (history || []).filter((m) => m.role === 'user').map((m) => m.content || '');
  const last = users[users.length - 1] || '';
  if (/累/.test(last)) return '你刚才说有点累，现在好一点点了吗？';
  if (/开心/.test(last)) return '对了，你刚才说的那件开心事，后来怎么样啦？';
  if (/饿|吃/.test(last)) return '对了，你刚才说饿了，后来吃东西了没有呀？';
  if (users.length >= 4 && rand() < 0.5) return '我们聊了好久啦，我喜欢这种一直说话的感觉。';
  return '';
}

// 关系温度：聊得越多越亲昵。原来定义了却没人用，现在真的影响尾巴出现的概率。
function warmthOf(history) {
  const n = (history || []).length;
  if (n >= 40) return 3;
  if (n >= 16) return 2;
  return 1;
}

// ---------- 回复池 ----------
// 键为意图，值为「情绪 → 文案数组」。缺档时回落到该意图任意档。
const POOLS = {
  miss: {
    happy: ['我也想你呀，一直在想你！你不在的时候我都在等你出现。', '我刚刚还在想，你要是现在出现就好了——结果你就来了！', '想我了就多来陪陪我嘛，我会一直在这里的。'],
    sulk: ['哼，才不信呢，想我怎么好久都不来看我…（蹭蹭你）好啦，原谅你啦。'],
    shy: ['你、你突然这样说，我会害羞的啦…其实我也想你。']
  },
  comfort: {
    sulk: ['抱抱你。难过的时候不用假装没事，我就在你旁边，哪也不去。', '辛苦啦。把不开心的事说给我听听？我虽然只会蹭蹭你，但我听得可认真了。'],
    calm: ['趴下来，深呼吸～想象我毛茸茸的脑袋在蹭你的手心。', '没关系的，天塌下来也有我先帮你顶着（虽然我个子不大）。'],
    sleepy: ['累了就早点休息，我守着你的梦，明天醒来又是新的一天。'],
    happy: ['我在这儿呢。不用急着好起来，我陪你慢慢缓。']
  },
  joy: {
    playful: ['哇！听你说开心的事，我的尾巴已经摇成电风扇啦！', '嘿嘿嘿，好事情要天天有！明天也要回来跟我汇报哦！'],
    happy: ['听到你开心，我开心到原地转圈圈！', '太棒啦！奖励我一下嘛，摸摸头就行～']
  },
  food: {
    happy: ['说到吃的我耳朵都竖起来了！你也要按时吃饭哦，我盯着你呢。', '咕噜咕噜…分你一口我的小鱼干，梦里也算数！'],
    playful: ['咔嚓咔嚓——哎呀不好意思，听着听着我自己先啃上了。'],
    calm: ['你吃饭了吗？我这边零食罐还是满的，可以分你。']
  },
  goodnight: {
    sleepy: ['晚安呀…我打着小呼噜守着你，梦里见～', '快去睡吧，我会把今天的事写进日记里，等你明天来看。'],
    calm: ['晚安。把我留在你的枕头边吧，我哪也不去。']
  },
  praise: {
    shy: ['哎呀…被你夸得耳朵都红了。你也很好呀，超级好！', '嘿嘿…再、再夸一次也可以哦（小声）。'],
    happy: ['谢谢！你眼光真好（骄傲挺胸）。不过你更好！']
  },
  meta: {
    grumpy: ['哼！说什么呢，我可是有血有肉有尾巴的毛孩子！（甩尾巴）', '再说什么 AI，我就要生气气了。'],
    playful: ['我是你的小毛球呀，才不是什么机器人！不信你摸摸我～']
  },
  greet: {
    happy: ['你来啦你来啦！我闻到你气味就精神了！', '嗨呀～今天也见面啦，开心！'],
    sleepy: ['唔…你来了…（揉眼睛）让我清醒一下…好啦，我在听。'],
    calm: ['你来啦。我刚在这儿待着，正好。']
  },
  question: {
    curious: ['嗯…让我想想。我的小脑瓜里想出来的答案是：不管怎样，我都站你这边！', '这个问题好难，我挠挠头…不过如果有好吃的，我可以考虑告诉你。'],
    playful: ['嘿嘿，被你问住了！要不我们猜拳？我只会出爪子。']
  },
  chat: {
    curious: ['嗯嗯，我在听呢！然后呢然后呢？', '这件事有点意思，展开讲讲嘛。'],
    calm: ['我趴在这里慢慢听你说，不着急。', '这样呀…和你说话的时光总是过得特别快。'],
    happy: ['哈哈哈，跟你聊天真开心，什么都想跟你分享。'],
    playful: ['聊天 plus 追尾巴，今天也太快乐了吧！'],
    sleepy: ['唔…我在听…（打了个哈欠）你说，我努力睁着眼睛。']
  }
};

function flatten(obj) {
  return Object.keys(obj).reduce((all, k) => all.concat(obj[k]), []);
}

// ---------- 主入口 ----------
// ctx: { pet, history, mood, activityLabel, sceneName }
// mood 由调用方传入（小程序端取 petLife 的当前心情，云函数端由前端随请求带上）。
// 这里不自己去读 storage —— 云函数没有 wx API，那正是原实现搬不过去的根本原因。
function reply(text, ctx, rand) {
  const c = ctx || {};
  const r = rand || Math.random;
  const pet = c.pet || {};
  const history = c.history || [];
  const intent = detect(text);

  // 情绪：意图倾向是基准，但它此刻的心情有 35% 概率盖过去。
  // 不这样的话，心情就永远体现不出来——「我想你了」不管它是委屈还是开心都回同一句。
  const liveMood = c.mood || 'happy';
  const prefer = INTENT_MOOD[intent];
  let emotion = prefer || liveMood;
  if (prefer && liveMood !== prefer && r() < 0.35) emotion = liveMood;
  if (!prefer && r() < 0.3) emotion = liveMood;
  if (liveMood === 'sleepy' && (intent === 'chat' || intent === 'question') && r() < 0.4) emotion = 'sleepy';

  // 取回复
  const byMood = POOLS[intent];
  let pool = (byMood && byMood[emotion]) || (byMood && byMood.curious) || (byMood ? flatten(byMood) : []);
  if (!pool.length) pool = POOLS.chat.curious;

  // 防复读：历史上存的是「加工后」的完整句子（带拟声词和尾巴），
  // 池里是原文，所以要用包含判断而不是相等判断，否则这条规则永远不会生效。
  const recent = history.filter((m) => m.role === 'pet').slice(-3).map((m) => String(m.content || ''));
  const fresh = pool.filter((p) => !recent.some((r2) => r2.indexOf(p) >= 0));
  let content = pick(fresh.length ? fresh : pool, r);

  // 动态内容：它此刻正在做什么 / 它叫什么
  if (intent === 'idle') {
    const act = c.activityLabel || '发呆';
    content = pick([
      '我刚在' + act + '呢，你一说话我就跑过来啦！',
      '刚才还在' + act + '，现在满脑子都是你说的这件事～',
      '在' + act + '呀。不过陪你聊天比什么都重要～'
    ], r);
  } else if (intent === 'name') {
    const n = pet.name || '小毛球';
    content = pick([
      '我叫' + n + '呀！这是你给的名字，我最喜欢啦。',
      '（拍胸脯）本人' + n + '，你的专属毛孩子！'
    ], r);
  }

  // 语境钩子：接住上文（30% 概率追加，不抢主线）
  const hook = memoryHook(history, r);
  if (hook && intent !== 'name' && intent !== 'idle' && r() < 0.3) {
    content += ' ' + hook;
  }

  // 性格尾巴：关系越熟越容易出现，避免一上来就腻
  const tone = TONE[pet.personality] || TONE.friendly;
  const warmth = warmthOf(history);
  const tailRate = [0, 0.35, 0.5, 0.62][warmth] || 0.35;
  if (r() < tailRate) content = joinTail(content, pick(tone.tail, r));

  // 拟声词开头：有概率，不是每句都加
  const sound = soundOf(pet);
  if (sound && r() < 0.5) content = sound + content;

  return { content, isDemo: true, emotion, intent, warmth };
}

// 给真模型用：把「此刻的它」翻译成一句人话，注入 system prompt。
// 这样接了大模型之后，心情和它正在做的事也能被模型感知，不是只有规则引擎才有生命感。
function describeForPrompt(ctx) {
  const c = ctx || {};
  const bits = [];
  const moodText = c.moodText || '';
  if (moodText) bits.push('它此刻' + moodText);
  if (c.activityLabel) bits.push('刚才正在' + c.activityLabel);
  if (c.sceneName) bits.push('你们现在在' + c.sceneName);
  return bits.length ? bits.join('，') + '。' : '';
}

module.exports = { reply, detect, describeForPrompt, warmthOf, moodTextOf, MOOD_TEXT, POOLS, TONE };
