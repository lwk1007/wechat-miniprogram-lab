# 06 宠物社群 Feed

练：**动态流** —— 发帖、九宫格、点赞、分页加载、下拉刷新。

## 跑起来

### 现在就能跑（演示模式，零配置）

直接导入本目录，`config.js` 里 `envId` 留空即可。动态存本地缓存（最多 30 条，每帖最多存 3 张图），
发帖、点赞、取消赞、分页、下拉刷新全部可用。

### 切成云开发（真正做项目时）

1. 真实 AppID 打开，云开发开通后把环境 ID 填到 `config.js`
2. 建两个集合：`posts`（所有用户可读写）、`likes`（仅创建者可读写）
3. 编译，点右下角 ＋ 发一条

> 生产环境应把 `posts` 收成「所有人可读、仅创建者可写」，点赞改走云函数校验。
> 练习里放开写权限是为了让你不用部署云函数就能看到效果。

## 10 分钟讲解

| 位置 | 看什么 |
|---|---|
| `pages/feed/index.js` 的 `loadPage` | `skip(page * 10).limit(10)` 是唯一的分页方式；`noMore` 判断结束 |
| `onReachBottom` | 触底加载。注意别用 `scroll-view` 套整页，会和页面滚动冲突 |
| `toggleLike` | 点赞记录存独立集合 `likes`，权限「仅创建者可读」→ 查到的天然只有我自己，不用自己传 openid |
| `db.command.inc(1)` | 原子自增。**不要先 get 再 update**，并发会丢赞 |
| `patchPost` | 只改一条的点赞数，不整列表 `setData` |
| `index.wxml` 的三种布局 | 1 张大图 / 2~4 张两列 / 5~9 张三列，用 `wx:if` 分，别硬套 grid |

## 数据结构

```js
// posts
{ _openid, nickname, content, images: ['cloud://...'], likeCount, createdAt }

// likes
{ _openid, postId, createdAt }
```

## 自测

- 连发 12 条，滑动到底，看是否分页加载（控制台看请求次数）。
- 用另一个微信账号点赞同一条，两端数字都应该变。
- 把 `pageSize` 改成 3，更容易看出分页边界。
