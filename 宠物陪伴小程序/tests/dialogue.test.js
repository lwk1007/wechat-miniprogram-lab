// #9 性格自定义 断言（Node 模拟 wx 环境）
// 覆盖：人格合并/清洗、语音降级、双数据源一致性
const path = require('path');

const ROOT = path.join(__dirname, '..');
const store = new Map();

global.wx = {
  getStorageSync(k) { return store.has(k) ? store.get(k) : ''; },
  setStorageSync(k, v) { store.set(k, v); },
  removeStorageSync(k) { store.delete(k); },
  clearStorageSync() { store.clear(); },
  showToast() {},
  showModal() {},
  navigateTo() {},
  reLaunch() {},
  vibrateShort() {},
  getPrivacySetting(o) { o.success({ needAuthorization: false }); }
};

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

const persona = require(path.join(ROOT, 'miniprogram/utils/persona'));
const voice = require(path.join(ROOT, 'miniprogram/utils/voice'));
const localdb = require(path.join(ROOT, 'miniprogram/utils/localdb'));

(async function run() {
  // ---------- 一、人格合并 ----------
  console.log('\n[1] persona.normalize：基底兜底与覆盖');

  const bare = persona.normalize({ personality: 'lively' });
  ok('未自定义时取基底 label', bare.label === '活泼', bare.label);
  ok('未自定义时场景有默认值', !!bare.scenes.touch, bare.scenes.touch);
  ok('未自定义时 traits 来自基底', bare.traits.length > 0);
  ok('customized 全为 false', bare.customized.speech === false && bare.customized.quirk === false);

  const custom = persona.normalize({
    personality: 'lively',
    persona: {
      traits: ['高冷', '爱睡'],
      speech: '只说短句',
      catchphrase: '走开啦',
      quirk: '下雨天钻床底',
      scenes: { touch: '把屁股对着你', lift: '装死' }
    }
  });
  ok('自定义场景覆盖基底', custom.scenes.touch === '把屁股对着你', custom.scenes.touch);
  ok('未填的场景仍走基底', custom.scenes.feed !== '' && custom.scenes.feed !== '装死');
  ok('口头禅被采纳', custom.catchphrase === '走开啦');
  ok('customized 标出已改项', custom.customized.traits === true && custom.customized.speech === true);
  ok('customized.scenes 只列填过的', custom.customized.scenes.length === 2, custom.customized.scenes.join(','));

  const unknown = persona.normalize({ personality: 'not-exist' });
  ok('未知性格回落到亲人', unknown.base === 'friendly', unknown.base);

  const empty = persona.normalize(null);
  ok('传 null 不抛错且可用', empty.label === '亲人');

  // ---------- 二、互动文案 ----------
  console.log('\n[2] persona.reaction：自定义优先');

  const petA = { personality: 'loyal', persona: { scenes: { feed: '先等你点头' } } };
  ok('填过的场景返回原句', persona.reaction(petA, 'feed') === '先等你点头');
  const baseFeed = persona.reaction({ personality: 'loyal' }, 'feed');
  ok('没填的场景来自基底池', typeof baseFeed === 'string' && baseFeed.length > 0, baseFeed);
  const blank = persona.reaction({ personality: 'loyal', persona: { scenes: { feed: '   ' } } }, 'feed');
  ok('纯空白的自定义视为未填', blank !== '   ' && blank.length > 0, JSON.stringify(blank));

  // ---------- 三、清洗 ----------
  console.log('\n[3] persona.sanitize：限长与空值');

  const dirty = persona.sanitize({
    traits: ['a', 'b', 'c', 'd'],
    speech: 'x'.repeat(100),
    catchphrase: 'y'.repeat(30),
    quirk: '',
    scenes: { touch: 'z'.repeat(100), feed: '   ' }
  });
  ok('traits 截到 3 个', dirty.traits.length === 3, dirty.traits.length);
  ok('speech 截到 40 字', dirty.speech.length === 40, dirty.speech.length);
  ok('catchphrase 截到 12 字', dirty.catchphrase.length === 12, dirty.catchphrase.length);
  ok('空的 quirk 不写入', dirty.quirk === undefined);
  ok('scenes 只留有内容的键', Object.keys(dirty.scenes).length === 1 && !!dirty.scenes.touch);
  ok('全空返回空对象', Object.keys(persona.sanitize({})).length === 0);
  ok('传 null 不抛错', Object.keys(persona.sanitize(null)).length === 0);

  // ---------- 四、语音降级 ----------
  console.log('\n[4] voice：插件未启用时的降级行为');

  ok('status 为 disabled', voice.status() === 'disabled', voice.status());
  ok('unavailableTip 给出启用路径', voice.unavailableTip().indexOf('同声传译') >= 0);
  const spoken = await voice.speak('测试');
  ok('speak 静默返回 false', spoken === false);
  ok('createRecognizer 返回 null', voice.createRecognizer({}) === null);
  ok('stop/destroy 不抛错', (() => {
    try { voice.stop(); voice.destroy(); return true; } catch (e) { return false; }
  })());

  ok('自动播报默认关闭', voice.isAutoTts() === false);
  voice.setAutoTts(true);
  ok('开关能持久化', voice.isAutoTts() === true);
  voice.setAutoTts(false);
  ok('能关回去', voice.isAutoTts() === false);

  // ---------- 五、双数据源一致性 ----------
  console.log('\n[5] localdb：persona 存取与导出');

  store.clear();
  const created = await localdb.createPet({
    name: '球球',
    personality: 'friendly',
    persona: { catchphrase: '抱抱嘛', scenes: { touch: '往怀里钻' } }
  });
  ok('创建时保存 persona', created.persona.catchphrase === '抱抱嘛');

  await localdb.updatePet({ persona: { catchphrase: '要抱抱', scenes: { play: '靠在你身上' } } });
  const after = await localdb.getPet();
  ok('更新能覆盖 persona', after.persona.catchphrase === '要抱抱');
  ok('更新后场景同步', after.persona.scenes.play === '靠在你身上');

  const exported = await localdb.exportAll();
  ok('导出包含 persona', !!exported.pet.persona);
  ok('导出内容可读', exported.pet.persona.catchphrase === '要抱抱');

  await localdb.updatePet({ persona: null });
  const cleared = await localdb.getPet();
  ok('传 null 能清空自定义', cleared.persona === null);

  // ---------- 汇总 ----------
  console.log('\n' + '─'.repeat(48));
  console.log(`  通过 ${pass} · 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
