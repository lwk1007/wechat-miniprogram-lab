// 性格 → 具体表现
//
// 为什么不用「活泼」「贪吃」这种词直接给模型：
// 抽象形容词对大模型没有约束力，模型不知道该把「活泼」演成什么样。
// 检索到的角色扮演实践里一致的做法是——把性格翻译成「具体场景下的动作」，
// 再补负面约束（禁止什么）和口头禅（可模仿的语言样本），角色一致性才稳。
//
// 所以这里做两层：
//   1. BASE：4 个基底性格各自给出「被摸/喂食/玩耍/被拎起」四个场景的具体反应
//   2. persona：用户可覆盖任意一项，没填的用基底兜底
//
// 同一份数据被两处消费：
//   - companion / desktop 互动飘字（喂食、摸摸、玩耍、提溜）
//   - pet-edit 展示层（summary 一行摘要）
//
// 注意：这里的文案池只在小程序端用，云函数不引用（云函数是独立部署包）。

const SCENES = ['touch', 'feed', 'play', 'lift'];
const SCENE_LABEL = {
  touch: '被摸摸时',
  feed: '吃东西时',
  play: '玩耍时',
  lift: '被拎起来时'
};
const SCENE_PLACEHOLDER = {
  touch: '例：把脑袋往你手心顶，尾巴慢慢摇',
  feed: '例：先看看你，等你点头才吃',
  play: '例：叼着玩具放你脚边，然后坐好等你',
  lift: '例：不挣扎，就委屈地看着你'
};

const BASE = {
  loyal: {
    label: '忠心',
    desc: '一直守在你身边',
    traits: ['专一', '安静', '护着你'],
    speech: '话不多，短句，习惯先应一声再说事',
    catchphrase: '我在呢',
    quirk: '你出门时会趴在门口等',
    scenes: {
      touch: ['把脑袋往你手心顶，尾巴慢慢摇', '一动不动让你摸，眼睛一直看着你'],
      feed: ['先看看你，等你点头才低头吃', '吃完会回来蹭一下你的手'],
      play: ['叼着玩具放你脚边，然后坐好等你扔', '你扔出去它就冲，捡回来一定放回你手上'],
      lift: ['不挣扎，就是委屈地看着你', '身体绷住，尾巴夹起来又慢慢放开']
    }
  },
  lively: {
    label: '活泼',
    desc: '蹦蹦跳跳停不下来',
    traits: ['好动', '好奇', '爱闹'],
    speech: '语速快，句子短，爱用感叹和重复',
    catchphrase: '来来来',
    quirk: '听到塑料袋响就以为要出去玩',
    scenes: {
      touch: ['一个翻身把肚皮亮给你', '绕着你转两圈再凑过来'],
      feed: ['原地转两圈才低头吃', '吃两口抬头看你，像在确认你还在'],
      play: ['扑上去又弹开，非要你追它', '自己叼着球跑一圈，再回来丢给你'],
      lift: ['四条腿在空中划水', '被拎起来还想舔你的手']
    }
  },
  foodie: {
    label: '贪吃',
    desc: '看到吃的就走不动',
    traits: ['嘴馋', '护食', '鼻子灵'],
    speech: '三句不离吃的，容易跑题到零食',
    catchphrase: '有吃的吗',
    quirk: '你一开冰箱它就到',
    scenes: {
      touch: ['敷衍地蹭一下，眼睛盯着你的口袋', '任你摸，但鼻子在你手上闻来闻去'],
      feed: ['还没放下就凑过来了', '吃完舔舔嘴，抬头问你还有没有'],
      play: ['玩两下就跑回饭碗旁边', '把玩具当成吃的咬两口再放下'],
      lift: ['被拎起来还伸着舌头', '在半空扭两下，眼睛还在找吃的']
    }
  },
  friendly: {
    label: '亲人',
    desc: '温柔又粘人',
    traits: ['黏人', '温和', '爱撒娇'],
    speech: '语气软，爱用叠词，喜欢反问你',
    catchphrase: '抱抱嘛',
    quirk: '你坐下它一定要挨着',
    scenes: {
      touch: ['眯起眼睛往你怀里钻', '把整个身子靠过来，重量全给你'],
      feed: ['吃一口抬头看你一眼', '吃完把下巴搁在你腿上'],
      play: ['玩着玩着就要靠在你身上', '玩一半停下来，用头顶你的手'],
      lift: ['顺势把爪子搭在你肩上', '被拎起来就往你脸边凑']
    }
  }
};

