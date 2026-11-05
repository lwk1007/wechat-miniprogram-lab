const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

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

const CONTEXT_LIMIT = 10;   // 携带的历史上下文条数
const MIN_INTERVAL = 1500;  // 两次发送最小间隔（毫秒），基础频率限制
const HISTORY_KEEP_MS = 90 * 24 * 3600 * 1000; // 对话历史保留 90 天

const PERSONALITY_TEXT = {
  loyal: '忠心',
  lively: '活泼',
  foodie: '贪吃',
  friendly: '亲人'
};
const TYPE_TEXT = { cat: '小猫', dog: '小狗', other: '小可爱' };

function ok(data) { return { ok: true, data }; }
function fail(e) { return { ok: false, error: (e && e.message) || '服务异常，请稍后重试' }; }

function buildSystemPrompt(pet) {
  const owner = pet.ownerName ? `主人${pet.ownerName}` : '主人';
  return [
    `你是一只名叫「${pet.name}」的${PERSONALITY_TEXT[pet.personality] || '亲人'}的${TYPE_TEXT[pet.type] || '小可爱'}，正在“另一个世界”陪伴${owner}。`,
    '请遵守：',
    '1. 这是 AI 宠物陪伴，回复保持宠物口吻，简短温暖，50 字以内。',
    '2. 可以偶尔用“汪”“喵”等语气词，但不要每句都用。',
    '3. 不声称自己是真实宠物、真实复活或拥有真实意识。',
    '4. 主人提到思念离世宠物时，温和回应，不放大悲伤，不诱导依赖或付费。',
    '5. 不询问个人隐私，不发送链接，不说教。'
  ].join('\n');
}

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
    const messages = [{ role: 'system', content: buildSystemPrompt(pet) }]
      .concat(contextMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })));
    const res = await httpsPostJSON(
      MODEL_BASE_URL.replace(/\/$/, '') + '/chat/completions',
      { model: MODEL_NAME, messages, max_tokens: 120, temperature: 0.8 },
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
    pool = [
      '嗯嗯，我在听呢，然后呢？',
      '你说的我都记住啦（演示模式下我不会真的记住哦）。',
      '和你聊天的时光最开心了。',
      '嗯…总之，我一直陪着你！'
    ];
  }
  const sound = pet.type === 'cat' ? '喵～' : pet.type === 'dog' ? '汪！' : '';
  let reply = pool[Math.floor(Math.random() * pool.length)];
  if (sound && Math.random() < 0.3) reply = sound + reply;
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
    .limit(CONTEXT_LIMIT)
    .get();

  const reply = await generateReply(pet, ctxMsgs.data.slice().reverse());

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
