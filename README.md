# CF Emby Proxy Panel

Cloudflare Worker 版 Emby 反代面板。你可以在网页面板里用 `/路径` 管理多个 Emby 上游，拉取优选 IP，并把选中的 IP 自动写入 Cloudflare DNS，让项目域名走 Cloudflare CDN 加速。

> 想快速部署，先看：
>
> [快速部署](./docs/QUICK_DEPLOY.md)
>
> 第一次部署、看不懂 D1 / Wrangler / 变量的，看这篇超详细教程：
>
> [小白 Cloudflare 部署教程](./docs/CF_DEPLOY_BEGINNER.md)
>
> Cloudflare 仓库导入入口：
>
> [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/nanima1/cf-emby-proxy-panel)

这个项目整理自 `double.js`、`Pro-Worker.js` 的最终版逻辑，并合并了 `hbh-proxy worker.js` 与 `反代 + HTML.txt` 里的访问控制、状态页、客户端识别、流代理和缓存思路。

## 功能概览

- 路径分流：用 `/hk`、`/jp`、`/home` 等路径添加不同 Emby。
- 路由排序：面板支持上移/下移路径顺序，排序会保存到 D1。
- 多上游容灾：同一路径可配置多个上游，用英文逗号分隔，一个失败会自动尝试下一个。
- 上游健康测试：面板支持一键测试全部路径的所有上游，显示可用数量和最快延迟。
- 前后端分离：`origin` 模式会重写 `Origin`、`Referer`，适合前后端分离 Emby。
- 优选 IP：面板可拉取远程优选 IP，也能解析自定义 IP 源。
- DNS 自动化：勾选 IP 后自动更新 `CF_DOMAIN` 的 A/AAAA/CNAME 记录。
- 播放兼容：自动改写 `PlaybackInfo`、m3u8、绝对媒体地址，并提供 `/proxy-stream/` 流代理。
- 缓存优化：可对图片、字幕、静态资源启用 Cloudflare 缓存。
- 统计记录：使用 D1 记录每日播放请求数和最后播放时间。
- 统计概览：面板显示累计播放、活跃路径、路由数量和热门路径排行。
- 访问控制：支持阻止国家、阻止脚本客户端关键词、浏览器状态页或浏览器拦截。
- 部署自检：面板内置 `/api/doctor`，可以检查 D1、DNS 变量、Cloudflare DNS API 和默认上游，并一键复制诊断报告。
- 版本提示：面板可检查 GitHub main 分支最新提交，方便判断是否需要更新。
- 首次向导：新部署没有路径时，面板会引导添加第一条 Emby 路由。
- 配置备份：面板支持导出/导入路由 JSON，同名路径导入时会覆盖更新。

## 你需要准备

- 一个 Cloudflare 账号。
- 一个已经托管在 Cloudflare 的域名，例如 `example.com`。
- 一台可以运行命令的电脑，Windows、macOS、Linux 都可以。
- Node.js 20 或更高版本。
- 你的 Emby 上游地址，例如 `https://emby.example.com:443`。

如果你只是先测试面板，不需要马上准备 Cloudflare API Token；如果你要用“优选 IP 写入 DNS”功能，就需要准备 DNS Token。

## 方式一：命令行部署，推荐

这种方式最稳定，后续更新也最方便。下面以 Windows PowerShell 为例，macOS/Linux 把命令照抄到终端即可。

### 1. 安装 Node.js

打开终端输入：

```bash
node -v
npm -v
```

如果能看到版本号，例如 `v22.x.x`，说明已经安装。没有安装就去下载 LTS 版：

