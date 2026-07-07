# 小白 Cloudflare 部署教程

这篇教程按“完全第一次用 Cloudflare Workers”的标准来写。你不需要先理解所有概念，只要按顺序做，做到哪一步卡住，就对照对应的“成功标志”和“常见错误”。

## 先看这张路线图

整个部署分成 6 件事：

1. 把项目下载到电脑。
2. 登录 Cloudflare。
3. 创建 D1 数据库，用来保存面板里的路径配置。
4. 把 D1 绑定到 Worker，绑定名必须叫 `DB`。
5. 设置面板密码和可选的 DNS 自动化变量。
6. 部署 Worker，打开网址进入面板。

你可以选择两种部署方式：

- 推荐方式：命令行部署。后续更新最方便。
- 备用方式：Cloudflare 网页控制台手动部署。适合完全不想用命令行的人。

如果你愿意用命令行，建议直接走“方式 A”。

## 名词先解释一下

### Worker 是什么

Worker 就是 Cloudflare 上运行的一段 JavaScript。这个项目的 `src/worker.js` 就是 Worker 代码。

### D1 是什么

D1 是 Cloudflare 的数据库。本项目用它保存：

- 你在面板里添加的 `/hk`、`/home` 这些路径。
- 每个路径对应的 Emby 上游地址。
- 播放统计。

没有 D1，面板能打开，但无法保存路径。

### Binding 是什么

Binding 是 Worker 访问 D1 的“变量名”。本项目代码里固定读取 `env.DB`，所以 D1 binding 名必须填：

```text
DB
```

不要填成数据库名，也不要填成别的名字。

### Secret 是什么

Secret 是 Cloudflare 上保存密码和 token 的地方。比如：

- `ADMIN_TOKEN`：面板登录密码。
- `CF_API_TOKEN`：Cloudflare DNS API Token。

Secret 不会显示明文，比普通变量更安全。

## 方式 A：命令行部署，推荐

### A-1. 安装 Node.js

打开这个网站：

