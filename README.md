# 微信小程序练习场

用来放各种练手的小程序项目。一个仓库多个项目，每个子目录是一个独立的小程序，各自带 `app.json` 和 `project.config.json`。

## 都有什么

| 目录 | 项目 | 练的是什么 |
|---|---|---|
| [`01-order-demo`](./01-order-demo) | 点单（拾光咖啡） | 列表渲染、分类筛选、跨页面状态、本地缓存、tabBar 角标 |

## 怎么跑起来

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（稳定版即可）
2. 首页选「导入项目」
3. **目录选具体的子目录**，比如 `wechat-miniprogram-lab\01-order-demo`，不要选仓库根目录
4. AppID 那栏点「测试号」，确定
5. 模拟器里就能直接点

## 加一个新练习

```bash
mkdir 02-xxx
```

新目录里放一套最小骨架：`app.js` / `app.json` / `app.wxss` / `project.config.json` / `sitemap.json` + `pages/`。
编号连着往下排，`01`、`02`、`03`，排序天然就是时间顺序。
最后回到这个 README，在表格里补一行。

## 一些约定

- **每个小程序目录自带 `app.json`**，开发者工具是「一个目录 = 一个项目」，所以同仓库多项目不会冲突
- **`project.private.config.json` 不进版本控制**，它跟本机绑定，提交了会让协作方冲突
- **上传密钥（`*.key`）绝不提交**，那是能替你把代码传上微信服务器的凭据
- **AppID 可以提交**，它只是身份标识；真正的秘密是微信后台的 AppSecret，永远只放后端

## License

练习代码，随便看随便抄。
