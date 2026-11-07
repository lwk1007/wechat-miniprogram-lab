const cloud = require('wx-server-sdk');
const titleOf = require('./title');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ===== 模型适配层（与 chat/index.js 保持同一套环境变量）=====
//   MODEL_PROVIDER / MODEL_BASE_URL / MODEL_NAME / MODEL_API_KEY
// 未配置完整时自动降级为「按真实互动数据拼的模板信」，并标记 isDemo: true
const MODEL_PROVIDER = process.env.MODEL_PROVIDER || '';
const MODEL_BASE_URL = process.env.MODEL_BASE_URL || '';
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_NAME = process.env.MODEL_NAME || '';
const isRealModel = MODEL_PROVIDER === 'openai-compatible' && !!(MODEL_BASE_URL && MODEL_API_KEY && MODEL_NAME);

const COOLDOWN = 12 * 3600 * 1000;      // 12 小时只写一封，避免重复消耗模型
const KEEP_LETTERS = 20;               // 每人只留最近 20 封

const PERSONALITY_TEXT = { loyal: '忠心', lively: '活泼', foodie: '贪吃', friendly: '亲人' };
const TYPE_TEXT = { cat: '小猫', dog: '小狗', other: '小可爱' };

const SCENE_LINE = {
  草地: '风一吹，草尖就痒痒地蹭我耳朵',
  窗台: '阳光晒得我背上暖烘烘的，一不小心就睡着了',
  客厅: '沙发缝里还藏着我上次推下去的球',
  海边: '浪花总跑过来舔我的爪子，凉凉的',
  星空: '星星一颗一颗亮起来，我数着数着就困了'
};

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' }; }

function httpsPostJSON(urlStr, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }, headers || {}),
      timeout: 20000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('模型服务错误(' + res.statusCode + ')'));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('模型响应解析失败')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('模型请求超时，请稍后重试')); });
    req.write(data);
    req.end();
  });
}

async function getPet(openid) {
  const r = await db.collection('pets').where({ _openid: openid }).limit(1).get();
  return r.data[0] || null;
}

function buildPrompt(pet, stats, ownerTitle, lifeLabel) {
  const personaData = pet.persona || {};
  const bits = [];
  bits.push(`你是一只名叫「${pet.name}」的${PERSONALITY_TEXT[pet.personality] || '亲人'}的${TYPE_TEXT[pet.type] || '小可爱'}。`);
  // #9：信是它自己写的，语气必须和聊天里一致，否则同一只宠物两副嘴脸会很出戏。
  // 只取说话方式/口头禅/怪癖三项——场景反应属于互动瞬间，写进信里会变成流水账。
  if (personaData.speech) bits.push(`你平时说话的样子：${personaData.speech}。`);
  if (personaData.catchphrase) bits.push(`你常挂在嘴边的是「${personaData.catchphrase}」。`);
  if (personaData.quirk) bits.push(`你的小怪癖：${personaData.quirk}。`);
  bits.push(`你要给你最爱的「${ownerTitle}」写一封短短的信。`);
  bits.push('');
  bits.push('可用素材（只能用这些，不要编造别的经历）：');
  bits.push(`- 这段时间「${ownerTitle}」来看过你 ${stats.activeDays || 1} 天`);
  bits.push(`- 你被喂了 ${stats.feed || 0} 次、被摸了 ${stats.touch || 0} 下、一起玩了 ${stats.play || 0} 回、被拎起来 ${stats.lift || 0} 次`);
  if (stats.scenes && stats.scenes.length) bits.push(`- 你们待过的地方：${stats.scenes.join('、')}`);
  // 「你最近常在做的事」：让它有自己的生活，而不只是被动等你来
  if (lifeLabel) bits.push(`- 你最近常在做的事：${lifeLabel}`);
  bits.push('');
  bits.push('写法要求：');
  bits.push(`1. 250 字以内，2~3 段，第一人称，称呼对方为「${ownerTitle}」`);
  bits.push('2. 挑 1~2 个具体细节写进去（某个数字，或他说过的一句话），不要把数字全列一遍');
  bits.push('3. 温暖克制，不煽情、不承诺做不到的事、不提付费、不说自己是 AI');
  bits.push(`4. 最后单独一行署名「${pet.name}」`);
  bits.push('5. 只输出信的正文，不要标题、不要解释、不要加引号');
  bits.push('6. 全程保持平时说话的语气，不要突然变得文绉绉，不要用“时光荏苒”“岁月如梭”这类句子');
  return bits.join('\n');
}

