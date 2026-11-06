const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const persona = require('./persona');
const brain = require('./chat-brain');

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

// 性格影响随机度：活泼/贪吃说得更跳一点，忠心/亲人更稳；
// 心情再叠一层：困了/委屈了收一点，想闹了放一点
function temperatureOf(pet, mood) {
  const base = { loyal: 0.7, friendly: 0.8, lively: 0.95, foodie: 0.9 }[pet && pet.personality] || 0.8;
  const delta = { playful: 0.08, sleepy: -0.12, sulk: -0.1, grumpy: 0.05 }[mood] || 0;
  return Math.max(0.5, Math.min(1, Math.round((base + delta) * 100) / 100));
}

// 客户端传来的状态字段一律当不可信输入处理：限长、限枚举
const MOOD_KEYS = ['happy', 'playful', 'calm', 'sleepy', 'curious', 'shy', 'sulk', 'grumpy'];
function cleanLife(payload) {
  const p = payload || {};
  const mood = MOOD_KEYS.indexOf(p.mood) >= 0 ? p.mood : '';
  return {
    mood,
    activityLabel: String(p.activityLabel || '').slice(0, 16),
    sceneName: String(p.sceneName || '').slice(0, 12)
  };
}

// 演示模式（无模型）已改由 chat-brain.js 接管：
// 它能识别意图、按心情分档、接住上文、按关系温度调语气、防复读，
// 比原来「性格专属 4 条池+口头禅」强一个量级，而且小程序端用的是同一份代码。

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

// 统一出口：真实模型或规则引擎，调用方无需关心差异
// life: { mood, activityLabel, sceneName } —— 由客户端带上它此刻的状态
async function generateReply(pet, contextMessages, life) {
  const l = life || {};
  if (isRealModel) {
    // 把「此刻的它」也塞进 system，让模型知道它有心情、有正在做的事
    const system = persona.buildSystemPrompt(pet, brain.describeForPrompt({
      moodText: brain.moodTextOf(l.mood),
      activityLabel: l.activityLabel,
      sceneName: l.sceneName
    }));
    const messages = [{ role: 'system', content: system }]
      .concat(contextMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      })));
    const res = await httpsPostJSON(
      MODEL_BASE_URL.replace(/\/$/, '') + '/chat/completions',
      { model: MODEL_NAME, messages, max_tokens: 160, temperature: temperatureOf(pet, l.mood) },
      { Authorization: 'Bearer ' + MODEL_API_KEY }
    );
    const content = res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
    if (!content) throw new Error('模型返回为空');
    return { content: String(content).trim(), isDemo: false };
  }

  // 规则引擎：和客户端 localdb 用的是同一份 chat-brain.js
  const last = contextMessages.filter((m) => m.role === 'user').slice(-1)[0];
  const out = brain.reply((last && last.content) || '', {
    pet,
    history: contextMessages,
    mood: l.mood,
    activityLabel: l.activityLabel,
    sceneName: l.sceneName
  });
  return { content: out.content, isDemo: true, emotion: out.emotion };
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

async function send(openid, payload) {
  const content = (payload.text || '').trim();
  if (!content) throw new Error('说点什么吧');
  if (content.length > 300) throw new Error('一条消息最多 300 字');

  const pet = await getPet(openid);
  if (!pet) throw new Error('请先创建宠物');

  const life = cleanLife(payload);

  // 一次查询拿到两样东西：限流判断要的「上一条用户消息」，和生成回复要的上下文。
  // 原来这里是两次几乎相同的查询（一次 limit 1 判限流、一次 limit 24 取上下文），
  // 合并之后每条消息少一次数据库往返。
  const now = Date.now();
  const recent = await db.collection('messages')
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(24)
    .get();

  const lastUser = recent.data.filter((m) => m.role === 'user')[0];
  if (lastUser && now - lastUser.createdAt < MIN_INTERVAL) {
    throw new Error('它还在想上一句话呀，稍等一下再发～');
  }

  await db.collection('messages').add({
    data: { _openid: openid, petId: pet._id, role: 'user', content, isDemo: false, createdAt: now }
  });

  // 把刚发的这条并进上下文再裁剪，否则最新一句可能被字数上限挤掉
  const contextMessages = trimContext([{ role: 'user', content, createdAt: now }].concat(recent.data));

  const reply = await generateReply(pet, contextMessages, life);

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
