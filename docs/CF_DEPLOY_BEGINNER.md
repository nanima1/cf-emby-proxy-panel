# 小白 Cloudflare 部署教程 🧭

这篇教程按“完全第一次用 Cloudflare Workers + D1”的标准写。你不用先理解所有概念，按顺序做就行。做到哪一步卡住，就看对应的“成功标志”和“常见错误”。

## 先看路线图 🗺️

整个部署分成 7 件事：

1. 准备 Cloudflare 账号、域名、Node.js。
2. 下载项目。
3. 创建 Cloudflare D1 数据库。
4. 把 D1 绑定到 Worker，绑定名必须是 `DB`。
5. 初始化 D1 三张表：`routes`、`request_stats`、`settings`。
6. 设置面板密码和可选 DNS 自动化变量。
7. 部署 Worker，打开网页面板添加 Emby 路径。

推荐方式是命令行部署，后续更新最方便。完全不想用命令行，也可以看后面的“网页控制台手动部署”。

## 你需要准备什么 ✅

- 一个 Cloudflare 账号。
- 一个已经托管到 Cloudflare 的域名，例如 `example.com`。
- 一台能运行命令的电脑，Windows、macOS、Linux 都可以。
- Node.js 20 或更高版本。
- 你的 Emby 原地址，例如 `https://emby.example.com:443`。

如果只是先部署反代面板，不需要马上准备 Cloudflare API Token。只有要使用“优选 IP 写入 DNS”时，才需要准备 `CF_API_TOKEN`、`CF_ZONE_ID`、`CF_DOMAIN`。

## 名词先解释一下 💡

### Worker 是什么

Worker 是 Cloudflare 上运行的一段 JavaScript。这个项目的核心代码是 `src/worker.js`，部署后它负责显示面板、保存路由、代理 Emby 请求。

### D1 是什么

D1 是 Cloudflare 的 SQLite 数据库。本项目用它保存：

- 你添加的 `/hk`、`/home`、`/movie` 路由。
- 每个路由对应的 Emby 上游地址。
- 播放请求统计。
- 面板外观设置，例如背景图 URL 和透明度。

没有 D1，面板可以打开，但不能长期保存配置。

### Binding 是什么

Binding 是 Worker 访问 D1 时用的变量名。本项目代码固定读取 `env.DB`，所以 D1 binding 名必须填写：

```text
DB
```

不要填数据库名，也不要填别的名字。

### Secret 是什么

Secret 是 Cloudflare 上保存密码和 Token 的地方，例如：

- `ADMIN_TOKEN`：面板登录密码。
- `CF_API_TOKEN`：Cloudflare DNS API Token。

Secret 不会在控制台明文展示，比普通变量更适合放敏感内容。

## 方式 A：命令行部署，推荐 🚀

### A-1. 安装 Node.js

打开这个网站下载 LTS 版本并安装：

