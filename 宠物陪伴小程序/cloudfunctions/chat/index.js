const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const persona = require('./persona');

// ===== 模型适配层（可替换 Provider）=====
// 通过云函数环境变量配置，密钥只存在于服务端：
//   MODEL_PROVIDER : 'openai-compatible'（当前实现的适配器）
//   MODEL_BASE_URL : 如 https://api.example.com/v1
//   MODEL_NAME     : 模型名
//   MODEL_API_KEY  : 密钥（不要写进代码或提交到仓库）
// 未配置完整时自动降级为模板回复（演示模式），并在返回中标记 isDemo: true
const MODEL_PROVIDER = process.env.MODEL_PROVIDER || '';
const MODEL_BASE_URL = process.env.MODEL_BASE_URL || '';
const MODEL_API_KEY = process.env.MODEL_API_KEY || '';
const MODEL_NAME = process.env.MODEL_NAME || '';
const isRealModel = MODEL_PROVIDER === 'openai-compatible' && !!(MODEL_BASE_URL && MODEL_API_KEY && MODEL_NAME);

const CONTEXT_LIMIT = 10;   // 携带的历史上下文条数上限
// 很多便宜模型的上下文窗口不大，条数够但字数超了一样报错。
// 按字数从最近往前累加，超了就停，比单纯按条数稳。
const CONTEXT_MAX_CHARS = 1200;
const MIN_INTERVAL = 1500;  // 两次发送最小间隔（毫秒），基础频率限制
const HISTORY_KEEP_MS = 90 * 24 * 3600 * 1000; // 对话历史保留 90 天

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' }; }

// 上下文裁剪：从最近一条往前累加，条数和字数双上限
function trimContext(desc) {
  const picked = [];
  let chars = 0;
  for (let i = 0; i < desc.length && picked.length < CONTEXT_LIMIT; i++) {
    const m = desc[i];
    const len = String(m.content || '').length;
    if (chars + len > CONTEXT_MAX_CHARS && picked.length > 0) break;
    chars += len;
    picked.push(m);
  }
  return picked.reverse();
}

// 性格影响随机度：活泼/贪吃说得更跳一点，忠心/亲人更稳
function temperatureOf(pet) {
  const t = { loyal: 0.7, friendly: 0.8, lively: 0.95, foodie: 0.9 };
  return t[pet && pet.personality] || 0.8;
}

// 演示模式（无模型）下每个性格的专属应答池。
// 这是 #9 在没有接大模型时唯一能被感知到的差异，所以文案要能体现性格本身。
const DEMO_POOL = {
  loyal: [
    '我在呢，你说吧。',
    '嗯，我听着。',
    '我一直在这儿，你不用叫我。',
    '不用说什么，我来陪你坐一会儿。'
  ],
  lively: [
    '来来来，说点有意思的！',
    '你今天有没有遇到好玩的事？快说快说！',
    '我刚刚自己追着尾巴转了三圈！',
    '好好好，你说，我竖着耳朵听！'
  ],
  foodie: [
    '你说这个的时候…是不是在吃什么东西？',
    '我闻到一点点香味了，真的！',
    '等一下再说，我先咽下口水。',
    '聊点别的也行的，只要别聊减肥。'
  ],
  friendly: [
    '抱抱嘛，先抱一下再说。',
    '你说什么我都爱听。',
    '今天也想挨着你坐着。',
    '嗯…我在想你有没有想我。'
  ]
};

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
      timeout: 15000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(new Error('模型服务错误(' + res.statusCode + ')'));
        }
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('模型响应解析失败')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('模型请求超时，请稍后重试')); });
    req.write(data);
    req.end();
  });
}

