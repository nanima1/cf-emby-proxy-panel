# 快速部署 ⚡

适合已经有 Cloudflare 账号、域名和 Emby 上游的人。

第一次用 Workers / D1 的话，建议看：[小白 Cloudflare 部署教程](./CF_DEPLOY_BEGINNER.md)

## 1. 下载并安装

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
npm install
```

## 2. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器授权成功后继续。

## 3. 创建 D1

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

把终端输出的这一段填进 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "你的-database-id"
```

重点只看一个：`binding` 必须是 `"DB"`。

## 4. 初始化表

```bash
npm run d1:init
```

这一步会创建：

- `routes`
- `request_stats`
- `settings`

看到 `incomplete input` 时，说明 SQL 没完整执行，去看完整教程里的 D1 排错章节。

## 5. 设置面板密码

```bash
npx wrangler secret put ADMIN_TOKEN
```

输入你自己的面板密码。

## 6. 可选：DNS 自动写入

只有要在面板里把优选 IP 写入 Cloudflare DNS，才需要设置：

```bash
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ZONE_ID
npx wrangler secret put CF_DOMAIN
```

`CF_DOMAIN` 示例：

```text
emby.example.com
```

## 7. 测试并部署

```bash
npm run check
npm test
npm run dry-run
npm run deploy
```

部署成功后打开 Wrangler 输出的 Worker 地址。

## 8. 第一次进面板

1. 输入 `ADMIN_TOKEN` 登录。
2. 看 `部署自检`，确认 D1 通过。
3. 在 `小白生成器` 填 Emby 原地址，例如 `https://emby.example.com:443`。
4. 填入口路径，例如 `hk`。
5. 点 `一键创建并复制`。
6. Emby 客户端服务器地址填复制出来的 `https://你的域名/hk`。

## Cloudflare 导入入口

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel)

导入入口通常仍需要手动确认 D1、Secret 和变量。最稳的方式还是命令行部署。