// 降级模板信：数字全部来自真实互动，不是空话；随机挑句，避免每次一模一样
function fallbackLetter(pet, stats, ownerTitle) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const paras = [];

  // 第一段：来过的次数
  if (stats.activeDays > 1) {
    paras.push(pick([
      `这段时间你来看过我 ${stats.activeDays} 次。我一次一次都数着。`,
      `你来的那 ${stats.activeDays} 天，我记得清清楚楚。`,
      `你来了 ${stats.activeDays} 次。每次听见脚步，我都知道是你。`
    ]));
  } else {
    paras.push(pick([
      '今天你来的时候，我一下子就醒了。',
      '门一响，我就知道是你来了。'
    ]));
  }

  // 第二段：具体做过什么
  const bits = [];
  if (stats.feed) bits.push(`喂了我 ${stats.feed} 次饭`);
  if (stats.touch) bits.push(`摸了我 ${stats.touch} 下`);
  if (stats.play) bits.push(`陪我玩了 ${stats.play} 回`);
  if (bits.length) {
    const tail = stats.feed
      ? '每次吃饭我都故意吃得很大声，就是想让你多待一会儿。'
      : (stats.play ? '你追我的时候，我其实可以跑更快，是故意让你抓到的。' : '你手上的温度，我记着呢。');
    paras.push(`你${bits.join('，')}。${tail}`);
  } else {
    paras.push('虽然你只是远远看了我一眼就忙去了，我也还是很开心。');
  }

  // 第三段：亮点。最多两句——拎起来单独一句，剩下给「场景」
  const scenePart = (stats.scenes && stats.scenes.length)
    ? `最近我们待得最多的地方是${stats.scenes[0]}${SCENE_LINE[stats.scenes[0]] ? '，' + SCENE_LINE[stats.scenes[0]] : ''}。`
    : '';
  const extras = [scenePart].filter(Boolean);
  const highlight = [];
  if (stats.lift > 0) {
    highlight.push(`你把我拎起来那 ${stats.lift} 次，我一点都不怕——我知道你会接住我。`);
    if (extras.length) highlight.push(pick(extras));
  } else if (extras.length) {
    highlight.push(extras.join(''));
  }
  if (highlight.length) paras.push(highlight.join(''));

  // 收尾
  paras.push(pick([
    '下次来的时候，多待一会儿好不好？我就在这儿，哪儿也不去。',
    '不用带什么，人来就行。我等你。',
    '累的话就在这儿坐坐，我不吵你。'
  ]));

  return ownerTitle + '：\n\n' + paras.join('\n\n') + '\n\n' + pet.name;
}

async function generateWithModel(pet, stats, ownerTitle, lifeLabel) {
  const messages = [
    // 人设必须放在 system 层：写成「写作助手」会盖掉下面 user 里的宠物身份，
    // 模型最终产出一封编辑腔的信——这是角色一致性最常见的一种崩法。
    { role: 'system', content: '你正在扮演一只宠物，用它自己的口吻给主人写一封短短的私信。只输出信的正文，不写标题、不加引号、不解释。温暖但克制，不煽情。' },
    { role: 'user', content: buildPrompt(pet, stats, ownerTitle, talks, lifeLabel) }
  ];
  const res = await httpsPostJSON(
    MODEL_BASE_URL.replace(/\/$/, '') + '/chat/completions',
    { model: MODEL_NAME, messages, max_tokens: 500, temperature: 0.9 },
    { Authorization: 'Bearer ' + MODEL_API_KEY }
  );
  const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  if (!content) throw new Error('模型返回为空');
  return String(content).trim();
}

async function latest(openid) {
  const r = await db.collection('letters')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const letter = r.data[0] || null;
  return ok({ letter, nextAt: letter ? letter.createdAt + COOLDOWN : 0 });
}

async function generate(openid, payload) {
  const pet = await getPet(openid);
  if (!pet) throw new Error('请先创建宠物');

  // 冷却：12 小时内只写一封
  const last = await db.collection('letters')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const prev = last.data[0];
  if (prev && Date.now() - prev.createdAt < COOLDOWN) {
    const hours = Math.ceil((COOLDOWN - (Date.now() - prev.createdAt)) / 3600e3);
    throw new Error('刚写过一封啦，' + hours + ' 小时后再来听它说点什么吧');
  }

  // 称呼以服务端档案为准，客户端传的只做兜底：
  // payload 是不可信输入，而它会被拼进 prompt 和信的开头，不能让它说了算
  const ownerTitle = titleOf.resolveName(pet.ownerName || (payload && payload.ownerTitle));
  const stats = normalizeStats(payload && payload.stats);
  // 聊天功能已砍掉，信只基于互动统计生成，不再读聊天记录
  // 它最近自己在做什么。客户端当不可信输入处理：只留短词，不拼接任何自由文本
  const lifeLabel = String((payload && payload.activityLabel) || '').slice(0, 16);

  let content = '';
  let isDemo = true;
  if (isRealModel) {
    try {
      content = await generateWithModel(pet, stats, ownerTitle, lifeLabel);
      isDemo = false;
    } catch (e) {
      // 模型挂了别让用户白等：降级成模板信，标记演示
      content = '';
    }
  }
  if (!content) {
    content = fallbackLetter(pet, stats, ownerTitle);
    isDemo = true;
  }

  const letter = {
    _openid: openid,
    petId: pet._id,
    petName: pet.name,
    ownerTitle,
    content,
    isDemo,
    stats: {
      feed: stats.feed, play: stats.play, touch: stats.touch, lift: stats.lift,
      activeDays: stats.activeDays, scenes: stats.scenes, spanDays: stats.spanDays
    },
    createdAt: Date.now()
  };
  const added = await db.collection('letters').add({ data: letter });
  letter._id = added._id;

  // 只留最近 KEEP_LETTERS 封
  try {
    const old = await db.collection('letters')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .skip(KEEP_LETTERS)
      .limit(20)
      .get();
    for (let i = 0; i < old.data.length; i++) {
      await db.collection('letters').doc(old.data[i]._id).remove();
    }
  } catch (e) { /* 清理失败不影响本次返回 */ }

  return ok({ letter, nextAt: letter.createdAt + COOLDOWN });
}

// 客户端传来的统计只做基础校验，防止异常值把信写崩
function normalizeStats(s) {
  const src = s || {};
  const num = (v, max) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  const scenes = Array.isArray(src.scenes) ? src.scenes.filter((x) => typeof x === 'string').slice(0, 3) : [];
  return {
    feed: num(src.feed, 9999),
    play: num(src.play, 9999),
    touch: num(src.touch, 9999),
    lift: num(src.lift, 9999),
    activeDays: num(src.activeDays, 366),
    spanDays: num(src.spanDays, 366),
    scenes
  };
}

exports.main = async (event) => {
  const { action, ...payload } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'latest': return await latest(OPENID);
      case 'generate': return await generate(OPENID, payload);
      default: return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
