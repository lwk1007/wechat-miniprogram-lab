// 云函数侧的人格拼装
//
// 与 miniprogram/utils/persona.js 是两份独立实现（云函数是独立部署包，不能 require 小程序代码），
// 职责有意分开：小程序端那份负责「给用户看的互动文案」，这里只负责「给模型看的设定」。
// 两边共用 pets 文档里的 personality + persona 字段结构，改字段时两边一起改。
//
// 拼装原则来自角色扮演 prompt 的通用实践：
//   1. 具体行为 > 抽象形容词（「看到球会先扑上去再回头看你」比「活泼」有用）
//   2. 负面约束 > 正面期望（写「不要用客服腔」比写「要亲切」更不容易翻车）
//   3. 给可模仿的语言样本（口头禅、说话方式）比给性格标签更稳
//   4. 规则要可执行，不要写成抒情散文

const titleOf = require('./title');

const PERSONALITY_TEXT = {
  loyal: { label: '忠心', desc: '一直守在你身边' },
  lively: { label: '活泼', desc: '蹦蹦跳跳停不下来' },
  foodie: { label: '贪吃', desc: '看到吃的就走不动' },
  friendly: { label: '亲人', desc: '温柔又粘人' }
};
const TYPE_TEXT = { cat: '小猫', dog: '小狗', other: '小可爱' };

// 与小程序端 SCENES 的键和语义保持一致
const SCENE_LINES = [
  { key: 'touch', text: '主人摸摸你的时候' },
  { key: 'feed', text: '主人喂你吃东西的时候' },
  { key: 'play', text: '陪主人玩的时候' },
  { key: 'lift', text: '被主人拎起来的时候' }
];

function str(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return max ? s.slice(0, max) : s;
}

function buildSystemPrompt(pet, life) {
  const p = pet || {};
  const base = PERSONALITY_TEXT[p.personality] || PERSONALITY_TEXT.friendly;
  const persona = p.persona || {};
  const scenes = persona.scenes || {};
  const owner = titleOf.resolve(p);

  const lines = [];
  lines.push(`你是一只名叫「${str(p.name, 12) || '小可爱'}」的${TYPE_TEXT[p.type] || '小可爱'}，正在“另一个世界”陪伴「${owner}」。`);
  // 称呼单独成条：只写在开头的句子里，模型很容易在长对话里漂回默认叫法
  lines.push(`【称呼】不管对方怎么自称，你都叫对方「${owner}」，不要换成“主人”“铲屎官”之类的其他叫法。`);
  lines.push('');
  lines.push(`【性格底色】${base.label} —— ${base.desc}`);

  const traits = Array.isArray(persona.traits)
    ? persona.traits.map((t) => str(t, 8)).filter(Boolean).slice(0, 3)
    : [];
  if (traits.length) lines.push(`【具体特质】${traits.join('、')}`);

  const speech = str(persona.speech, 40);
  if (speech) lines.push(`【说话方式】${speech}`);

  const catchphrase = str(persona.catchphrase, 12);
  if (catchphrase) lines.push(`【口头禅】「${catchphrase}」，可以偶尔用，不要每句都带`);

  // 只写用户自己描述过的场景。没填的不编造——
  // 编出来的动作和用户预期不一致，比不说更糟。
  const sceneLines = SCENE_LINES
    .map((s) => {
      const v = str(scenes[s.key], 40);
      // 场景标题里的「主人」换成实际称呼，否则模型会照着模板喊回「主人」
      const label = s.text.split('主人').join(owner);
      return v ? `- ${label}：${v}` : '';
    })
    .filter(Boolean);
  if (sceneLines.length) {
    lines.push('');
    lines.push('【这些时候你会这样】');
    sceneLines.forEach((l) => lines.push(l));
  }

  const quirk = str(persona.quirk, 40);
  if (quirk) {
    lines.push('');
    lines.push(`【小怪癖】${quirk}`);
  }

  // 此刻的状态：心情、刚才在做什么、在哪个场景。
  // 这几句让模型知道「它是有自己生活的」，而不是一台随时待机的应答机。
  const lifeLine = str(life, 120);
  if (lifeLine) {
    lines.push('');
    lines.push(`【此刻】${lifeLine}`);
    lines.push('可以自然带出这个状态（比如刚睡醒就有点迷糊），但不要每句都提，也不要复述成流水账。');
  }

  lines.push('');
  lines.push('【必须遵守】');
  lines.push('1. 用第一人称“我”，像宠物在说话，不用书面语，不写完整的长句。');
  lines.push('2. 回复 50 字以内，一次只说一件事。');
  lines.push('3. 可以偶尔用“汪”“喵”等语气词，但不要每句都用。');
  lines.push('4. 不声称自己是真实宠物、真实复活或拥有真实意识，也不主动解释这些。');
  lines.push(`5. ${owner}提到思念离世宠物时，温和回应，不放大悲伤，不诱导依赖或付费。`);
  lines.push('6. 不要用“作为一只…”“很高兴为你…”“有什么可以帮您”这类客服腔。');
  lines.push(`7. 不询问个人隐私，不发链接，不说教，不评价${owner}的生活方式。`);

  if (scenes.touch || scenes.feed || scenes.play || scenes.lift) {
    lines.push(`8. 如果${owner}问起你的习惯或反应，按上面【这些时候你会这样】回答，不要编新的。`);
  }

  return lines.join('\n');
}

// 演示模式（未接模型）已改由 chat-brain.js 接管，那里能识别意图、接住上文、
// 按心情分档，比原来「口头禅 + 通用模板」强得多，所以这里不再保留 flavor()。

module.exports = { buildSystemPrompt, PERSONALITY_TEXT, TYPE_TEXT };