[https://nodejs.org](https://nodejs.org)

下载 LTS 版本并安装。安装完成后，打开 PowerShell 或终端，输入：

```bash
node -v
npm -v
```

成功标志：

```text
v20.x.x 或 v22.x.x
10.x.x
```

只要能看到版本号，就可以继续。

### A-2. 下载项目

如果你会 Git，执行：

```bash
git clone https://github.com/nanima1/cf-emby-proxy-panel.git
cd cf-emby-proxy-panel
```

如果不会 Git：

1. 打开项目地址：[https://github.com/nanima1/cf-emby-proxy-panel](https://github.com/nanima1/cf-emby-proxy-panel)
2. 点绿色 `Code`
3. 点 `Download ZIP`
4. 解压 ZIP
5. 进入解压后的 `cf-emby-proxy-panel` 文件夹
6. 在文件夹空白处右键，选择 `在终端中打开` 或 `Open in Terminal`

成功标志：终端当前目录里能看到这些文件：

```text
package.json
wrangler.toml
schema.sql
src
```

### A-3. 安装项目依赖

在项目目录里执行：

```bash
npm install
```

成功标志：

```text
added xx packages
found 0 vulnerabilities
```

如果出现 `npm : 无法识别`，说明 Node.js 没装好，回到 A-1。

### A-4. 登录 Cloudflare

执行：

```bash
npx wrangler login
```

会自动打开浏览器，让你登录 Cloudflare 并授权 Wrangler。

成功标志：终端显示类似：

```text
Successfully logged in.
```

如果浏览器没有自动打开，终端会给一个网址，把网址复制到浏览器打开。

### A-5. 创建 D1 数据库

执行：

```bash
npx wrangler d1 create cf-emby-proxy-panel
```

成功后，终端会输出一段 `[[d1_databases]]`。大概长这样：

```toml
[[d1_databases]]
binding = "DB"
database_name = "cf-emby-proxy-panel"
database_id = "12345678-abcd-1234-abcd-123456789abc"
```

把这段先复制下来，下一步要填到 `wrangler.toml`。

### A-6. 修改 `wrangler.toml`

打开项目里的 `wrangler.toml`。

你会看到类似内容：

```toml
# [[d1_databases]]
# binding = "DB"
# database_name = "cf-emby-proxy-panel"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把前面的 `#` 删除，并把 `database_id` 换成你自己的。

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
- `database_id` 必须是你自己创建 D1 后得到的 ID。
- 引号不要删。

### A-7. 初始化 D1 数据表

这一步是创建表。必须执行，否则面板保存路径会失败。

执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

注意这里有 `--remote`。它表示初始化 Cloudflare 线上的 D1。

成功标志：终端没有报错，并显示执行完成。

如果你看到：

```text
D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS routes (: incomplete input
```

意思是 SQL 没有完整执行，只读到了第一行。解决方法看本文后面的“D1 incomplete input 怎么办”。

### A-8. 设置面板登录密码

执行：

```bash
npx wrangler secret put ADMIN_TOKEN
```

终端会提示你输入值。这里输入你想设置的面板密码，比如：

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

如果你想在面板里点“写入 CF DNS”，就必须设置下面三个：

```text
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

#### CF_DOMAIN 填什么

填你要自动写 DNS 的域名，例如：

```text
emby.example.com
```

设置命令：

```bash
npx wrangler secret put CF_DOMAIN
```

#### CF_ZONE_ID 去哪里找

1. 打开 Cloudflare 控制台。
2. 进入你的域名，例如 `example.com`。
3. 进入 Overview 页面。
4. 右侧能看到 `Zone ID`。
5. 复制它。

设置命令：

```bash
npx wrangler secret put CF_ZONE_ID
```

#### CF_API_TOKEN 怎么创建

1. Cloudflare 右上角头像。
2. 点 `My Profile`。
3. 点 `API Tokens`。
4. 点 `Create Token`。
5. 可以选 `Edit zone DNS` 模板。
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

成功标志：

```text
--dry-run: exiting now.
```

如果看到：

```text
No bindings found
```

说明 `wrangler.toml` 里 D1 那段没生效。回到 A-6 检查 `#` 是否删除、`database_id` 是否填好。

### A-12. 部署 Worker

执行：

```bash
npm run deploy
```

成功后会出现一个地址，例如：

```text
https://cf-emby-proxy-panel.xxx.workers.dev
```

打开这个地址，就能进入面板。

## 第一次进面板怎么填

### 1. 登录

打开部署后的 Worker 地址，输入你在 A-8 设置的 `ADMIN_TOKEN`。

### 2. 用首次使用向导新增路径

如果你还没有添加过路径，面板顶部会显示 `首次使用向导`。

先看左边步骤：

- `D1 数据库` 必须是 `pass`，否则先回去检查 D1 绑定和初始化。
- `第一条路由` 如果是 `warn`，表示还没添加路径，这是正常的。
- `DNS 自动化` 如果是 `info`，表示你还没配 DNS 自动写入，不影响先使用反代。

然后在右侧表单填：

```text
入口路径：hk
上游 Emby：https://你的-em by-上游.com:443
模式：clean
```

注意：

- `入口路径` 不要带 `/`，填 `hk`，不是 `/hk`。
- `上游 Emby` 必须带 `http://` 或 `https://`。
- 不确定模式就选 `clean`。

点 `保存第一条路由` 后，你的 Emby 客户端服务器地址就是：

```text
https://你的-worker.workers.dev/hk
```

如果你绑定了自定义域名，就是：

```text
https://emby.example.com/hk
```

如果你点了 `稍后处理` 关闭向导，也可以在主面板点 `新增路径` 手动填写同样的内容。

添加路径后，可以点路径列表上方的 `测试全部`。面板会逐个测试每条路径里的所有上游，并显示几个可用、最快多少毫秒。

如果路径很多，可以在每张路径卡片里点 `上移` 或 `下移` 调整显示顺序。排序会保存到 D1，下次打开面板仍然保持这个顺序。

有 Emby 客户端开始访问后，`播放统计` 会显示累计播放请求、活跃路径和热门路径排行。刚部署完没有播放记录时，统计为空是正常的。

## 绑定自定义域名

如果你想不用 `workers.dev`，而是用自己的域名，比如：

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

成功后访问：

```text
https://emby.example.com
```

面板路径访问：

```text
https://emby.example.com/hk
```

## 优选 IP 写入 DNS 怎么用

这一步不是部署必需项，是加速优化项。

前提：你已经设置了：

```text
CF_API_TOKEN
CF_ZONE_ID
CF_DOMAIN
```

面板里操作：

1. 右侧找到 `优选 IP`。
2. 类型先选 `全部`。
3. 点 `拉取`。
4. 勾选几个 IP。
5. 点 `测速`。
6. 延迟低的保留勾选。
7. 点 `预览 DNS`。
8. 看清楚 `将删除` 和 `将创建` 的记录。
9. 没问题再点 `写入 CF DNS`。

它会做什么：

- 删除 `CF_DOMAIN` 当前已有的 A/AAAA/CNAME。
- 新建你勾选的 A/AAAA/CNAME。
- TXT、MX 等其他类型记录会保留，不会因为这个功能删除。

所以第一次用建议只选 1 到 3 个 IP 测试。

## 方式 B：网页控制台手动部署

如果你不想使用命令行，可以走这个方式。但 D1 初始化还是建议用命令行，网页 SQL 容易只粘贴一半。

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

6. D1 database 选择你刚创建的数据库。
7. 保存。

### B-5. 初始化 D1 表

推荐用命令：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

如果你必须在网页 SQL 控制台里执行，就完整粘贴下面整段，不要只粘第一行：

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

## D1 incomplete input 怎么办

你看到的错误：

```text
D1_EXEC_ERROR: Error in line 1: CREATE TABLE IF NOT EXISTS routes (: incomplete input: SQLITE_ERROR
```

意思是 D1 只收到了这半句：

```sql
CREATE TABLE IF NOT EXISTS routes (
```

它没有收到后面的字段、右括号和分号。

解决办法：

1. 不要只复制第一行。
2. 从 `CREATE TABLE IF NOT EXISTS routes (` 一直复制到最后一个 `);`。
3. 两张表都要复制。
4. 每个 `CREATE TABLE` 最后都必须有英文分号 `;`。

最稳的办法是用命令行执行：

```bash
npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql
```

如果你用网页 SQL 控制台，就粘贴 B-5 里的完整 SQL。

## 部署后先看“部署自检”

打开 Worker 面板并登录后，页面顶部会看到 `部署自检` 卡片。它会自动检查几件最容易配错的事情：

- `ADMIN_TOKEN`：有没有设置面板登录密码。
- `D1 binding`：D1 是否绑定到 Worker，绑定名是不是 `DB`。
- `D1 tables`：`routes` 和 `request_stats` 两张表是否能正常访问。
- `DNS variables`：是否配置了 `CF_API_TOKEN`、`CF_ZONE_ID`、`CF_DOMAIN`。
- `Cloudflare DNS API`：如果 DNS 变量都填了，会尝试访问 Cloudflare API。
- `DEFAULT_TARGET`：如果设置了默认上游，会做一次快速连通性检查。

怎么看结果：

- `pass`：这一项正常。
- `warn`：不是必填项，或者当前不影响基本使用，但建议后面处理。
- `fail`：必须处理。比如 D1 没绑定、D1 表访问失败、DNS Token 填错。
- `info`：提示信息，不是错误。

最常见的情况：

- 只想先用 `/hk`、`/home` 这种路径反代 Emby：`DNS variables` 和 `DEFAULT_TARGET` 出现 `warn/info` 可以先不管。
- 面板保存不了路径：优先看 `D1 binding` 和 `D1 tables`，这两项必须是 `pass`。
- 优选 IP 写入 DNS 失败：优先看 `DNS variables` 和 `Cloudflare DNS API`。

如果你要找别人帮忙排错，先点 `复制报告`。它会复制版本号、D1/DNS 状态、检查结果和建议动作，不会复制 Cloudflare Token 或面板密码。

## 路由配置怎么备份和恢复

建议在下面几种情况先点一次 `导出配置`：

- 已经添加了很多 `/hk`、`/home`、`/jp` 路径。
- 准备改 D1、改 Worker、重新部署。
- 准备批量导入别人给你的配置。

导出：

1. 进入面板。
2. 点路径列表上方的 `导出配置`。
3. 浏览器会下载一个 `emby-routes-日期.json` 文件。
4. 把这个 JSON 放到 D 盘、网盘或其他安全位置。

恢复：

1. 进入面板。
2. 点 `导入配置`。
3. 选择之前导出的 JSON 文件。
4. 确认导入。

注意：导入时如果 JSON 里有同名路径，比如都是 `hk`，会覆盖面板里原来的 `/hk` 配置；不同名路径会新增。

## 常见问题

### 面板打开后提示 D1 未绑定

原因：Worker 没有绑定 D1，或者绑定变量名不是 `DB`。

处理：

- Cloudflare Worker 设置里找到 Bindings。
- 确认 D1 binding 的 Variable name 是 `DB`。
- 改完后重新部署 Worker。

### `No bindings found`

原因：`wrangler.toml` 没有启用 D1 配置。

处理：

- 打开 `wrangler.toml`。
- 删除 `[[d1_databases]]` 前面的 `#`。
- 删除 `binding/database_name/database_id` 前面的 `#`。
- 填入真实 `database_id`。

### 面板新增路径失败

原因通常是 D1 表没初始化。

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
5. `CF_DOMAIN` 不要填成 Worker 地址，应该填你的项目域名，例如 `emby.example.com`。
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

- 路径模式从 `clean` 改成 `origin`。
- 客户端服务器地址确认带了路径，例如 `/hk`。
- 确认上游 Emby 本身可以播放。
- 如果上游有防盗链，先关闭防盗链测试。

## 最后检查清单

部署完成前，逐项确认：

- `wrangler.toml` 已填 D1 `database_id`。
- D1 binding 名是 `DB`。
- 已执行 `schema.sql`。
- 已设置 `ADMIN_TOKEN`。
- 已点 `导出配置` 备份重要路由。
- `npm run check` 通过。
- `npm run dry-run` 通过。
- `npm run deploy` 成功。
- 能打开 Worker 面板。
- 面板能保存第一个路径。
- Emby 客户端能访问 `https://域名/路径`。

完成这些，基本就跑起来了。
