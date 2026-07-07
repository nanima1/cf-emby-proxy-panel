# 快速部署

这篇适合已经有 Cloudflare 账号、域名和 Emby 上游的人。第一次接触 Cloudflare Workers 的话，优先看完整教程：

[小白 Cloudflare 部署教程](./CF_DEPLOY_BEGINNER.md)

## 最短路线

### 1. 下载项目

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建 D1

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

把输出里的 `database_id` 填进 `wrangler.toml`，并确认 D1 binding 是：

```toml
binding = "DB"
```

### 4. 初始化 D1 表

```bash
npm run d1:init
```

这个脚本等同于：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

### 5. 设置面板密码

```bash
npx wrangler secret put ADMIN_TOKEN
```

输入你自己的面板密码。

### 6. 可选：设置 DNS 自动写入

如果你要在面板里把优选 IP 写入 Cloudflare DNS，再设置下面三个：

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
npx wrangler secret put CF_DOMAIN
```

`CF_DOMAIN` 填要写入 A/AAAA/CNAME 的项目域名，例如：

```text
emby.example.com
```

### 7. 检查并部署

```bash
npm run check
npm run dry-run
npm run deploy
```

部署成功后打开 Wrangler 输出的 Worker 地址。

## 进面板后

1. 登录面板。
2. 先看顶部 `部署自检`。
3. 如果 `D1 binding` 和 `D1 tables` 都是 `pass`，继续看 `首次使用向导`。
4. 在向导里添加第一条路由，例如 `hk` + `https://emby.example.com:443`。
5. Emby 客户端服务器地址填 `https://你的域名/hk`。

## Cloudflare 导入入口

你也可以尝试 Cloudflare 的仓库导入入口：

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel)

注意：导入入口通常仍然需要你手动确认 D1、Secret 和变量。最稳的方式还是命令行部署。