[https://nodejs.org](https://nodejs.org)

### 2. 下载项目

如果你会用 Git：

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
```

如果不会用 Git：

1. 打开项目页：[https://github.com/nanima1/cf-emby-proxy-panel](https://github.com/nanima1/cf-emby-proxy-panel)
2. 点绿色 `Code`
3. 点 `Download ZIP`
4. 解压后进入项目文件夹
5. 在这个文件夹里打开终端

### 3. 安装依赖

```bash
npm install
```

成功后会出现 `node_modules` 文件夹。

### 4. 登录 Cloudflare

```bash
npx wrangler login
```

浏览器会弹出 Cloudflare 登录授权页面。登录并允许 Wrangler 访问即可。

如果浏览器没有自动打开，终端里会显示一个链接，复制到浏览器打开。

### 5. 创建 D1 数据库

面板的路径配置、播放统计都存在 Cloudflare D1 里，所以必须创建 D1。

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

成功后会输出类似内容：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把这段复制下来，下一步要用。

### 6. 填写 `wrangler.toml`

打开项目里的 `wrangler.toml`，找到这段：

```toml
# [[d1_databases]]
# binding = "DB"
# database_name = "cf-emby-proxy-panel"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把前面的 `#` 删除，并把 `database_id` 改成你刚才创建 D1 时得到的值。

最终看起来应该像这样：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "你的 database_id"
```

注意：`binding` 必须叫 `DB`，不要改成别的名字。

### 7. 初始化数据表

```bash
npx wrangler d1 execute cf-emby-proxy-panel --file=./schema.sql
```

看到执行成功即可。这个命令会创建：

- `routes`：保存 `/路径` 和上游地址。
- `request_stats`：保存播放统计。

### 8. 设置面板密码

建议设置 `ADMIN_TOKEN`，不设置的话面板是开放的。

```bash
npx wrangler secret put ADMIN_TOKEN
```

终端会让你输入密码。比如你输入：

```text
my-panel-password
```

以后进入面板就用这个密码。

### 9. 可选：设置 DNS 自动化变量

如果你要在面板里勾选优选 IP，并自动写入 Cloudflare DNS，需要设置这三个变量：

- `CF_API_TOKEN`
- `CF_ZONE_ID`
- `CF_DOMAIN`

#### 获取 `CF_ZONE_ID`

1. 打开 Cloudflare 控制台。
2. 进入你的域名。
3. 在右侧或 Overview 页面找到 `Zone ID`。
4. 复制它。

然后设置：

```bash
npx wrangler secret put CF_ZONE_ID
```

#### 获取 `CF_API_TOKEN`

1. 打开 Cloudflare 控制台。
2. 右上角头像。
3. `My Profile`。
4. `API Tokens`。
5. `Create Token`。
6. 选择 `Edit zone DNS` 模板，或自定义 Token。

最小权限建议：

```text
Zone - DNS - Edit
Zone - Zone - Read
```

资源范围选择你的域名即可，不要给所有域名权限。

然后设置：

```bash
npx wrangler secret put CF_API_TOKEN
```

#### 设置 `CF_DOMAIN`

`CF_DOMAIN` 是你要自动写入 DNS 的项目域名，例如：

```text
emby.example.com
```

设置命令：

```bash
npx wrangler secret put CF_DOMAIN
```

### 10. 可选：设置默认上游

如果你希望访问 Worker 根路径时也能反代到某个 Emby，可以设置：

```bash
npx wrangler secret put DEFAULT_TARGET
```

输入你的 Emby 上游，例如：

```text
https://emby.example.com:443
```

如果只想通过 `/hk`、`/home` 这种路径访问，可以不设置。

### 11. 本地检查

先检查语法：

```bash
npm run check
```

再检查 Cloudflare 打包：

```bash
npm run dry-run
```

如果看到 `--dry-run: exiting now`，说明可以部署。

如果出现 `No bindings found`，一般是 `wrangler.toml` 里 D1 那段没有取消注释，或者 `database_id` 没填。

### 12. 部署 Worker

```bash
npm run deploy
```

成功后会显示一个地址，类似：

```text
https://cf-emby-proxy-panel.xxx.workers.dev
```

打开这个地址，就能进入面板。

## 第一次使用面板

### 1. 登录面板

打开 Worker 地址：

```text
https://你的-worker.workers.dev
```

输入你设置的 `ADMIN_TOKEN`。

### 2. 新增第一个 Emby 路径

第一次进入且还没有任何路径时，页面顶部会显示 `首次使用向导`。推荐先在向导里填：

```text
入口路径：hk
Emby 上游：https://emby.example.com:443
模式：clean
```

点 `保存第一条路由` 后，你的入口就是：

```text
https://你的-worker.workers.dev/hk
```

Emby 客户端里服务器地址也填这个。

如果你已经关闭了向导，也可以点 `新增路径` 手动填写，内容和上面一样。

### 3. 多个 Emby 怎么填

如果你有多个上游，可以用英文逗号分隔：

```text
https://emby-a.example.com,https://emby-b.example.com
```

第一个上游 502/503/504 或连接失败时，会自动尝试第二个。

添加多个上游后，可以点路径列表上方的 `测试全部`，面板会显示每条路径有几个上游可用，以及最快延迟。

## 绑定自定义域名

Workers 默认域名一般是 `workers.dev`。如果你想使用自己的域名，比如：

```text
emby.example.com
```

在 Cloudflare 控制台操作：

1. 打开 Cloudflare 控制台。
2. 进入你的域名。
3. 左侧进入 `Workers Routes` 或 `Workers & Pages`。
4. 给 Worker 添加自定义域名。
5. 选择 `emby.example.com`。

绑定完成后，面板入口就是：

```text
https://emby.example.com
```

路径入口例如：

```text
https://emby.example.com/hk
```

## 使用优选 IP 和 DNS 自动写入

这个功能适合你想把项目域名 A 记录指向优选 Cloudflare IP。

使用前确保已经设置：

- `CF_API_TOKEN`
- `CF_ZONE_ID`
- `CF_DOMAIN`

面板里操作：

1. 打开面板右侧 `优选 IP`。
2. 选择 `全部`、`优选`、`电信`、`联通`、`移动` 或 `IPv6`。
3. 点 `拉取`。
4. 勾选你想写入的 IP。
5. 可点 `测速`，把延迟低的排前面。
6. 点 `预览 DNS`，确认将删除和创建的记录。
7. 确认无误后点 `写入 CF DNS`。

写入时会删除 `CF_DOMAIN` 现有的 A/AAAA/CNAME，然后创建你勾选的新记录。

规则：

- IPv4 写入 A。
- IPv6 写入 AAAA。
- 域名写入 CNAME。

## 方式二：Cloudflare 网页控制台部署

如果你完全不想用命令行，也可以手动部署，不过后续更新会麻烦一点。

### 1. 创建 Worker

1. 打开 Cloudflare 控制台。
2. 进入 `Workers & Pages`。
3. 点 `Create application`。
4. 选择 `Worker`。
5. 创建一个 Worker。

### 2. 粘贴代码

1. 进入 Worker。
2. 点 `Edit code`。
3. 打开本项目的 `src/worker.js`。
4. 全选复制代码。
5. 粘贴到 Cloudflare 编辑器。
6. 保存并部署。

### 3. 创建并绑定 D1

1. Cloudflare 控制台进入 `Workers & Pages`。
2. 找到 `D1 SQL Database`。
3. 创建数据库，名称可以叫 `cf-emby-proxy-panel`。
4. 回到 Worker 的 `Settings`。
5. 找到 `Bindings`。
6. 添加 D1 database binding。
7. 变量名填 `DB`。
8. 选择刚创建的 D1 数据库。

### 4. 初始化表结构

网页控制台不太适合执行 `schema.sql`。推荐还是在本地运行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --file=./schema.sql
```

如果你完全不想用命令行，可以在 Cloudflare D1 控制台的 SQL 页面手动执行 `schema.sql` 里的内容。

### 5. 添加环境变量

Worker 设置里找到 `Variables and Secrets`，添加：

```text
ADMIN_TOKEN
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

敏感内容建议设置成 Secret。

## 环境变量说明

| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 建议 | 面板登录密码。不设置时面板开放。 |
| `CF_API_TOKEN` | DNS 功能必填 | Cloudflare API Token，需要 DNS 编辑权限。 |
| `CF_ZONE_ID` | DNS 功能必填 | Cloudflare Zone ID。 |
| `CF_DOMAIN` | DNS 功能必填 | 要自动写入 A/AAAA/CNAME 的项目域名。 |
| `DEFAULT_TARGET` | 可选 | 不使用 `/路径` 时的默认上游。 |
| `BLOCKED_COUNTRIES` | 可选 | 逗号分隔国家代码，例如 `JP,RU`。 |
| `BLOCKED_CLIENTS` | 可选 | 逗号分隔关键词，命中 URL 或请求头时返回 403。 |
| `BROWSER_MODE` | 可选 | `proxy`、`status`、`block`，默认 `proxy`。 |

## 反代模式说明

- `clean`：默认模式，隐藏 Cloudflare 客户端 IP 相关请求头。
- `real-ip`：向上游传递 `X-Real-IP` 和 `X-Forwarded-For`。
- `origin`：为前后端分离优化，重写 `Origin` 与 `Referer`。
- `direct`：尽量保留原始请求头，只做必要清理。

如果你不确定选哪个，先选 `clean`。

## 浏览器访问模式

每个路径都可以设置浏览器访问行为：

- `proxy`：浏览器也直接反代到 Emby。
- `status`：浏览器打开时显示状态页，Emby 客户端正常反代。
- `block`：浏览器访问返回拦截提示。

如果你只给 Emby 客户端使用，推荐 `status` 或 `block`。

## 常见问题

### 打开面板提示 D1 未绑定

检查 Worker 的 D1 Binding 名字是不是 `DB`。不是数据库名，是绑定变量名。

### `npm run dry-run` 提示 No bindings found

说明 `wrangler.toml` 里的 `[[d1_databases]]` 还没取消注释，或者 `database_id` 没填。

### 面板能打开，但新增路径失败

通常是 D1 表没有初始化。重新执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --file=./schema.sql
```

### DNS 写入失败

检查三件事：

- `CF_API_TOKEN` 是否有 `Zone DNS Edit` 权限。
- `CF_ZONE_ID` 是否是当前域名的 Zone ID。
- `CF_DOMAIN` 是否属于这个 Zone。

### 访问 Emby 返回 502

可能原因：

- 上游 Emby 地址填错。
- 上游证书异常。
- 上游屏蔽了 Cloudflare 出口。
- Emby 端口没有开放。

先在浏览器里直接打开上游地址确认能访问，再回到面板里点测速。
如果你有很多路径，可以点 `测试全部`，先看是哪条路径或哪个上游异常。

### 客户端能进但播放失败

尝试：

- 路径模式换成 `origin`。
- 确认 Emby 上游可以正常播放。
- 确认反代入口使用 `https://域名/路径`，不要漏掉路径。
- 检查 m3u8 或视频流是否被上游防盗链拦截。

### 忘记面板密码

重新设置 Secret：

```bash
npx wrangler secret put ADMIN_TOKEN
```

部署不用重来，Secret 会直接生效。

## 更新项目

如果你是 Git clone 的项目：

```bash
git pull
npm install
npm run deploy
```

如果你是下载 ZIP 的项目，重新下载新版 ZIP，再按部署步骤执行即可。

## 安全建议

- 一定要设置 `ADMIN_TOKEN`。
- `CF_API_TOKEN` 只给当前域名的 DNS 编辑权限，不要给全账号权限。
- 不用的 GitHub Token、Cloudflare Token 及时撤销。
- 不要把 `.dev.vars`、token、密码提交到 GitHub。

## API 摘要

- `GET /api/doctor`：部署自检，检查 D1、DNS 变量/API、默认上游和面板安全设置。
- `GET /api/version-check`：检查 GitHub main 分支最新提交。
- `GET /api/routes`：读取路径配置。
- `POST /api/routes`：新增或更新路径。
- `DELETE /api/routes?prefix=hk`：删除路径。
- `POST /api/routes/import`：批量导入路由配置。
- `POST /api/routes/reorder`：保存路径排序。
- `GET /api/stats`：读取播放统计和热门路径。
- `GET /api/get-remote-ips?type=all`：拉取远程优选 IP。
- `GET /api/fetch-ips?url=...`：解析自定义 IP 源。
- `GET /api/dns-status`：查看目标域名 DNS 记录。
- `POST /api/dns-preview`：预览 DNS 写入会删除和创建哪些记录。
- `POST /api/update-dns`：写入选中的 IP。