// 补充特质词：给用户一个低门槛的「多加几个词」入口，
// 自由输入框对大多数人是负担，chip 更好点。
const TRAIT_OPTIONS = [
  '黏人', '高冷', '胆小', '好奇', '护食', '爱睡', '爱叫', '独立',
  '温柔', '傲娇', '憨', '机灵', '爱干净', '怕生', '爱撒娇', '有脾气'
];

function isEmpty(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function baseOf(key) {
  return BASE[key] || BASE.friendly;
}

// 把 pets 文档里的 personality + persona 合并成一份完整设定
// 用户填了就用用户的，没填用基底的第一条（对话用固定的一条，避免语境前后不一致）
function normalize(pet) {
  const p = pet || {};
  // 未知/缺失的性格回落到亲人，返回的 base 必须是实际生效的那个键，
  // 否则下游拿 'not-exist' 去查表会一路拿到 undefined
  const baseKey = BASE[p.personality] ? p.personality : 'friendly';
  const base = baseOf(baseKey);
  const custom = p.persona || {};
  const customScenes = custom.scenes || {};

  const scenes = {};
  SCENES.forEach((k) => {
    scenes[k] = isEmpty(customScenes[k])
      ? base.scenes[k][0]
      : String(customScenes[k]).trim();
  });

  const traits = Array.isArray(custom.traits)
    ? custom.traits.filter((t) => !isEmpty(t)).slice(0, 3)
    : [];

  return {
    base: baseKey,
    label: base.label,
    desc: base.desc,
    traits: traits.length ? traits : base.traits,
    customTraits: traits,
    speech: isEmpty(custom.speech) ? base.speech : String(custom.speech).trim(),
    catchphrase: isEmpty(custom.catchphrase) ? base.catchphrase : String(custom.catchphrase).trim(),
    quirk: isEmpty(custom.quirk) ? base.quirk : String(custom.quirk).trim(),
    scenes,
    // 标记哪些是用户自己写的，UI 上可以提示「已自定义」
    customized: {
      traits: traits.length > 0,
      speech: !isEmpty(custom.speech),
      catchphrase: !isEmpty(custom.catchphrase),
      quirk: !isEmpty(custom.quirk),
      scenes: SCENES.filter((k) => !isEmpty(customScenes[k]))
    }
  };
}

// 互动场景取一条文案。用户自定义的优先，预设的随机（避免每次同一句）
function reaction(pet, scene) {
  const p = pet || {};
  const custom = (p.persona && p.persona.scenes && p.persona.scenes[scene]) || '';
  if (!isEmpty(custom)) return String(custom).trim();
  const base = baseOf(p.personality);
  const pool = (base.scenes && base.scenes[scene]) || [''];
  return pool[Math.floor(Math.random() * pool.length)];
}

// 一行摘要，用于编辑页和我的页展示
function summary(pet) {
  const n = normalize(pet);
  const bits = [n.label];
  if (n.customTraits.length) bits.push(n.customTraits.join('、'));
  bits.push('口头禅「' + n.catchphrase + '」');
  return bits.join(' · ');
}

// 给「我的」页展示用：这句话说明性格真的在起作用，不是个标签
function previewLine(pet) {
  const n = normalize(pet);
  return '被摸摸时，它会' + n.scenes.touch;
}

function emptyPersona() {
  return {
    traits: [],
    speech: '',
    catchphrase: '',
    quirk: '',
    scenes: { touch: '', feed: '', play: '', lift: '' }
  };
}

// 提交前清洗：去空白、限长，防止塞进超长文本撑爆 prompt
function sanitize(input) {
  const p = input || {};
  const out = {};
  const traits = Array.isArray(p.traits)
    ? p.traits.map((t) => String(t).trim()).filter((t) => t && t.length <= 8).slice(0, 3)
    : [];
  if (traits.length) out.traits = traits;

  const clip = (v, max) => {
    const s = isEmpty(v) ? '' : String(v).trim();
    return s ? s.slice(0, max) : '';
  };
  const speech = clip(p.speech, 40);
  const catchphrase = clip(p.catchphrase, 12);
  const quirk = clip(p.quirk, 40);
  if (speech) out.speech = speech;
  if (catchphrase) out.catchphrase = catchphrase;
  if (quirk) out.quirk = quirk;

  const scenes = {};
  SCENES.forEach((k) => {
    const v = clip((p.scenes || {})[k], 40);
    if (v) scenes[k] = v;
  });
  if (Object.keys(scenes).length) out.scenes = scenes;

  return out;
}

module.exports = {
  SCENES,
  SCENE_LABEL,
  SCENE_PLACEHOLDER,
  TRAIT_OPTIONS,
  BASE,
  normalize,
  reaction,
  summary,
  previewLine,
  emptyPersona,
  sanitize
};
