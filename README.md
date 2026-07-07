# CF Emby Proxy Panel ✨

Cloudflare Worker 版 Emby 反代面板。

在网页里添加多个 `/路径`，自动保存到 D1，支持优选 IP 写入 Cloudflare DNS，也支持前后端分离 Emby。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Wrangler](https://img.shields.io/badge/Wrangler-4.x-222222?logo=npm&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)
[![Deploy](https://img.shields.io/badge/Deploy%20to-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel)

## 🖼️ 预览

![外观背景设置](./docs/assets/panel-preview.png)

![路由卡片拖拽排序](./docs/assets/routes-preview.png)

## ✅ 能做什么

- 多 Emby 路由：`/hk`、`/home`、`/movie` 分开管理。
- 小白生成器：填 Emby 原地址，自动生成客户端反代地址。
- 多上游故障切换：逗号或换行填多个上游。
- 卡片拖拽排序：排序自动保存到 D1。
- 图床/API 背景：背景 URL 和透明度保存到 D1。
- 优选 IP + DNS：勾选 IP 后预览并写入 Cloudflare DNS。
- 反代模式：`clean`、`real-ip`、`origin`、`direct`。
- 部署自检：检查 D1、DNS 变量、表结构和安全设置。

## 🚀 快速开始

新手建议看完整教程：

[小白 Cloudflare 部署教程](./docs/CF_DEPLOY_BEGINNER.md)

会用 Wrangler 的话直接走快速版：

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
npm install

npx wrangler login
npx wrangler d1 create cf-emby-proxy-panel
```

把 D1 输出的 `[[d1_databases]]` 填进 `wrangler.toml`，确认绑定名是：

```toml
binding = "DB"
```

然后执行：

```bash
npm run d1:init
npx wrangler secret put ADMIN_TOKEN
npm test
npm run dry-run
npm run deploy
```

更短的命令说明看：[快速部署](./docs/QUICK_DEPLOY.md)

## 🎯 面板怎么用

1. 打开部署后的 Worker 地址，输入 `ADMIN_TOKEN`。
2. 先看顶部 `部署自检`，确认 D1 是通过状态。
3. 在 `小白生成器` 填 Emby 原地址，例如 `https://emby.example.com:443`。
4. 填入口路径，例如 `hk`，面板会生成 `https://你的域名/hk`。
5. 点 `一键创建并复制`，然后把复制的地址填进 Emby 客户端。

多个 Emby 就添加多个路径：

```text
https://你的域名/hk
https://你的域名/home
https://你的域名/movie
```

路由卡片里的常用按钮：

| 按钮 | 用途 |
| --- | --- |
| `复制入口` | 复制 Emby 客户端服务器地址 |
| `复制配置` | 复制路径、模式、浏览器策略和全部上游 |
| `测速` | 检查当前上游延迟 |
| `编辑` | 修改路径、上游、模式和备注 |

## 🗄️ D1 保存内容

| 表 | 用途 |
| --- | --- |
| `routes` | 路由、上游、模式、排序和访问策略 |
| `request_stats` | 每日播放请求统计 |
| `settings` | 背景图 URL 和透明度 |

背景设置只保存 `http/https` URL，不保存图片文件，也不允许 `data:` base64。

## ⚙️ 环境变量

| 变量 | 说明 |
| --- | --- |
| `ADMIN_TOKEN` | 面板登录密码，强烈建议设置 |
| `CF_API_TOKEN` | DNS 自动写入需要 |
| `CF_ZONE_ID` | DNS 自动写入需要 |
| `CF_DOMAIN` | 要写入 DNS 的项目域名 |
| `DEFAULT_TARGET` | 可选，默认上游 |
| `BLOCKED_COUNTRIES` | 可选，逗号分隔国家代码 |
| `BLOCKED_CLIENTS` | 可选，逗号分隔客户端关键词 |
| `BROWSER_MODE` | 可选，`proxy`、`status`、`block` |

## 🧪 本地检查

```bash
npm run check
npm test
npm run dry-run
```

- `npm run check`：检查 Worker 语法。
- `npm test`：检查面板脚本、路由表单、防错校验和 Markdown 链接。
- `npm run dry-run`：检查 Cloudflare 打包。

## 🧯 常见错误

### D1 incomplete input

如果看到：

```text
D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS routes (: incomplete input: SQLITE_ERROR
```

说明 SQL 只复制了第一行，没有把整段 `schema.sql` 一起执行。

解决方法看：[D1 incomplete input 怎么办](./docs/CF_DEPLOY_BEGINNER.md#d1-incomplete-input-怎么办)

### 面板能打开但保存失败

优先检查：

- D1 binding 名必须是 `DB`。
- `schema.sql` 必须完整执行。
- 面板顶部 `部署自检` 里 `D1 binding` 和 `D1 tables` 应该通过。

### 导入配置失败

导入 JSON 会逐条校验。看到 `第 1 条路径无效` 这类提示时，优先检查：

- `prefix` 只能用字母、数字、下划线、短横线。
- `target` 必须是 `http://` 或 `https://` 开头的 Emby 上游。
- 多个上游用逗号或换行分隔。

## 🛡️ 安全建议

- 一定设置 `ADMIN_TOKEN`。
- `CF_API_TOKEN` 只给当前域名 DNS 权限。
- 不要提交 `.dev.vars`、Token、密码。
- 已公开发出的 GitHub Token 或 Cloudflare Token，请撤销并重新生成。