[https://nodejs.org](https://nodejs.org)

安装完成后打开 PowerShell 或终端，输入：

```bash
node -v
npm -v
```

成功标志：能看到版本号，例如：

```text
v22.x.x
10.x.x
```

如果提示 `node` 或 `npm` 无法识别，说明 Node.js 没装好，回到这一步重新安装。

### A-2. 下载项目

会用 Git 的话执行：

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
```

不会用 Git 的话：

1. 打开项目页面：[https://github.com/nanima1/cf-emby-proxy-panel](https://github.com/nanima1/cf-emby-proxy-panel)
2. 点绿色 `Code`。
3. 点 `Download ZIP`。
4. 解压 ZIP。
5. 进入解压后的 `cf-emby-proxy-panel` 文件夹。
6. 在文件夹空白处右键，选择 `在终端中打开` 或 `Open in Terminal`。

成功标志：当前目录里能看到这些文件：

```text
package.json
wrangler.toml
schema.sql
src
```

### A-3. 安装依赖

在项目目录执行：

```bash
npm install
```

成功标志：出现类似 `added xx packages`，并且项目里多了 `node_modules` 文件夹。

### A-4. 登录 Cloudflare

执行：

```bash
npx wrangler login
```

浏览器会打开 Cloudflare 授权页。登录并允许 Wrangler 访问即可。

成功标志：终端显示类似：

```text
Successfully logged in.
```

如果浏览器没有自动打开，终端里会显示一个链接，把链接复制到浏览器打开。

### A-5. 创建 D1 数据库

执行：

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

成功后终端会输出一段 `[[d1_databases]]`，大概长这样：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "12345678-abcd-1234-abcd-123456789abc"
```

把这段先复制下来，下一步要填到 `wrangler.toml`。

### A-6. 修改 `wrangler.toml`

打开项目里的 `wrangler.toml`，找到类似内容：

```toml
# [[d1_databases]]
# binding = "DB"
# database_name = "cf-emby-proxy-panel"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把前面的 `#` 删除，并把 `database_id` 换成你刚刚创建 D1 时得到的 ID。

改完应该像这样：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "12345678-abcd-1234-abcd-123456789abc"
```

检查重点：

- `[[d1_databases]]` 前面不能有 `#`。
- `binding` 必须是 `"DB"`。
- `database_id` 必须是你自己的真实 ID。
- 引号不要删。

### A-7. 初始化 D1 数据表

这一步是创建表，必须执行。否则面板保存路由、统计和背景设置都会失败。

执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

注意这里有 `--remote`，表示初始化 Cloudflare 线上的 D1。

成功标志：终端没有红色报错，并显示执行完成。

这个命令会创建三张表：

| 表 | 保存什么 |
| --- | --- |
| `routes` | 路由路径、Emby 上游、反代模式、排序和访问策略 |
| `request_stats` | 每日播放请求统计 |
| `settings` | 面板外观设置，例如背景图 URL 和透明度 |

如果你看到 `D1_EXEC_ERROR`，先跳到本文后面的“D1 incomplete input 怎么办”。

### A-8. 设置面板登录密码

建议一定设置 `ADMIN_TOKEN`，不设置时面板是开放的。

执行：

```bash
npx wrangler secret put ADMIN_TOKEN
```

终端会提示你输入值。这里输入你想设置的面板密码，例如：

```text
my-panel-password
```

输入时可能不会显示字符，这是正常的。

成功标志：

```text
Uploaded secret ADMIN_TOKEN
```

### A-9. 可选：设置 DNS 自动化变量

如果你只想先部署面板和反代，可以跳过这一步。

如果你想在面板里勾选优选 IP，然后自动写入 Cloudflare DNS，就需要设置下面三个：

```text
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

#### `CF_DOMAIN` 填什么

填你要自动写 DNS 的项目域名，例如：

```text
emby.example.com
```

设置命令：

```bash
npx wrangler secret put CF_DOMAIN
```

#### `CF_ZONE_ID` 去哪里找

1. 打开 Cloudflare 控制台。
2. 进入你的域名，例如 `example.com`。
3. 进入 Overview 页面。
4. 找到 `Zone ID`。
5. 复制它。

设置命令：

```bash
npx wrangler secret put CF_ZONE_ID
```

#### `CF_API_TOKEN` 怎么创建

1. Cloudflare 右上角头像。
2. 点 `My Profile`。
3. 点 `API Tokens`。
4. 点 `Create Token`。
5. 可以选择 `Edit zone DNS` 模板。
6. Zone Resources 选择你的域名。

权限至少需要：

```text
Zone - DNS - Edit
Zone - Zone - Read
```

设置命令：

```bash
npx wrangler secret put CF_API_TOKEN
```

### A-10. 检查 Worker 语法

执行：

```bash
npm run check
```

成功标志：没有红色报错。

### A-11. 检查 Cloudflare 打包

执行：

```bash
npm run dry-run
```

成功标志：能完成 dry run。

如果看到：

```text
No bindings found
```

一般是 `wrangler.toml` 里的 D1 配置没有生效。回到 A-6 检查 `#` 是否删除、`database_id` 是否填好。

### A-12. 部署 Worker

执行：

```bash
npm run deploy
```

成功后会出现 Worker 地址，例如：

```text
https://cf-emby-proxy-panel.xxx.workers.dev
```

打开这个地址，就能进入面板。

## 第一次进面板怎么填 🎯

### 1. 登录

打开部署后的 Worker 地址，输入你在 A-8 设置的 `ADMIN_TOKEN`。

### 2. 用小白生成器添加第一条路由

右侧找到 `小白生成器`，按下面填：

```text
Emby 原地址：https://你的-emby-上游.com:443
入口路径：hk
推荐模式：clean
```

注意：

- `入口路径` 不要带 `/`，填 `hk`，不要填 `/hk`。
- `Emby 原地址` 最好填完整地址，例如 `https://你的-emby-上游.com:443`。
- 如果你粘贴的是 `https://你的-emby-上游.com/web/index.html`，生成器会自动整理成更适合反代的地址。
- 不确定模式就先选 `clean`，前后端分离再试 `origin`。

点击 `生成并填入` 后，面板会自动：

- 把路径前缀填成 `hk`。
- 把上游 Emby 填成你的原地址。
- 显示反代后的客户端地址。

确认无误后点 `保存路径`。

你的 Emby 客户端服务器地址就是：

```text
https://你的-worker.workers.dev/hk
```

如果你绑定了自定义域名，就是：

```text
https://emby.example.com/hk
```

### 3. 多个 Emby 怎么加

继续用小白生成器添加不同路径：

```text
hk
home
movie
jp
```

每个路径会生成一个独立入口：

```text
https://emby.example.com/hk
https://emby.example.com/home
https://emby.example.com/movie
```

### 4. 路由卡片怎么排序

每张路由卡片左上角都有拖动手柄。按住拖动即可排序，松手后会自动保存到 D1。也可以点卡片里的 `上移`、`下移`。

### 5. 背景图怎么设置

右侧找到 `外观背景`：

1. 填图床直链或随机图 API，例如 `https://example.com/random.jpg`。
2. 调整背景可见度。
3. 点 `应用背景`。

配置会保存到 D1 的 `settings` 表。为了安全，D1 只保存 URL 和透明度，不保存图片文件本体，也不允许 `data:` base64。

## 绑定自定义域名 🌐

Workers 默认域名通常是 `workers.dev`。如果你想用自己的域名，例如：

```text
emby.example.com
```

在 Cloudflare 控制台操作：

1. 进入 `Workers & Pages`。
2. 点你的 Worker。
3. 找到 `Settings`。
4. 找到 `Domains & Routes`。
5. 点 `Add`。
6. 选择 `Custom domain`。
7. 填 `emby.example.com`。
8. 保存。

成功后面板入口就是：

```text
https://emby.example.com
```

路由入口就是：

```text
https://emby.example.com/hk
```

## 优选 IP 写入 DNS 怎么用 ⚡

这个功能不是部署必需项，是加速优化项。

前提：你已经设置：

```text
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

面板里操作：

1. 找到 `优选 IP`。
2. 类型先选 `全部`。
3. 点 `拉取`。
4. 勾选几个 IP。
5. 点 `测速`，延迟低的保留勾选。
6. 点 `预览 DNS`。
7. 看清楚 `将删除` 和 `将创建` 的记录。
8. 没问题再点 `写入 CF DNS`。

它会做什么：

- 删除 `CF_DOMAIN` 当前已有的 A/AAAA/CNAME。
- 新建你勾选的 A/AAAA/CNAME。
- TXT、MX 等其他类型记录会保留。

第一次用建议只选 1 到 3 个 IP 测试。

## 方式 B：网页控制台手动部署 🧩

如果你完全不想用命令行，可以走这个方式。但 D1 初始化仍建议用命令行，因为网页 SQL 很容易只粘贴一半。

### B-1. 创建 Worker

1. 打开 Cloudflare 控制台。
2. 进入 `Workers & Pages`。
3. 点 `Create application`。
4. 选择 `Worker`。
5. 随便填一个名字，例如 `cf-emby-proxy-panel`。
6. 创建。

### B-2. 粘贴 Worker 代码

1. 进入刚创建的 Worker。
2. 点 `Edit code`。
3. 打开本项目的 `src/worker.js`。
4. 复制全部内容。
5. 粘贴到 Cloudflare 编辑器。
6. 点 `Deploy`。

### B-3. 创建 D1

1. Cloudflare 控制台左侧找到 `Workers & Pages`。
2. 找到 `D1 SQL Database`。
3. 点 `Create database`。
4. 名字填 `cf-emby-proxy-panel`。
5. 创建。

### B-4. 绑定 D1 到 Worker

1. 回到 Worker。
2. 点 `Settings`。
3. 找到 `Bindings`。
4. 添加 `D1 database binding`。
5. Variable name 填：

```text
DB
```

6. D1 database 选择刚创建的数据库。
7. 保存。

### B-5. 初始化 D1 表

推荐用命令：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

如果必须在网页 SQL 控制台里执行，就完整粘贴下面整段，不要只粘贴第一行：

```sql
CREATE TABLE IF NOT EXISTS routes (
  prefix TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  mode TEXT DEFAULT 'clean',
  remark TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  last_play TEXT DEFAULT '',
  cacheImages INTEGER DEFAULT 1,
  order_idx INTEGER DEFAULT 0,
  access_policy TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS request_stats (
  prefix TEXT,
  date TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY(prefix, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

成功标志：SQL 执行成功，没有红色报错。

### B-6. 添加变量和 Secret

Worker 页面：

1. 进入 `Settings`。
2. 找到 `Variables and Secrets`。
3. 添加 Secret：`ADMIN_TOKEN`。
4. 如果要 DNS 自动化，再添加：

```text
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

保存后重新部署一次 Worker。

## D1 incomplete input 怎么办 🧯

你看到的错误：

```text
D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS routes (: incomplete input: SQLITE_ERROR
```

意思是 D1 只收到这一半：

```sql
CREATE TABLE IF NOT EXISTS routes (
```

它没有收到后面的字段、右括号和分号。

解决方法：

1. 不要只复制第一行。
2. 从 `CREATE TABLE IF NOT EXISTS routes (` 一直复制到最后一个 `);`。
3. 三张表都要复制：`routes`、`request_stats`、`settings`。
4. 每个 `CREATE TABLE` 最后都必须有英文分号 `;`。

最稳的办法还是用命令行执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

## 部署后先看“部署自检” 🩺

打开 Worker 面板并登录后，页面顶部会看到 `部署自检` 卡片。它会检查：

- `ADMIN_TOKEN`：有没有设置面板登录密码。
- `D1 binding`：D1 是否绑定到 Worker，绑定名是不是 `DB`。
- `D1 tables`：`routes`、`request_stats`、`settings` 三张表是否能正常访问。
- `DNS variables`：是否配置了 `CF_API_TOKEN`、`CF_ZONE_ID`、`CF_DOMAIN`。
- `Cloudflare DNS API`：如果 DNS 变量都填了，会尝试访问 Cloudflare API。
- `DEFAULT_TARGET`：如果设置了默认上游，会做快速连通性检查。

怎么看结果：

- `pass`：正常。
- `warn`：不是必填，或暂时不影响基础使用，但建议后面处理。
- `fail`：必须处理，例如 D1 没绑定、D1 表不存在、DNS Token 填错。
- `info`：提示信息，不是错误。

如果要找别人帮忙排错，先点 `复制报告`。报告不会复制 Cloudflare Token 或面板密码。

## 路由配置怎么备份和恢复 💾

建议在这些情况先点一次 `导出配置`：

- 已经添加了很多 `/hk`、`/home`、`/jp` 路径。
- 准备换 D1、改 Worker、重新部署。
- 准备批量导入别人给你的配置。

导出：

1. 进入面板。
2. 点路由列表上方的 `导出配置`。
3. 浏览器会下载一个 `emby-routes-日期.json` 文件。
4. 把这个 JSON 放到 D 盘、网盘或其他安全位置。

恢复：

1. 进入面板。
2. 点 `导入配置`。
3. 选择之前导出的 JSON 文件。
4. 确认导入。

同名路径会覆盖，例如两个都是 `hk`，新导入的 `/hk` 会覆盖旧配置；不同名路径会新增。

## 常见问题 FAQ ❓

### 面板打开后提示 D1 未绑定

原因：Worker 没有绑定 D1，或者绑定变量名不是 `DB`。

处理：

- Cloudflare Worker 设置里找到 `Bindings`。
- 确认 D1 binding 的 Variable name 是 `DB`。
- 改完后重新部署 Worker。

### `No bindings found`

原因：`wrangler.toml` 没有启用 D1 配置。

处理：

- 打开 `wrangler.toml`。
- 删除 `[[d1_databases]]` 前面的 `#`。
- 删除 `binding/database_name/database_id` 前面的 `#`。
- 填入真实 `database_id`。

### 面板新增路由失败

通常是 D1 表没有初始化。

处理：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

### DNS 写入失败

按顺序检查：

1. `CF_API_TOKEN` 是否设置。
2. Token 是否有 `Zone - DNS - Edit` 权限。
3. `CF_ZONE_ID` 是否是这个域名的 Zone ID。
4. `CF_DOMAIN` 是否属于这个 Zone。
5. `CF_DOMAIN` 不要填 Worker 地址，要填你的项目域名，例如 `emby.example.com`。
6. 先点 `预览 DNS`，如果预览都失败，说明 Cloudflare API Token 或 Zone 配置还没通。

### Emby 返回 502

先检查上游地址：

- 是否能在浏览器直接打开。
- 是否带了 `https://`。
- 端口是否正确。
- 证书是否正常。
- 上游是否屏蔽 Cloudflare。
- 面板里点 `测试全部`，看这条路径是否有可用上游。

### 客户端能登录但不能播放

尝试：

- 路由模式从 `clean` 改成 `origin`。
- 客户端服务器地址确认带了路径，例如 `/hk`。
- 确认上游 Emby 本身可以播放。
- 如果上游有防盗链，先关闭防盗链测试。

## 最后检查清单 ✅

部署完成前逐项确认：

- `wrangler.toml` 已填 D1 `database_id`。
- D1 binding 名是 `DB`。
- 已执行 `schema.sql`。
- `routes`、`request_stats`、`settings` 三张表都存在。
- 已设置 `ADMIN_TOKEN`。
- `npm run check` 通过。
- `npm run dry-run` 通过。
- `npm run deploy` 成功。
- 能打开 Worker 面板。
- 面板能保存第一条路径。
- Emby 客户端能访问 `https://域名/路径`。
- 已点 `导出配置` 备份重要路由。

完成这些，基本就跑起来了。
