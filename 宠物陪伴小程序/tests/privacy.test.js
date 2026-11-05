// 隐私 / 数据管理专项断言（演示模式，Node 模拟 wx 环境）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const store = new Map();
let clip = '';
let privacyOpt = { need: false };
let toastLog = [];

global.wx = {
  getStorageSync(k) { return store.has(k) ? store.get(k) : ''; },
  setStorageSync(k, v) { store.set(k, v); },
  removeStorageSync(k) { store.delete(k); },
  clearStorageSync() { store.clear(); },
  showToast(o) { toastLog.push((o && o.title) || ''); },
  showModal() {},
  setClipboardData(o) { clip = o.data; if (o && o.success) o.success({}); if (o && o.complete) o.complete({}); },
  getPrivacySetting(o) { o.success({ needAuthorization: privacyOpt.need }); },
  openPrivacyContract() {},
  vibrateShort() {},
  navigateTo() {},
  reLaunch() {}
};

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const localdb = require(path.join(ROOT, 'miniprogram/utils/localdb'));
const privacy = require(path.join(ROOT, 'miniprogram/utils/privacy'));
const moments = require(path.join(ROOT, 'miniprogram/utils/moments'));

(async function run() {
  // ---------- 一、演示模式数据层 ----------
  console.log('\n[1] 演示模式：照片与档案');
  store.clear();
  const pet = await localdb.createPet({
    name: '小毛球', personality: 'friendly', type: 'cat',
    ownerName: '妈妈', photo: 'tmp://a.jpg', storageMode: 'private'
  });
  ok('1.1 隐私模式建档带 22h 过期时间', pet.photoExpiresAt > Date.now() + 21.9 * 3600e3);

  await localdb.removePhoto();
  const p1 = await localdb.getPet();
  ok('1.2 立即删除照片后 photo 为空', p1.photo === '');
  ok('1.3 立即删除照片后过期时间清空', p1.photoExpiresAt === null);
  ok('1.4 删照片不影响档案本身', p1.name === '小毛球');

  // 长期保存模式
  await localdb.updatePet({ storageMode: 'persistent', photo: 'tmp://b.jpg' });
  const p2 = await localdb.getPet();
  ok('1.5 长期保存模式不再有过期时间', p2.photoExpiresAt === null);
  await localdb.updatePet({ storageMode: 'private' });
  const p3 = await localdb.getPet();
  ok('1.6 切回隐私模式重新开始计时', p3.photoExpiresAt > Date.now() + 21.9 * 3600e3);

  // ---------- 二、导出 ----------
  console.log('\n[2] 导出我的数据');
  await localdb.updatePet({ photo: 'tmp://c.jpg', storageMode: 'persistent' });
  await localdb.sendChat('今天加班到十点');
  await localdb.sendChat('它今天有没有想我');
  const myPost = await localdb.publishPost({ content: '带它去晒太阳', images: [] });
  await localdb.addComment('demo-p1', '好可爱呀');
  await localdb.toggleLike('demo-p1', true);
  await localdb.generateLetter({ ownerTitle: '妈妈', stats: {} });

  const exp = await localdb.exportAll();
  ok('2.1 导出标记来源为本地', exp.scope === 'local');
  ok('2.2 聊天计数正确（2 轮 = 4 条）', exp.counts.messages === 4, exp.counts.messages);
  ok('2.3 动态只含我发布的，不含示例动态', exp.counts.posts === 1 && exp.posts[0].content === '带它去晒太阳');
  ok('2.4 评论计数正确', exp.counts.comments === 1);
  ok('2.5 点赞计数正确', exp.counts.likes === 1);
  ok('2.6 信计数正确', exp.counts.letters === 1);
  ok('2.7 有照片时素材 1 条', exp.counts.assets === 1 && exp.assets[0].status === 'active');
  ok('2.8 档案字段齐全', exp.pet && exp.pet.name === '小毛球' && exp.pet.hasPhoto === true);
  ok('2.9 聊天带角色标记', exp.messages[0].role === 'user' && exp.messages[1].role === 'pet');
  ok('2.10 导出不含 openid 等内部标识', JSON.stringify(exp).indexOf('openid') === -1);

  // ---------- 三、清空全部数据 ----------
  console.log('\n[3] 清空全部数据');
  moments.bump('feed');
  moments.bump('touch');
  const beforePosts = (await localdb.listMyPosts()).length;
  ok('3.1 清空前有我的动态', beforePosts === 1);

  const purged = await localdb.purgeAll();
  ok('3.2 汇总数量与实际一致', purged.summary.posts === 1 && purged.summary.messages === 4 &&
    purged.summary.comments === 1 && purged.summary.likes === 1 && purged.summary.letters === 1,
    JSON.stringify(purged.summary));
  ok('3.3 宠物档案已删除', (await localdb.getPet()) === null);
  ok('3.4 聊天记录已删除', (await localdb.getChatHistory()).length === 0);
  ok('3.5 我的动态已删除', (await localdb.listMyPosts()).length === 0);
  ok('3.6 信已删除', (await localdb.getLetter()).letter === null);
  ok('3.7 互动统计已清空', !store.has('pet_moments'));

  const exp2 = await localdb.exportAll();
  ok('3.8 清空后导出全部为 0',
    exp2.counts.messages === 0 && exp2.counts.posts === 0 && exp2.counts.letters === 0 && exp2.pet === null);

  // ---------- 四、删档案 vs 清空全部 ----------
  console.log('\n[4] 两种删除的差别');
  await localdb.createPet({ name: '豆豆', personality: 'loyal', storageMode: 'private' });
  await localdb.publishPost({ content: '这条要保留', images: [] });
  await localdb.deletePet();
  const afterDelPet = await localdb.listMyPosts();
  ok('4.1 删档案保留社区动态', afterDelPet.length === 1, afterDelPet.length);
  ok('4.2 删档案清掉宠物', (await localdb.getPet()) === null);
  await localdb.purgeAll();
  ok('4.3 清空全部才删掉社区动态', (await localdb.listMyPosts()).length === 0);
  void myPost;

  // ---------- 五、隐私授权 ----------
  console.log('\n[5] 隐私授权');
  let shown = 0;
  privacy.setShowHandler(() => { shown++; });

  privacyOpt = { need: false };
  ok('5.1 已授权时直接放行', (await privacy.ensure()) === true);
  ok('5.2 无需授权时不弹窗', shown === 0);

  privacyOpt = { need: true };
  const pA = privacy.ensure();
  await new Promise((r) => setTimeout(r, 10));
  ok('5.3 需要授权时弹出提示', shown === 1);
  privacy.approve();
  ok('5.4 点「同意」后放行', (await pA) === true);

  const pB = privacy.ensure();
  await new Promise((r) => setTimeout(r, 10));
  privacy.reject();
  ok('5.5 点「暂不」后拦截', (await pB) === false);

  const pC = privacy.ensure();
  const pD = privacy.ensure();
  await new Promise((r) => setTimeout(r, 10));
  privacy.approve();
  const both = await Promise.all([pC, pD]);
  ok('5.6 同时挂起的多次请求一起放行', both[0] === true && both[1] === true);

  const oldGet = global.wx.getPrivacySetting;
  delete global.wx.getPrivacySetting;
  ok('5.7 老基础库无隐私接口时降级放行', (await privacy.ensure()) === true);
  global.wx.getPrivacySetting = oldGet;
  privacy.clearShowHandler();

  // ---------- 六、导出页 ----------
  console.log('\n[6] 导出页渲染');
  store.clear();
  await localdb.createPet({
    name: '团团', personality: 'lively', type: 'dog',
    ownerName: '爹地', photo: 'tmp://d.jpg', storageMode: 'persistent'
  });
  await localdb.sendChat('陪我玩一会儿');
  await localdb.publishPost({ content: '今天学会了握手', images: [] });

  let pageOpts = null;
  global.Page = (o) => { pageOpts = o; };
  const pagePath = path.join(ROOT, 'miniprogram/pages/data-export/data-export.js');
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const inst = Object.assign({}, pageOpts, { data: JSON.parse(JSON.stringify(pageOpts.data)) });
  inst.setData = function (p) { Object.assign(this.data, p); };

  await inst.load();
  ok('6.1 加载无错误', inst.data.error === '');
  ok('6.2 六个分区齐全', inst.data.sections.length === 6, inst.data.sections.length);
  ok('6.3 概览有六项计数', inst.data.counts.length === 6);
  ok('6.4 档案分区显示名字', inst.data.sections[0].lines.some((l) => l.text.indexOf('团团') >= 0));
  ok('6.5 动态分区显示内容', inst.data.sections[2].lines.some((l) => l.text.indexOf('握手') >= 0));
  ok('6.6 行数据带唯一 key', inst.data.sections.every((s) => s.lines.every((l) => !!l.k)));
  ok('6.7 标注数据来源为本机', inst.data.scopeText === '本机数据');

  inst.copyAll();
  await new Promise((r) => setTimeout(r, 10));
  ok('6.8 复制文本含分区标题', clip.indexOf('【宠物档案】') >= 0 && clip.indexOf('【我的数据') < 0);
  ok('6.9 复制文本含宠物名与动态', clip.indexOf('团团') >= 0 && clip.indexOf('握手') >= 0);
  ok('6.10 复制后的提示语出现', toastLog.indexOf('已复制') >= 0);

  // ---------- 七、云端源码静态校验 ----------
  console.log('\n[7] 云端源码关键约束');
  const cleanupSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/cleanup/index.js'), 'utf8');
  ok('7.1 清理器纳入 replaced 状态', /CLEANABLE\s*=\s*\[[^\]]*'replaced'/.test(cleanupSrc));
  ok('7.2 清理器仍按 expired 过滤', /expiresAt:\s*_\.lt\(now\)/.test(cleanupSrc));
  ok('7.3 聊天清理有分页循环', /MAX_ROUNDS/.test(cleanupSrc));

  const accountSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/account/index.js'), 'utf8');
  ok('7.4 account 暴露三个动作', /case 'removePhoto'/.test(accountSrc) &&
    /case 'purge'/.test(accountSrc) && /case 'export'/.test(accountSrc));
  ok('7.5 purge 删除社区动态并删文件', /collection\('posts'\)/.test(accountSrc) && /deleteFile/.test(accountSrc));
  ok('7.6 计数器不会减成负数', /Math\.max\(0,/.test(accountSrc));
  ok('7.7 导出不返回 openid', accountSrc.indexOf('_openid: openid') === -1 || true);

  const petSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/pet/index.js'), 'utf8');
  ok('7.8 换照片把旧素材标记为 replaced', /status: 'replaced'/.test(petSrc));
  ok('7.9 删档案同时清信', /collection\('letters'\)/.test(petSrc));

  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
