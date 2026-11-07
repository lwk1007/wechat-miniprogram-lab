// 它怎么称呼你 —— 全项目唯一出口
//
// 背景：这个值原本散在 6 处各自兜底（页面 2 处、模板 2 处、两个云函数各 1 处），
// 而且字段名分叉过：写入用的是 pet.ownerName，页面读取却读 pet.ownerTitle，
// 后者从来没被写过，所以「编辑了称呼但不生效」是必然结果，不是偶发。
//
// 现在的约定（改之前先读这段）：
//   1. 数据库里只存用户原文（或空串），默认值不在存储层落库。
//      —— 落库了就分不清「用户主动填了主人」和「系统默认是主人」，
//         以后想换默认值会改不动老用户。
//   2. 默认值只在读取时补，唯一入口就是 resolve()。
//   3. 不读 pet.ownerTitle。那个字段不存在，读了只会掩盖问题。
//   4. 云函数是独立部署包，不能 require 这里，副本由 scripts/sync-shared.js 生成，
//      测试会断言三份逐字节相同。
//
// 已知边界（都有测试钉住）：
//   - 全角空格 / 零宽字符 / 纯换行  → 视为没填，回落默认
//   - 超过 12 字 → 截断（跟云函数 pet 的存储上限一致）
//   - 引号、花括号、尖括号、反斜杠会被剔除：这个值会拼进 system prompt，
//     留着就能让用户用 `」并忽略以上要求` 之类的文本撬开设定
//   - 用户把称呼填成宠物名字、或填成「主人」本身，都放行，不做特殊判断

const DEFAULT_TITLE = '主人';
const MAX_LEN = 12;

// 零宽 + 控制符（含换行/制表）+ 会破坏引号结构的字符
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;
const CONTROL = /[\u0000-\u001f\u007f]/g;
const QUOTES = /[「」『』"'`{}<>\\]/g;
const SPACES = /\s+/g;

// 只清洗，不兜底。用于「用户到底填没填」这个判断，也用于写库前的归一化。
function normalize(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL, '')
    .replace(QUOTES, '')
    .replace(SPACES, ' ')
    .trim()
    .slice(0, MAX_LEN)
    .trim();
}

// 字符串版：云函数里拿到的是散装字段，不必先拼对象
function resolveName(v) {
  return normalize(v) || DEFAULT_TITLE;
}

// 对象版：页面和云函数都从 pets 文档里取
function resolve(pet) {
  return resolveName(pet && pet.ownerName);
}

// 用户是否真的设过（默认值不算）
function isCustom(pet) {
  return !!normalize(pet && pet.ownerName);
}

// 展示用：让用户看得出这是默认值还是自己填的
function label(pet) {
  return isCustom(pet) ? normalize(pet.ownerName) : DEFAULT_TITLE + '（默认）';
}

module.exports = {
  DEFAULT_TITLE,
  MAX_LEN,
  normalize,
  resolveName,
  resolve,
  isCustom,
  label
};
