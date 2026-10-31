# 04 宠物动效

练：**只用 CSS `@keyframes` 做循环动效**，不引入动画库、不碰 Canvas。

## 跑起来

导入本目录，测试号即可。选一张图，切三个动效试试。

## 10 分钟讲解

| 位置 | 看什么 |
|---|---|
| `index.wxss` 的 `.breath` | `scale` 呼吸，3.2s 慢速循环 —— 快了就像抽搐 |
| `.jump` | `cubic-bezier(0.3, 0.8, 0.4, 1)` 让落地有「顿」感，匀速会像电梯 |
| `.shadow-small` | 跳起来时影子缩小 —— 这一个细节决定「假不假」 |
| `transform-origin: 50% 90%` | 以脚为支点旋转缩放，比默认中心点自然 |
| `index.js` 的 `setAnim` | 先置空再设值，才能让同一动画重播（class 没变化不重播） |

## 为什么不用 JS 做动画

`setData` 每帧改 `translateY`，等于每帧跨线程通信一次，中低端机必掉帧。
CSS `transform` 跑在合成层，不触发重排重绘 —— 这就是「性能」最实用的一条。

## 自测

1. 把 `.breath` 的 `3.2s` 改成 `0.6s`，感受一下差别（这就是手感）。
2. 把 `transform` 换成 `height` / `top`，在真机上看帧率变化。
3. 给 `.sway` 加 `animation-delay`，做两只宠物不同步的效果。
