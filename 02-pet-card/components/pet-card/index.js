// 自定义组件的核心就三件事：
// 1) properties：接收父页面传下来的数据（单向，子组件不改它）
// 2) data：组件自己的状态（可以改）
// 3) triggerEvent：把事件抛给父页面（子组件不能直接调父页面的方法）
Component({
  properties: {
    name: { type: String, value: '未命名' },
    mood: { type: String, value: '发呆' },
    days: { type: Number, value: 0 },
    color: { type: String, value: '#e8855b' }
  },

  data: {
    // 头像里显示名字第一个字，省掉图片资源
    initial: ''
  },

  // 数据监听：properties 变化时同步算派生数据
  observers: {
    name(val) {
      this.setData({ initial: val ? val.slice(0, 1) : '?' })
    }
  },

  lifetimes: {
    attached() {
      this.setData({ initial: this.data.name.slice(0, 1) })
    }
  },

  methods: {
    onTap() {
      // 关键：把 detail 抛出去，父页面通过 bind:cardtap 接收
      this.triggerEvent('cardtap', {
        name: this.data.name,
        days: this.data.days
      })
    }
  }
})
