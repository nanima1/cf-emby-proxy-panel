# CF Emby Proxy Panel

Cloudflare Worker 版 Emby 反代面板。支持在面板中用 `/路径` 管理多个 Emby 上游，拉取优选 IP，并自动把选中的 IP 写入 Cloudflare DNS，让项目域名走 Cloudflare CDN 加速。



## 功能

- 路径分流：用 `/hk`、`/jp`、`/home` 等路径添加不同 Emby。
- 多上游容灾：同一路径可配置多个上游，用逗号分隔，当前上游失败时自动尝试下一个。
- 前后端分离：`origin` 模式会重写 `Origin`、`Referer` 等头，适合分离部署场景。
- 优选 IP：面板可拉取远程优选 IP，也能解析自定义 IP 源。
- DNS 自动化：勾选 IP 后自动更新 `CF_DOMAIN` 的 A/AAAA/CNAME 记录。
- 播放兼容：自动改写 `PlaybackInfo`、m3u8、绝对媒体地址，并提供 `/proxy-stream/` 流代理。
- 缓存优化：可对图片、字幕、静态资源启用 Cloudflare 缓存。
- 统计记录：使用 D1 记录每日播放请求数和最后播放时间。
- 访问控制：支持阻止国家、阻止脚本客户端关键词、浏览器状态页或浏览器拦截。

## 快速部署

安装依赖：

```bash
npm install
```

创建 D1 数据库：

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

把命令输出里的 `database_id` 填入 `wrangler.toml`，取消 `[[d1_databases]]` 注释。

初始化数据表：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --file=./schema.sql
```

本地检查：

```bash
npm run check
npm run dry-run
```

部署：

```bash
npm run deploy
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 建议 | 面板登录密码。不设置时面板开放。 |
| `CF_API_TOKEN` | DNS 功能必填 | Cloudflare API Token，需要 Zone DNS 编辑权限。 |
| `CF_ZONE_ID` | DNS 功能必填 | Cloudflare Zone ID。 |
| `CF_DOMAIN` | DNS 功能必填 | 要写入 A/AAAA/CNAME 的项目域名。 |
| `DEFAULT_TARGET` | 可选 | 不使用 `/路径` 时的默认上游。 |
| `BLOCKED_COUNTRIES` | 可选 | 逗号分隔国家代码，例如 `JP,RU`。 |
| `BLOCKED_CLIENTS` | 可选 | 逗号分隔关键词，命中 URL 或请求头时返回 403。 |
| `BROWSER_MODE` | 可选 | `proxy`、`status`、`block`，默认 `proxy`。 |

推荐在 Cloudflare 控制台里设置敏感变量，尤其是 `ADMIN_TOKEN` 和 `CF_API_TOKEN`。

## 路径示例

新增路径：

```text
prefix: hk
target: https://emby.example.com:443
mode: clean
```

访问入口：

```text
https://你的worker域名/hk
```

多个上游：

```text
https://emby-a.example.com,https://emby-b.example.com
```

直接绝对反代：

```text
https://你的worker域名/https://emby.example.com/emby/system/ping
```

## 反代模式

- `clean`：默认模式，隐藏 Cloudflare 客户端 IP 相关请求头。
- `real-ip`：向上游传递 `X-Real-IP` 和 `X-Forwarded-For`。
- `origin`：为前后端分离优化，重写 `Origin` 与 `Referer`。
- `direct`：尽量保留原始请求头，只做必要清理。

## DNS 自动更新

面板里的 DNS 功能会：

1. 读取 `CF_DOMAIN` 当前的 A/AAAA/CNAME 记录。
2. 删除这些旧记录。
3. 根据选中的内容自动创建 A、AAAA 或 CNAME。

IPv4 会写入 A，IPv6 会写入 AAAA，域名会写入 CNAME。

## API 摘要

- `GET /api/routes`：读取路径配置。
- `POST /api/routes`：新增或更新路径。
- `DELETE /api/routes?prefix=hk`：删除路径。
- `GET /api/get-remote-ips?type=all`：拉取远程优选 IP。
- `GET /api/fetch-ips?url=...`：解析自定义 IP 源。
- `GET /api/dns-status`：查看目标域名 DNS 记录。
- `POST /api/update-dns`：写入选中的 IP。

## 注意

- 必须绑定 D1，面板路径管理才可用。
- DNS 自动化需要给 Token 最小化授权：对应 Zone 的 DNS Edit 即可。
- 如果上游 Emby 使用自签证书或阻止 Cloudflare 出口，Worker 侧会返回 502。
