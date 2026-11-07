const api = require('../../utils/api');
const privacy = require('../../utils/privacy');
const titleOf = require('../../utils/title');

const MODE_TEXT = { private: '隐私模式（照片最迟 24 小时删除）', persistent: '长期保存模式' };
const PERSONALITY_TEXT = { loyal: '忠心', lively: '活泼', foodie: '贪吃', friendly: '亲人' };
const TYPE_TEXT = { cat: '猫', dog: '狗', other: '其他' };

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    loading: true,
    error: '',
    isDemo: false,
    scopeText: '',
    exportedAtText: '',
    counts: [],
    sections: [],
    copying: false,
    raw: null
  },

  onLoad() {
    privacy.setShowHandler(() => {});
    this.load();
  },

  onUnload() {
    privacy.clearShowHandler();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const d = await api.exportMyData();
      const pet = d.pet;
      const sections = [];

      sections.push({
        key: 'pet',
        title: '宠物档案',
        hint: pet ? '' : '还没有宠物档案',
        lines: pet ? [
          '名字：' + pet.name,
          '类型：' + (TYPE_TEXT[pet.type] || '其他'),
          '性格：' + (PERSONALITY_TEXT[pet.personality] || '—'),
          '它怎么称呼你：' + titleOf.label(pet),
          '保存模式：' + (MODE_TEXT[pet.storageMode] || '—'),
          '在一起的第几天起算：' + (pet.sinceDate || '未填写'),
          '档案创建时间：' + fmtTime(pet.createdAt),
          '是否存有照片：' + (pet.hasPhoto ? '是' : '否')
        ] : []
      });

      const letters = d.letters || [];
      sections.push({
        key: 'letters',
        title: '它写给我的信',
        hint: letters.length ? '共 ' + letters.length + ' 封' : '还没有生成过信',
        lines: letters.map((l) => fmtTime(l.createdAt) + '\n' + l.content)
      });

      const assets = d.assets || [];
      sections.push({
        key: 'assets',
        title: '照片素材记录',
        hint: assets.length ? '共 ' + assets.length + ' 条' : '没有照片素材',
        lines: assets.map((a) => '状态 ' + a.status +
          ' · 创建于 ' + fmtTime(a.createdAt) +
          ' · ' + (a.expiresAt ? '自动删除时间 ' + fmtTime(a.expiresAt) : '长期保存'))
      });

      const c = d.counts || {};
      // 渲染层统一成 {k, text}：内容里常有重复行（比如同一句回复），
      // 直接用字符串做 wx:key 会撞 key
      sections.forEach((s) => {
        s.lines = s.lines.map((t, i) => ({ k: s.key + '-' + i, text: t }));
      });
      this.setData({
        loading: false,
        isDemo: d.scope === 'local',
        scopeText: d.scope === 'local' ? '本机数据' : '云端数据',
        exportedAtText: fmtTime(d.exportedAt),
        counts: [
          { label: '信', value: c.letters || 0 },
          { label: '照片', value: c.assets || 0 }
        ],
        sections,
        raw: d
      });
    } catch (e) {
      this.setData({ loading: false, error: (e && e.message) || '读取失败' });
    }
  },

  // 复制成可读文本：用户拿去存档或发给别人都能看懂
  copyAll() {
    if (this.data.copying) return;
    this.setData({ copying: true });
    const d = this.data.raw || {};
    const lines = [];
    lines.push('宠物陪伴 · 我的数据');
    lines.push('导出时间：' + this.data.exportedAtText);
    lines.push('数据来源：' + this.data.scopeText);
    lines.push('');
    this.data.sections.forEach((s) => {
      lines.push('【' + s.title + '】' + (s.hint ? ' ' + s.hint : ''));
      if (!s.lines.length) {
        lines.push('（空）');
      } else {
        s.lines.forEach((l) => lines.push(l.text));
      }
      lines.push('');
    });
    lines.push('—— 以上数据由小程序按你的账号汇总，导出后请自行妥善保存。');

    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
      complete: () => this.setData({ copying: false })
    });
    void d;
  }
});
