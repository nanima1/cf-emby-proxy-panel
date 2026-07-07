# CF Emby Proxy Panel ✨

一个跑在 Cloudflare Worker 上的 Emby 反代面板。你可以在网页面板里添加多个 `/路径` 入口、拖动排序、配置前后端分离反代、拉取优选 IP，并把选中的 IP 自动写入 Cloudflare DNS，实现更省心的 CDN 加速入口。

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Wrangler](https://img.shields.io/badge/Wrangler-4.x-222222?logo=npm&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)
[![Deploy](https://img.shields.io/badge/Deploy%20to-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel)

## 🖼️ 面板预览

![外观背景设置](./docs/assets/panel-preview.png)

![路由卡片拖拽排序](./docs/assets/routes-preview.png)

## 🚀 快速入口

| 你想做什么 | 看这里 |
| --- | --- |
| 第一次部署，想一步步照着做 | [小白 Cloudflare 部署教程](./docs/CF_DEPLOY_BEGINNER.md) |
| 已经会 Wrangler，想快速跑起来 | [快速部署](./docs/QUICK_DEPLOY.md) |
| 直接从 Cloudflare 页面导入 | [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel) |

## ✨ 功能亮点

| 模块 | 能力 |
| --- | --- |
| 路由管理 | 用 `/hk`、`/home`、`/movie` 这类路径管理多个 Emby，支持逗号/换行多上游、拖拽排序、JSON 导入导出 |
| 小白生成器 | 输入 Emby 原地址和入口路径，自动生成客户端地址，也可以一键创建路由并复制 |
| 外观背景 | 支持图床直链或随机图 API，可先预览不保存，确认后把 URL 和透明度保存到 D1 `settings` 表 |
| 反代模式 | 支持 `clean`、`real-ip`、`origin`、`direct`，适配普通反代和前后端分离 Emby |
| 播放处理 | 自动处理 `PlaybackInfo`、m3u8、绝对媒体地址，并提供 `/proxy-stream/` 流代理 |
| 优选 IP | 拉取远程优选 IP 或解析自定义 IP 源，勾选后可批量写入 DNS |
| DNS 自动化 | 预览将删除和创建的记录，确认后自动更新 `CF_DOMAIN` 的 A/AAAA/CNAME |
| 访问控制 | 支持国家拦截、客户端关键词拦截、浏览器状态页、浏览器拦截 |
| 部署自检 | `/api/doctor` 会检查 D1、DNS 变量、表结构、默认上游和面板安全设置 |

## 🧭 小白使用流程

1. 打开部署好的 Worker 面板，输入 `ADMIN_TOKEN` 登录。
2. 在右侧 `小白生成器` 填入你的 Emby 原地址，例如 `https://emby.example.com:443`。
3. 填入口路径，例如 `hk`。不要写成 `/hk`，面板会自动处理斜杠。
4. 想先检查配置就点 `生成并填入`，面板会自动把内容放进路由表单。
5. 想最快完成就点 `一键创建并复制`，面板会保存路由并复制反代后地址。
6. Emby 客户端的服务器地址填写生成后的地址，例如 `https://你的域名/hk`。

多个 Emby 就添加多个路径：

```text
https://你的域名/hk
https://你的域名/home
https://你的域名/movie
```

路由卡片左上角有拖动手柄，按住后可以直接拖动排序，排序会保存到 D1。

如果新建的路径已经存在，面板会先询问是否覆盖，避免误操作把旧配置冲掉。

同一个路径需要多个上游时，可以用逗号或换行分隔：

```text
https://emby-a.example.com
https://emby-b.example.com
```

## 🗄️ D1 会保存什么

本项目使用 Cloudflare D1 保存面板数据：

| 表名 | 用途 |
| --- | --- |
| `routes` | 保存每个 `/路径`、上游 Emby、反代模式、备注、排序和访问策略 |
| `request_stats` | 保存每日播放请求统计 |
| `settings` | 保存面板外观设置，例如背景图 URL 和透明度 |

为了更安全，外观背景只保存 `http/https` 图片地址或随机图 API 地址，不保存图片文件本体，也不允许保存 `data:` base64 内容。

## ⚙️ 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 建议 | 面板登录密码。不设置时面板是开放的 |
| `CF_API_TOKEN` | DNS 功能需要 | Cloudflare API Token，需要 DNS 编辑权限 |
| `CF_ZONE_ID` | DNS 功能需要 | Cloudflare Zone ID |
| `CF_DOMAIN` | DNS 功能需要 | 要自动写入 DNS 的项目域名，例如 `emby.example.com` |
| `DEFAULT_TARGET` | 可选 | 不使用 `/路径` 时的默认上游 |
| `BLOCKED_COUNTRIES` | 可选 | 逗号分隔国家代码，例如 `JP,RU` |
| `BLOCKED_CLIENTS` | 可选 | 逗号分隔关键词，命中 URL 或请求头时返回 403 |
| `BROWSER_MODE` | 可选 | `proxy`、`status`、`block`，默认 `proxy` |

## 🧩 D1 初始化 SQL

命令行部署时执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

如果你在 Cloudflare 网页 D1 SQL 控制台里手动执行，请完整复制 `schema.sql`，不要只复制第一行。需要创建三张表：`routes`、`request_stats`、`settings`。

看到这个错误：

```text
D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS routes (: incomplete input: SQLITE_ERROR
```

意思是 SQL 只执行到了 `CREATE TABLE IF NOT EXISTS routes (` 这一半，后面的字段、右括号和分号没有被一起提交。解决方法看：[D1 incomplete input 怎么办](./docs/CF_DEPLOY_BEGINNER.md#d1-incomplete-input-怎么办)。

## 🛡️ 安全建议

- 一定要设置 `ADMIN_TOKEN`，不要让面板裸奔。
- `CF_API_TOKEN` 只给当前域名的 DNS 编辑权限，不要给全账号权限。
- 背景图建议填图床直链或随机图 API，不要把私人图片接口暴露给别人。
- 不要把 `.dev.vars`、Token、密码提交到 GitHub。
- 已经发出去或用过的 GitHub Token、Cloudflare Token，记得及时撤销并重新生成。

## 🔌 API 摘要

| API | 说明 |
| --- | --- |
| `GET /api/doctor` | 部署自检 |
| `GET /api/routes` | 读取路由 |
| `POST /api/routes` | 新增或更新路由 |
| `DELETE /api/routes?prefix=hk` | 删除路由 |
| `POST /api/routes/import` | 批量导入路由 |
| `POST /api/routes/reorder` | 保存路由排序 |
| `GET /api/stats` | 读取播放统计 |
| `GET /api/settings/appearance` | 读取外观背景设置 |
| `POST /api/settings/appearance` | 保存图床/API 背景和透明度 |
| `GET /api/get-remote-ips?type=all` | 拉取远程优选 IP |
| `GET /api/fetch-ips?url=...` | 解析自定义 IP 源 |
| `GET /api/dns-status` | 查看目标域名 DNS 记录 |
| `POST /api/dns-preview` | 预览 DNS 写入计划 |
| `POST /api/update-dns` | 写入选中的 IP |

## 🧪 本地检查

```bash
npm install
npm run check
npm run dry-run
```

`npm run check` 用来检查 Worker 语法。`npm run dry-run` 用来检查 Cloudflare 打包是否能通过。

## 📚 更详细的部署教程

第一次用 Cloudflare Workers、D1、Wrangler 的话，建议直接看这篇：

[小白 Cloudflare 部署教程](./docs/CF_DEPLOY_BEGINNER.md)
