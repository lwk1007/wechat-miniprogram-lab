// 心情文本（情绪 → 一句自然语言）
//
// 这里原本是「对话大脑」规则引擎（意图识别 + 回复池 + 语境记忆），
// 金种子杯备赛中砍掉了 AI 聊天功能，只保留「心情 → 一句话」这一层：
// pet-life.js（自主生命引擎）需要它把当前心情翻译成自然语言，用于页面摘要。
//
// 本文件必须零外部依赖。

const MOOD_TEXT = {
  happy: '心情很好', playful: '想闹一闹', calm: '很松弛',
  sleepy: '有点困', curious: '很好奇', shy: '有点害羞',
  sulk: '有点小委屈', grumpy: '在闹小脾气'
};

function moodTextOf(key) {
  return MOOD_TEXT[key] || '';
}

module.exports = { moodTextOf, MOOD_TEXT };
