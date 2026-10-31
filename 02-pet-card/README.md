# 02 宠物卡片组件

练：**自定义组件**（`properties` 传参 + `triggerEvent` 抛事件）和「数据驱动界面」。

## 跑起来

导入本目录，AppID 选测试号。

## 10 分钟讲解

| 文件 | 看什么 |
|---|---|
| `components/pet-card/index.js` | `properties` 是外部传入的只读数据；`observers` 在 name 变化时算出头像首字；`triggerEvent('cardtap', {...})` 把事件抛给父页面 |
| `pages/index/index.wxml` | `bind:cardtap="onCardTap"` 接收事件；`wx:for` 渲染列表 |
| `pages/index/index.js` | `addPet()` 只改 `data`，界面自动变 —— 小程序没有 DOM |

## 三个自测

1. 把 `pet-card` 的 `days` 改成 `{{item.days * 2}}`，看卡片变不变。
2. 删掉 `bind:cardtap`，点卡片应该没反应 —— 说明事件是「显式抛出」的。
3. 在 `properties` 里加一个 `species`，在 WXML 里显示出来。

## 记住这句

组件内部只能用 `properties` 里的值，**改父页面的数据要靠 `triggerEvent`**，不能直接 `getCurrentPages()` 去改。
