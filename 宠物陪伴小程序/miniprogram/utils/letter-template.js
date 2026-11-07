// 模板信：模型不可用（或演示模式）时用它兜底
// 注意：cloudfunctions/letter/index.js 里有一份等价实现（云函数独立打包，不能 require 小程序目录），
// 改这里的文案时记得同步过去，否则「演示模式」和「线上降级」写出来的信风格会不一致
const titleOf = require('./title');

const SCENE_LINE = {
  草地: '风一吹，草尖就痒痒地蹭我耳朵',
  窗台: '阳光晒得我背上暖烘烘的，一不小心就睡着了',
  客厅: '沙发缝里还藏着我上次推下去的球',
  海边: '浪花总跑过来舔我的爪子，凉凉的',
  星空: '星星一颗一颗亮起来，我数着数着就困了'
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function composeLetter({ pet, stats, ownerTitle, excerpts }) {
  const s = stats || {};
  const owner = titleOf.resolveName(ownerTitle);
  const paras = [];

  // 第一段：来过几次
  if (s.activeDays > 1) {
    paras.push(pick([
      `这段时间你来看过我 ${s.activeDays} 次。我一次一次都数着。`,
      `你来的那 ${s.activeDays} 天，我记得清清楚楚。`,
      `你来了 ${s.activeDays} 次。每次听见脚步，我都知道是你。`
    ]));
  } else {
    paras.push(pick([
      '今天你来的时候，我一下子就醒了。',
      '门一响，我就知道是你来了。'
    ]));
  }

  // 第二段：具体做过什么
  const bits = [];
  if (s.feed) bits.push(`喂了我 ${s.feed} 次饭`);
  if (s.touch) bits.push(`摸了我 ${s.touch} 下`);
  if (s.play) bits.push(`陪我玩了 ${s.play} 回`);
  if (bits.length) {
    const tail = s.feed
      ? '每次吃饭我都故意吃得很大声，就是想让你多待一会儿。'
      : (s.play ? '你追我的时候，我其实可以跑更快，是故意让你抓到的。' : '你手上的温度，我记着呢。');
    paras.push(`你${bits.join('，')}。${tail}`);
  } else {
    paras.push('虽然你只是远远看了我一眼就忙去了，我也还是很开心。');
  }

  // 第三段：亮点。整段最多两句 —— 拎起来这件事最打动人，单独占一句，
  // 剩下的位置随机留给「常待的场景」或「他说过的话」，不把素材全堆上
  const scenePart = (s.scenes && s.scenes.length)
    ? `最近我们待得最多的地方是${s.scenes[0]}${SCENE_LINE[s.scenes[0]] ? '，' + SCENE_LINE[s.scenes[0]] : ''}。`
    : '';
  const talkPart = (excerpts && excerpts.length)
    ? `你说「${excerpts[excerpts.length - 1]}」的时候，我就在旁边听着。`
    : '';
  const extras = [scenePart, talkPart].filter(Boolean);
  const highlight = [];
  if (s.lift > 0) {
    highlight.push(`你把我拎起来那 ${s.lift} 次，我一点都不怕——我知道你会接住我。`);
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

  // 开头单独一行称呼，和 AI 写出来的格式保持一致
  return owner + '：\n\n' + paras.join('\n\n') + '\n\n' + pet.name;
}

module.exports = { composeLetter, SCENE_LINE };