// 统一出口：真实模型或演示模板，调用方无需关心差异
async function generateReply(pet, contextMessages) {
  if (isRealModel) {
    const messages = [{ role: 'system', content: persona.buildSystemPrompt(pet) }]
      .concat(contextMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })));
    const res = await httpsPostJSON(
      MODEL_BASE_URL.replace(/\/$/, '') + '/chat/completions',
      { model: MODEL_NAME, messages, max_tokens: 160, temperature: temperatureOf(pet) },
      { Authorization: 'Bearer ' + MODEL_API_KEY }
    );
    const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    if (!content) throw new Error('模型返回为空');
    return { content: String(content).trim(), isDemo: false };
  }
  // 演示模板回复：只依据最近一条用户消息做简单匹配，不假装有长期记忆
  const last = contextMessages.filter((m) => m.role === 'user').slice(-1)[0];
  const t = (last && last.content) || '';
  let pool;
  if (/想你|想念|思念/.test(t)) {
    pool = ['我也一直在呀，从来没有走远。想我的时候就来看看我吧。', '我也很想你。摸摸屏幕，就当摸摸我的头，好吗？'];
  } else if (/累|难过|不开心|烦|委屈|哭/.test(t)) {
    pool = ['辛苦啦。趴在我旁边休息一会儿吧，我陪着你。', '不开心就说出来，我会认真听的。'];
  } else if (/开心|高兴|哈哈|好玩|有趣/.test(t)) {
    pool = ['听到你开心，我的尾巴都要摇起来啦！', '嘿嘿，好事情要多多分享给我呀。'];
  } else if (/吃|饿|饭|零食/.test(t)) {
    pool = ['说到吃的我就来精神了！你也要按时吃饭哦。', '咕噜咕噜…我这边有小鱼干，分你一半！'];
  } else if (/晚安|睡觉|睡了/.test(t)) {
    pool = ['晚安，做个好梦，梦里我们一起玩。', '快去睡吧，我守着这里等你明天来。'];
  } else {
    // 没匹配到关键词时走性格专属池——这是 #9 在演示模式下唯一能被感知到的差异
    pool = DEMO_POOL[pet.personality] || DEMO_POOL.friendly;
  }
  let reply = pool[Math.floor(Math.random() * pool.length)];
  reply = persona.flavor(pet) + reply;
  return { content: reply, isDemo: true };
}

async function getPet(openid) {
  const r = await db.collection('pets').where({ _openid: openid }).limit(1).get();
  return r.data[0] || null;
}

async function history(openid) {
  const r = await db.collection('messages')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok(r.data.slice().reverse());
}

async function send(openid, { text }) {
  const content = (text || '').trim();
  if (!content) throw new Error('说点什么吧');
  if (content.length > 300) throw new Error('一条消息最多 300 字');

  const pet = await getPet(openid);
  if (!pet) throw new Error('请先创建宠物');

  // 频率限制：距离上一条消息太近则拒绝
  const lastMsg = await db.collection('messages')
    .where({ _openid: openid, role: 'user' })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (lastMsg.data[0] && Date.now() - lastMsg.data[0].createdAt < MIN_INTERVAL) {
    throw new Error('它还在想上一句话呀，稍等一下再发～');
  }

  await db.collection('messages').add({
    data: { _openid: openid, petId: pet._id, role: 'user', content, isDemo: false, createdAt: Date.now() }
  });

  const ctxMsgs = await db.collection('messages')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(24)
    .get();

  const reply = await generateReply(pet, trimContext(ctxMsgs.data));

  await db.collection('messages').add({
    data: {
      _openid: openid, petId: pet._id, role: 'pet',
      content: reply.content, isDemo: reply.isDemo, createdAt: Date.now(),
      // 对话历史保留期：到期由 cleanup 任务删除
      expiresAt: Date.now() + HISTORY_KEEP_MS
    }
  });
  return ok(reply);
}

exports.main = async (event) => {
  const { action, ...payload } = event || {};
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '身份获取失败' };
  try {
    switch (action) {
      case 'history': return await history(OPENID);
      case 'send': return await send(OPENID, payload);
      default: return { ok: false, error: '未知操作' };
    }
  } catch (e) {
    return fail(e);
  }
};
