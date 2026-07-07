// VERSION: 3.0.0-combined
// Cloudflare Worker Emby reverse proxy panel.
//
// Required binding for panel routes:
// - D1 database binding named DB
//
// Recommended variables:
// - ADMIN_TOKEN: panel password/token. If empty, the panel is open.
// - CF_API_TOKEN, CF_ZONE_ID, CF_DOMAIN: Cloudflare DNS automation.
// - DEFAULT_TARGET: optional fallback Emby upstream when no /prefix route is used.
// - BLOCKED_COUNTRIES: comma separated country codes, e.g. "JP,RU".
// - BLOCKED_CLIENTS: comma separated keywords checked against URL and headers.
// - BROWSER_MODE: proxy | status | block. Route-level setting can override this.

const VERSION = "3.0.0-combined";
const REPO_OWNER = "nanima1";
const REPO_NAME = "cf-emby-proxy-panel";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const COOKIE_NAME = "emby_panel_auth";
const SESSION_TTL = 60 * 60 * 24 * 7;
const DEFAULT_MODE = "clean";
const DEFAULT_BROWSER_MODE = "proxy";
const APPEARANCE_SETTING_KEY = "appearance";
const DEFAULT_APPEARANCE = { backgroundUrl: "", backgroundOpacity: 28 };
const IP_SOURCE_URLS = {
  proxyip: "https://www.nslookup.io/domains/cdn-all.xn--b6gac.eu.org/dns-records/",
  bestcf: "https://addressesapi.090227.xyz/CloudFlareYes",
};

const CLIENTS = [
  { name: "Lenna", url: "https://lennaapp.github.io" },
  { name: "Hills", url: "https://apps.microsoft.com/detail/9nxnzfrllwzx?hl=zh-CN&gl=CN" },
  { name: "EplayerX", url: "https://www.eplayerx.com" },
  { name: "Yamby", url: "https://yamby.app" },
  { name: "SenPlayer", url: "https://apps.apple.com/cn/app/senplayer-%E5%85%A8%E8%83%BD%E8%A7%86%E9%A2%91%E6%92%AD%E6%94%BE%E5%99%A8-%E7%BD%91%E7%9B%98%E7%9B%B4%E8%BF%9E/id6443975850" },
  { name: "小幻影视", url: "https://apps.microsoft.com/detail/9nb0h051m4v4?hl=zh-CN&gl=CN" },
  { name: "Forward", url: "https://forward.inch.red" },
  { name: "Vidora", url: "https://testflight.apple.com/join/y478QNPY" },
  { name: "CapyPlayer", url: "https://capyplayer.feifeiduck.com/zh/download" },
  { name: "AFuseKt", url: "https://github.com/AttemptD/AfuseKt-release/releases" },
  { name: "VidHub", url: "https://zh.okaapps.com/product/1659622164?ref=newhomepagepromotion" },
  { name: "Themby", url: "https://github.com/chicring/Themby-Release/releases" },
  { name: "ChaiChai", url: "https://github.com/dh374374/ChaiChaiEmbyTV" },
];

const DEFAULT_BLOCKED_CLIENTS = [
  "bot",
  "crawler",
  "spider",
  "scrape",
  "curl",
  "wget",
  "python-requests",
  "scrapy",
];

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      return json({ success: false, error: error.message || String(error) }, 500);
    }
  },
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return corsPreflight();
  }

  const blocked = getBlockReason(request, env);
  if (blocked) {
    return new Response(blocked, {
      status: 403,
      headers: corsHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    });
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, env, ctx);
  }

  if (url.pathname === "/" || url.pathname === "/admin") {
    if (!isAuthorized(request, env)) {
      return html(loginPage(Boolean(getAdminToken(env))));
    }
    return html(panelPage(env));
  }

  if (url.pathname === "/proxy-stream" || url.pathname.startsWith("/proxy-stream/")) {
    return handleStreamProxy(request);
  }

  return proxyByRoute(request, env, ctx);
}

async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const publicApi = url.pathname === "/api/login" || url.pathname === "/api/session";
  if (!publicApi && !isAuthorized(request, env)) {
    return json({ success: false, error: "未登录或会话已过期" }, 401);
  }

  if (url.pathname === "/api/session") {
    return json({
      success: true,
      authorized: isAuthorized(request, env),
      protected: Boolean(getAdminToken(env)),
      version: VERSION,
      hasDb: Boolean(env.DB),
      hasDnsEnv: Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID && env.CF_DOMAIN),
      domain: env.CF_DOMAIN || "",
    });
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await readJson(request);
    const expected = getAdminToken(env);
    if (!expected || body.token === expected || body.password === expected) {
      return json(
        { success: true },
        200,
        {
          "Set-Cookie": `${COOKIE_NAME}=${await authDigest(expected || "open-panel")}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`,
        },
      );
    }
    return json({ success: false, error: "密码不正确" }, 403);
  }

  if (url.pathname === "/api/logout" && request.method === "POST") {
    return json({ success: true }, 200, {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
  }

  if (url.pathname === "/api/env") {
    return json({
      success: true,
      version: VERSION,
      protected: Boolean(getAdminToken(env)),
      hasDb: Boolean(env.DB),
      hasDnsEnv: Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID && env.CF_DOMAIN),
      cfDomain: env.CF_DOMAIN || "",
      defaultTarget: env.DEFAULT_TARGET || "",
      browserMode: getEnvBrowserMode(env),
      blockedCountries: splitList(env.BLOCKED_COUNTRIES).map((item) => item.toUpperCase()),
      blockedClients: splitList(env.BLOCKED_CLIENTS),
      defaultBlockedClients: DEFAULT_BLOCKED_CLIENTS,
    });
  }

  if (url.pathname === "/api/version-check") {
    return handleVersionCheck(env);
  }

  if (url.pathname === "/api/doctor") {
    return handleDoctorApi(env);
  }

  if (url.pathname === "/api/routes") {
    return handleRoutesApi(request, env);
  }

  if (url.pathname === "/api/routes/import" && request.method === "POST") {
    return handleImportRoutes(request, env);
  }

  if (url.pathname === "/api/routes/reorder" && request.method === "POST") {
    return handleReorderRoutes(request, env);
  }

  if (url.pathname === "/api/stats") {
    return handleStatsApi(env);
  }

  if (url.pathname === "/api/settings/appearance") {
    return handleAppearanceSettingsApi(request, env);
  }

  if (url.pathname === "/api/ping") {
    const target = url.searchParams.get("url");
    return json({ success: true, ms: await measureDelay(target) });
  }

  if (url.pathname === "/api/fetch-ips") {
    return handleFetchIps(url.searchParams.get("url"));
  }

  if (url.pathname === "/api/get-remote-ips") {
    return handleRemoteIps(url.searchParams.get("type") || "all");
  }

  if (url.pathname === "/api/dns-status") {
    return handleDnsStatus(env);
  }

  if (url.pathname === "/api/dns-preview" && request.method === "POST") {
    return handleDnsPreview(request, env);
  }

  if (url.pathname === "/api/update-dns" && request.method === "POST") {
    return handleDnsUpdate(request, env);
  }

  return json({ success: false, error: "API not found" }, 404);
}

async function handleVersionCheck(env) {
  const currentSha = String(env.BUILD_SHA || env.GITHUB_SHA || env.COMMIT_SHA || "").trim();
  const endpoint = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "cf-emby-proxy-panel",
      },
    });
    const data = await response.json();
    if (!response.ok || !data.sha) {
      return json({
        success: false,
        version: VERSION,
        repo: REPO_URL,
        error: "GitHub version check failed",
        detail: data.message || "",
      }, 502);
    }
    const latestSha = data.sha || "";
    return json({
      success: true,
      version: VERSION,
      repo: REPO_URL,
      currentSha,
      latestSha,
      latestShortSha: latestSha.slice(0, 7),
      latestUrl: data.html_url || `${REPO_URL}/commits/main`,
      latestDate: data.commit?.committer?.date || data.commit?.author?.date || "",
      latestMessage: data.commit?.message || "",
      upToDate: currentSha ? latestSha.startsWith(currentSha) || currentSha.startsWith(latestSha.slice(0, 12)) : null,
    });
  } catch (error) {
    return json({
      success: false,
      version: VERSION,
      repo: REPO_URL,
      error: error.message || "GitHub version check failed",
    }, 502);
  }
}

async function handleDoctorApi(env) {
  const checks = [];
  const add = (id, label, status, message, action = "") => {
    checks.push({ id, label, status, message, action });
  };

  if (getAdminToken(env)) {
    add("adminToken", "ADMIN_TOKEN", "pass", "Panel login is protected.");
  } else {
    add("adminToken", "ADMIN_TOKEN", "warn", "Panel is open because ADMIN_TOKEN is not set.", "Set ADMIN_TOKEN as a Worker secret.");
  }

  if (!env.DB) {
    add("dbBinding", "D1 binding", "fail", "D1 binding named DB is missing.", "Bind your D1 database to this Worker with variable name DB.");
  } else {
    add("dbBinding", "D1 binding", "pass", "D1 binding DB is available.");
    try {
      await ensureSchema(env.DB);
      const routeCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM routes").first();
      const statCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM request_stats").first();
      const settingCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM settings").first();
      add(
        "dbSchema",
        "D1 tables",
        "pass",
        `routes: ${Number(routeCount?.count || 0)}, request_stats: ${Number(statCount?.count || 0)}, settings: ${Number(settingCount?.count || 0)}.`,
      );
    } catch (error) {
      add(
        "dbSchema",
        "D1 tables",
        "fail",
        error.message || "D1 schema check failed.",
        "Run: npx wrangler d1 execute cf-emby-proxy-panel --remote --file=./schema.sql",
      );
    }
  }

  const missingDnsVars = ["CF_API_TOKEN", "CF_ZONE_ID", "CF_DOMAIN"].filter((name) => !env[name]);
  if (missingDnsVars.length) {
    add(
      "dnsVars",
      "DNS variables",
      "warn",
      `DNS automation is disabled. Missing: ${missingDnsVars.join(", ")}.`,
      "Set these variables only if you want the panel to write Cloudflare DNS records.",
    );
  } else {
    add("dnsVars", "DNS variables", "pass", `DNS automation target: ${env.CF_DOMAIN}.`);
    try {
      const response = await cfApi(env, `/zones/${env.CF_ZONE_ID}/dns_records?name=${encodeURIComponent(env.CF_DOMAIN)}&per_page=1`);
      const data = await response.json();
      if (response.ok && data.success) {
        add("dnsApi", "Cloudflare DNS API", "pass", `Cloudflare API is reachable. Existing records found: ${(data.result || []).length}.`);
      } else {
        add(
          "dnsApi",
          "Cloudflare DNS API",
          "fail",
          "Cloudflare rejected the DNS API check.",
          "Check CF_API_TOKEN permission, CF_ZONE_ID, and CF_DOMAIN.",
        );
      }
    } catch (error) {
      add(
        "dnsApi",
        "Cloudflare DNS API",
        "fail",
        error.message || "Could not reach Cloudflare API.",
        "Check whether the token and zone settings are correct.",
      );
    }
  }

  const defaultTarget = splitTargets(env.DEFAULT_TARGET || "")[0];
  if (!defaultTarget) {
    add("defaultTarget", "DEFAULT_TARGET", "info", "No default upstream is set. This is fine if you only use /path routes.");
  } else {
    const ms = await measureDelay(defaultTarget);
    add(
      "defaultTarget",
      "DEFAULT_TARGET",
      ms >= 0 ? "pass" : "warn",
      ms >= 0 ? `Default upstream responded in ${ms} ms.` : "Default upstream did not respond to the quick HEAD check.",
      "If routes work normally, this warning can be ignored.",
    );
  }

  const blockedCountries = splitList(env.BLOCKED_COUNTRIES).map((item) => item.toUpperCase());
  const blockedClients = splitList(env.BLOCKED_CLIENTS);
  add(
    "accessControl",
    "Access control",
    blockedCountries.length || blockedClients.length || getEnvBrowserMode(env) !== DEFAULT_BROWSER_MODE ? "pass" : "info",
    `browser: ${getEnvBrowserMode(env)}, countries: ${blockedCountries.length}, client keywords: ${blockedClients.length || DEFAULT_BLOCKED_CLIENTS.length}.`,
    "Route-level browser mode can override BROWSER_MODE.",
  );

  return json({
    success: true,
    ready: !checks.some((check) => check.status === "fail"),
    version: VERSION,
    checkedAt: new Date().toISOString(),
    checks,
  });
}

async function handleRoutesApi(request, env) {
  requireDb(env);
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const day = today();
    const rows = await env.DB.prepare(`
      SELECT r.*, IFNULL(s.count, 0) AS todayReqs
      FROM routes r
      LEFT JOIN request_stats s ON r.prefix = s.prefix AND s.date = ?
      ORDER BY r.order_idx ASC, r.prefix ASC
    `).bind(day).all();
    return json((rows.results || []).map(normalizeRoute));
  }

  if (request.method === "POST") {
    const body = normalizeRoute(await readJson(request));
    validateRoute(body);
    if (body.oldPrefix && body.oldPrefix !== body.prefix) {
      await env.DB.prepare("DELETE FROM routes WHERE prefix = ?").bind(body.oldPrefix).run();
    }
    const nextOrder = Number.isFinite(Number(body.order_idx)) ? Number(body.order_idx) : Date.now();
    await env.DB.prepare(`
      INSERT INTO routes(prefix, target, mode, remark, icon, cacheImages, order_idx, access_policy)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(prefix) DO UPDATE SET
        target = excluded.target,
        mode = excluded.mode,
        remark = excluded.remark,
        icon = excluded.icon,
        cacheImages = excluded.cacheImages,
        order_idx = excluded.order_idx,
        access_policy = excluded.access_policy
    `).bind(
      body.prefix,
      body.target,
      body.mode || DEFAULT_MODE,
      body.remark || "",
      body.icon || "",
      body.cacheImages ? 1 : 0,
      nextOrder,
      JSON.stringify(body.accessPolicy || {}),
    ).run();
    return json({ success: true });
  }

  if (request.method === "DELETE") {
    const prefix = cleanPrefix(url.searchParams.get("prefix"));
    if (!prefix) return json({ success: false, error: "缺少 prefix" }, 400);
    await env.DB.prepare("DELETE FROM routes WHERE prefix = ?").bind(prefix).run();
    return json({ success: true });
  }

  return json({ success: false, error: "Method not allowed" }, 405);
}

async function handleImportRoutes(request, env) {
  requireDb(env);
  await ensureSchema(env.DB);
  const body = await readJson(request);
  const routes = Array.isArray(body) ? body : body.routes;
  if (!Array.isArray(routes)) return json({ success: false, error: "导入内容必须是数组" }, 400);

  const statements = [];
  routes.forEach((item, index) => {
    const route = normalizeRoute(item);
    if (!route.prefix || !route.target) return;
    statements.push(
      env.DB.prepare(`
        INSERT INTO routes(prefix, target, mode, remark, icon, cacheImages, order_idx, access_policy)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(prefix) DO UPDATE SET
          target = excluded.target,
          mode = excluded.mode,
          remark = excluded.remark,
          icon = excluded.icon,
          cacheImages = excluded.cacheImages,
          order_idx = excluded.order_idx,
          access_policy = excluded.access_policy
      `).bind(
        route.prefix,
        route.target,
        route.mode || DEFAULT_MODE,
        route.remark || "",
        route.icon || "",
        route.cacheImages ? 1 : 0,
        index,
        JSON.stringify(route.accessPolicy || {}),
      ),
    );
  });
  if (statements.length) await env.DB.batch(statements);
  return json({ success: true, imported: statements.length });
}

async function handleReorderRoutes(request, env) {
  requireDb(env);
  await ensureSchema(env.DB);
  const prefixes = await readJson(request);
  if (!Array.isArray(prefixes)) return json({ success: false, error: "排序内容必须是数组" }, 400);
  const batch = prefixes.map((prefix, index) =>
    env.DB.prepare("UPDATE routes SET order_idx = ? WHERE prefix = ?").bind(index, cleanPrefix(prefix)),
  );
  if (batch.length) await env.DB.batch(batch);
  return json({ success: true });
}

async function handleStatsApi(env) {
  requireDb(env);
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(`
    SELECT prefix, SUM(count) AS totalReqs, MAX(date) AS lastDate
    FROM request_stats
    GROUP BY prefix
    ORDER BY totalReqs DESC
  `).all();
  return json({ success: true, result: rows.results || [] });
}

async function handleAppearanceSettingsApi(request, env) {
  requireDb(env);
  await ensureSchema(env.DB);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, updated_at FROM settings WHERE key = ?").bind(APPEARANCE_SETTING_KEY).first();
    let appearance;
    try {
      appearance = normalizeAppearanceSetting(safeJson(row?.value, DEFAULT_APPEARANCE), false);
    } catch {
      appearance = DEFAULT_APPEARANCE;
    }
    return json({ success: true, appearance: { ...appearance, updatedAt: row?.updated_at || "" } });
  }

  if (request.method === "POST") {
    const body = await readJson(request);
    let appearance;
    try {
      appearance = normalizeAppearanceSetting(body, true);
    } catch (error) {
      return json({ success: false, error: error.message || "外观配置无效" }, 400);
    }
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).bind(APPEARANCE_SETTING_KEY, JSON.stringify(appearance), updatedAt).run();
    return json({ success: true, appearance: { ...appearance, updatedAt } });
  }

  return json({ success: false, error: "Method not allowed" }, 405);
}

function normalizeAppearanceSetting(input = {}, strict = false) {
  const backgroundUrl = String(input.backgroundUrl || input.bgUrl || "").trim();
  if (backgroundUrl.length > 2048) throw new Error("背景 URL 太长，请使用图床直链或随机图 API 地址");
  if (backgroundUrl) {
    let parsed;
    try {
      parsed = new URL(backgroundUrl);
    } catch {
      throw new Error("背景 URL 格式不正确");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("背景只保存 http/https 图片或随机图 API URL，不保存图片文件本体");
    }
  }

  const opacity = Number(input.backgroundOpacity ?? input.opacity ?? DEFAULT_APPEARANCE.backgroundOpacity);
  if (!Number.isFinite(opacity)) {
    if (strict) throw new Error("背景可见度必须是数字");
    return { ...DEFAULT_APPEARANCE, backgroundUrl };
  }
  const backgroundOpacity = Math.max(0, Math.min(70, Math.round(opacity)));
  return { backgroundUrl, backgroundOpacity };
}

async function proxyByRoute(request, env, ctx) {
  const url = new URL(request.url);
  const decodedPath = safeDecodePath(url.pathname);

  if (decodedPath.startsWith("/http://") || decodedPath.startsWith("/https://")) {
    return proxyToTargets({
      request,
      env,
      ctx,
      targets: [decodedPath.slice(1)],
      restPath: "",
      route: fallbackRoute(env),
      prefix: "",
    });
  }

  const parts = decodedPath.split("/").filter(Boolean);
  const prefix = cleanPrefix(parts[0]);
  const restPath = "/" + parts.slice(1).join("/");

  let route = null;
  if (prefix && env.DB) {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare("SELECT * FROM routes WHERE prefix = ?").bind(prefix).first();
    if (row) route = normalizeRoute(row);
  }

  if (!route && env.DEFAULT_TARGET) {
    route = fallbackRoute(env);
    route.target = env.DEFAULT_TARGET;
    return proxyToTargets({ request, env, ctx, targets: splitTargets(route.target), restPath: decodedPath, route, prefix: "" });
  }

  if (!route) {
    return new Response("404: route not found", { status: 404 });
  }

  const browserMode = route.accessPolicy?.browserMode || getEnvBrowserMode(env);
  if (isBrowserRequest(request) && browserMode !== "proxy" && request.method === "GET") {
    if (browserMode === "block") return new Response("Please use an Emby client.", { status: 403 });
    const delay = await measureDelay(splitTargets(route.target)[0]);
    return html(statusPage({
      request,
      route,
      prefix,
      delay,
      clients: CLIENTS,
    }));
  }

  return proxyToTargets({
    request,
    env,
    ctx,
    targets: splitTargets(route.target),
    restPath,
    route,
    prefix,
  });
}

async function proxyToTargets({ request, env, ctx, targets, restPath, route, prefix }) {
  const requestUrl = new URL(request.url);
  const pathAndQuery = normalizeRestPath(restPath) + requestUrl.search;
  const method = request.method.toUpperCase();
  const bodyBuffer = method !== "GET" && method !== "HEAD" && targets.length > 1
    ? await request.clone().arrayBuffer()
    : null;

  if (!targets.length) return new Response("404: target empty", { status: 404 });

  if (isPlaybackRequest(requestUrl.pathname) && prefix && env.DB && ctx?.waitUntil) {
    ctx.waitUntil(recordPlayback(env.DB, prefix));
  }

  let upstreamResponse = null;
  let upstreamUrl = null;
  let lastError = null;

  for (const target of targets) {
    try {
      const targetUrl = new URL(stripTrailingSlash(target) + pathAndQuery);
      const headers = buildProxyHeaders(request, targetUrl, route.mode);
      const init = {
        method,
        headers,
        redirect: "manual",
      };
      if (route.cacheImages && method === "GET" && isCacheableAsset(targetUrl.pathname)) {
        init.cf = { cacheEverything: true, cacheTtl: 86400 };
      }
      if (method !== "GET" && method !== "HEAD") {
        if (bodyBuffer) {
          init.body = bodyBuffer;
        } else {
          init.body = request.body;
          init.duplex = "half";
        }
      }

      const response = await fetch(new Request(targetUrl, init));
      if ([502, 503, 504].includes(response.status) && targets.length > 1) {
        lastError = new Error(`upstream ${targetUrl.origin} returned ${response.status}`);
        continue;
      }
      upstreamResponse = response;
      upstreamUrl = targetUrl;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!upstreamResponse || !upstreamUrl) {
    return new Response(`Proxy upstream failed: ${lastError?.message || "unknown error"}`, { status: 502 });
  }

  return rewriteResponse({
    request,
    response: upstreamResponse,
    upstreamUrl,
    route,
    prefix,
  });
}

function buildProxyHeaders(request, targetUrl, mode) {
  const headers = new Headers(request.headers);
  headers.set("Host", targetUrl.host);
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("cf-visitor");
  headers.delete("cdn-loop");
  headers.delete("x-forwarded-for");
  headers.delete("x-real-ip");

  const clientIp = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  if (mode === "real-ip" && clientIp) {
    headers.set("X-Real-IP", clientIp);
    headers.set("X-Forwarded-For", clientIp);
  }

  if (mode === "origin") {
    headers.set("Origin", targetUrl.origin);
    headers.set("Referer", targetUrl.origin + "/");
    headers.delete("X-Forwarded-Proto");
    headers.delete("X-Forwarded-Host");
  }

  return headers;
}

async function rewriteResponse({ request, response, upstreamUrl, route, prefix }) {
  const requestUrl = new URL(request.url);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  headers.set("Access-Control-Allow-Headers", "*");

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = headers.get("Location");
    if (location) {
      headers.set("Location", rewriteLocation(location, requestUrl.origin, upstreamUrl.origin, prefix));
    }
  }

  const contentType = headers.get("Content-Type") || "";
  const routeRoot = prefix ? `${requestUrl.origin}/${prefix}` : requestUrl.origin;

  if (response.status === 200 && contentType.includes("application/json")) {
    try {
      const data = await response.clone().json();
      const rewritten = rewriteJsonUrls(data, routeRoot, upstreamUrl.origin);
      headers.delete("Content-Length");
      return new Response(JSON.stringify(rewritten), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // Fall through to the original body if it is not valid JSON.
    }
  }

  if (response.status === 200 && isPlaylistRequest(requestUrl.pathname, contentType)) {
    try {
      const text = await response.clone().text();
      headers.delete("Content-Length");
      return new Response(rewritePlaylist(text, routeRoot, upstreamUrl), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // Fall through to the original body.
    }
  }

  if (route.cacheImages && isCacheableAsset(requestUrl.pathname)) {
    headers.set("Cache-Control", "public, max-age=86400");
    headers.delete("Set-Cookie");
    headers.delete("Vary");
  } else {
    headers.set("Cache-Control", "no-store");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rewriteJsonUrls(value, routeRoot, upstreamOrigin) {
  if (Array.isArray(value)) return value.map((item) => rewriteJsonUrls(item, routeRoot, upstreamOrigin));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return rewriteUrlString(value, routeRoot, upstreamOrigin);
    return value;
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      output[key] = rewriteUrlString(item, routeRoot, upstreamOrigin);
    } else {
      output[key] = rewriteJsonUrls(item, routeRoot, upstreamOrigin);
    }
  }
  return output;
}

function rewriteUrlString(value, routeRoot, upstreamOrigin) {
  if (!value) return value;
  if (value.startsWith(upstreamOrigin)) {
    return routeRoot + value.slice(upstreamOrigin.length);
  }
  if (value.startsWith("/")) {
    return routeRoot + value;
  }
  if (/^https?:\/\//i.test(value) && isLikelyMediaUrl(value)) {
    return `${new URL(routeRoot).origin}/proxy-stream/${base64UrlEncode(value)}`;
  }
  return value;
}

function rewritePlaylist(text, routeRoot, upstreamUrl) {
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    if (/^https?:\/\//i.test(trimmed)) {
      if (trimmed.startsWith(upstreamUrl.origin)) return routeRoot + trimmed.slice(upstreamUrl.origin.length);
      return `${new URL(routeRoot).origin}/proxy-stream/${base64UrlEncode(trimmed)}`;
    }
    if (trimmed.startsWith("/")) return routeRoot + trimmed;
    const absolute = new URL(trimmed, upstreamUrl).toString();
    return `${new URL(routeRoot).origin}/proxy-stream/${base64UrlEncode(absolute)}`;
  }).join("\n");
}

async function handleStreamProxy(request) {
  const url = new URL(request.url);
  const encoded = url.pathname.slice("/proxy-stream/".length);
  const target = encoded ? base64UrlDecode(encoded) : url.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response("Invalid stream request", { status: 400 });
  }

  const targetUrl = new URL(target);
  const headers = new Headers(request.headers);
  headers.set("Host", targetUrl.host);
  headers.delete("X-Forwarded-For");
  headers.delete("X-Real-IP");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  headers.delete("cf-ray");
  headers.delete("Origin");
  headers.delete("Referer");

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    redirect: "follow",
  });
  const resHeaders = new Headers(response.headers);
  resHeaders.set("Access-Control-Allow-Origin", "*");
  resHeaders.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  resHeaders.set("Access-Control-Allow-Headers", "*");
  resHeaders.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges");
  if ((resHeaders.get("Content-Type") || "").match(/video|audio|mpegurl|octet-stream/i)) {
    resHeaders.set("Cache-Control", "public, max-age=86400");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: resHeaders,
  });
}

async function handleFetchIps(sourceUrl) {
  if (!sourceUrl) return json({ success: false, error: "缺少 url" }, 400);
  const response = await fetch(sourceUrl, { headers: { "User-Agent": "Mozilla/5.0 CF-Emby-Proxy" } });
  const text = await response.text();
  const ips = extractIps(text).slice(0, 50);
  return json({ success: true, ips: shuffle(ips).slice(0, 20), totalCount: ips.length });
}

async function handleRemoteIps(type) {
  const key = String(type || "all").toLowerCase();
  const collected = new Set();

  if (["all", "proxyip", "电信", "联通", "移动", "多线", "ipv6"].includes(key)) {
    await collectIpsFromUrl(IP_SOURCE_URLS.proxyip, collected, key);
  }
  if (["all", "best", "优选"].includes(key)) {
    await collectIpsFromUrl(IP_SOURCE_URLS.bestcf, collected, key);
  }

  const ips = shuffle(Array.from(collected)).slice(0, 20);
  return json({ success: true, ips, totalCount: collected.size });
}

async function collectIpsFromUrl(url, output, type) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 CF-Emby-Proxy" } });
    if (!response.ok) return;
    const text = (await response.text()).replace(/<[^>]+>/g, " ");
    const loweredType = String(type || "").toLowerCase();
    const tagged = /(电信|联通|移动|多线|ipv6)\s+((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-fA-F0-9]{1,4}:)+[a-fA-F0-9]{1,4})/gi;
    let match;
    while ((match = tagged.exec(text))) {
      const tag = match[1].toLowerCase();
      if (["all", "proxyip"].includes(loweredType) || loweredType === tag) {
        output.add(wrapIpv6(match[2]));
      }
    }
    if (!output.size || ["all", "best", "优选"].includes(loweredType)) {
      extractIps(text).forEach((ip) => output.add(ip));
    }
  } catch {
    // Remote IP feeds are best-effort.
  }
}

function extractIps(text) {
  const output = new Set();
  const ipv4 = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
  const ipv6 = /(?:[a-fA-F0-9]{1,4}:){2,}[a-fA-F0-9]{1,4}/g;
  for (const ip of text.match(ipv4) || []) {
    if (!isPrivateIpv4(ip)) output.add(ip);
  }
  for (const ip of text.match(ipv6) || []) {
    if (ip.length > 7) output.add(wrapIpv6(ip));
  }
  return Array.from(output);
}

async function handleDnsStatus(env) {
  const dns = getDnsEnv(env);
  if (!dns.ok) return json({ success: false, error: dns.error }, 400);
  const response = await cfApi(env, `/zones/${dns.zoneId}/dns_records?name=${encodeURIComponent(dns.domain)}`);
  const data = await response.json();
  return json({ success: data.success, result: data.result || [], errors: data.errors || [] }, response.ok ? 200 : 502);
}

async function handleDnsPreview(request, env) {
  const dns = getDnsEnv(env);
  if (!dns.ok) return json({ success: false, error: dns.error }, 400);
  const body = await readJson(request);
  const ips = normalizeDnsInputs(body.ips);
  if (!ips.length) return json({ success: false, error: "请选择至少一个 IP 或域名" }, 400);
  const proxied = body.proxied === undefined ? false : Boolean(body.proxied);
  let plan;
  try {
    plan = await buildDnsPlan(env, dns, ips, proxied);
  } catch (error) {
    return json({ success: false, error: error.message || "获取 DNS 预览失败" }, 502);
  }
  return json({ success: true, domain: dns.domain, proxied, ...plan });
}

async function handleDnsUpdate(request, env) {
  const dns = getDnsEnv(env);
  if (!dns.ok) return json({ success: false, error: dns.error }, 400);
  const body = await readJson(request);
  const ips = normalizeDnsInputs(body.ips);
  if (!ips.length) return json({ success: false, error: "请选择至少一个 IP 或域名" }, 400);
  const proxied = body.proxied === undefined ? false : Boolean(body.proxied);
  let plan;
  try {
    plan = await buildDnsPlan(env, dns, ips, proxied);
  } catch (error) {
    return json({ success: false, error: error.message || "获取现有 DNS 记录失败" }, 502);
  }

  for (const record of plan.toDelete) {
    await cfApi(env, `/zones/${dns.zoneId}/dns_records/${record.id}`, { method: "DELETE" });
  }

  const created = [];
  for (const record of plan.toCreate) {
    const createResponse = await cfApi(env, `/zones/${dns.zoneId}/dns_records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: record.type,
        name: dns.domain,
        content: record.content,
        ttl: 60,
        proxied,
      }),
    });
    const createData = await createResponse.json();
    if (!createData.success) {
      return json({ success: false, error: `${record.content} 提交失败`, detail: createData.errors }, 502);
    }
    created.push(createData.result);
  }

  return json({
    success: true,
    message: `${dns.domain} 已指向选定的 ${created.length} 条记录`,
    deleted: plan.toDelete.length,
    result: created,
  });
}

async function buildDnsPlan(env, dns, ips, proxied) {
  const listResponse = await cfApi(env, `/zones/${dns.zoneId}/dns_records?name=${encodeURIComponent(dns.domain)}`);
  const listData = await listResponse.json();
  if (!listData.success) {
    const detail = Array.isArray(listData.errors) ? listData.errors.map((item) => item.message || item.code || String(item)).join("; ") : "";
    throw new Error(detail ? `获取现有 DNS 记录失败: ${detail}` : "获取现有 DNS 记录失败");
  }

  const existing = (listData.result || []).map(normalizeDnsRecord);
  const replaceTypes = ["A", "AAAA", "CNAME"];
  const toDelete = existing.filter((record) => replaceTypes.includes(record.type));
  const toKeep = existing.filter((record) => !replaceTypes.includes(record.type));
  const toCreate = ips.map((content) => ({
    type: getDnsRecordType(content),
    name: dns.domain,
    content,
    ttl: 60,
    proxied,
  }));

  return { existing, toDelete, toKeep, toCreate };
}

function normalizeDnsInputs(value) {
  const list = Array.isArray(value) ? value : [];
  return Array.from(new Set(list.map(normalizeDnsContent).filter(Boolean)));
}

function normalizeDnsRecord(record) {
  return {
    id: record.id || "",
    type: record.type || "",
    name: record.name || "",
    content: record.content || "",
    proxied: Boolean(record.proxied),
    ttl: record.ttl || 1,
  };
}

async function cfApi(env, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.CF_API_TOKEN}`);
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers,
  });
}

function getDnsEnv(env) {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID || !env.CF_DOMAIN) {
    return { ok: false, error: "缺少 CF_API_TOKEN, CF_ZONE_ID, CF_DOMAIN 变量" };
  }
  return { ok: true, zoneId: env.CF_ZONE_ID, domain: env.CF_DOMAIN };
}

async function ensureSchema(db) {
  await db.exec(`
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
  `);

  const migrations = [
    "ALTER TABLE routes ADD COLUMN mode TEXT DEFAULT 'clean'",
    "ALTER TABLE routes ADD COLUMN remark TEXT DEFAULT ''",
    "ALTER TABLE routes ADD COLUMN icon TEXT DEFAULT ''",
    "ALTER TABLE routes ADD COLUMN last_play TEXT DEFAULT ''",
    "ALTER TABLE routes ADD COLUMN cacheImages INTEGER DEFAULT 1",
    "ALTER TABLE routes ADD COLUMN order_idx INTEGER DEFAULT 0",
    "ALTER TABLE routes ADD COLUMN access_policy TEXT DEFAULT '{}'",
  ];

  for (const sql of migrations) {
    try {
      await db.exec(sql);
    } catch {
      // Existing columns are fine.
    }
  }
}

async function recordPlayback(db, prefix) {
  try {
    await ensureSchema(db);
    const day = today();
    const time = new Date(Date.now() + 8 * 3600000).toISOString().replace("T", " ").split(".")[0];
    await db.batch([
      db.prepare(`
        INSERT INTO request_stats(prefix, date, count)
        VALUES(?, ?, 1)
        ON CONFLICT(prefix, date) DO UPDATE SET count = count + 1
      `).bind(prefix, day),
      db.prepare("UPDATE routes SET last_play = ? WHERE prefix = ?").bind(time, prefix),
    ]);
  } catch {
    // Stats must never break playback.
  }
}

function panelPage(env) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emby Proxy Panel</title>
<style>
:root{--bg:#eef3f7;--panel:rgba(255,255,255,.62);--panel-strong:rgba(255,255,255,.78);--ink:#1d2430;--muted:#657284;--line:rgba(255,255,255,.58);--line-strong:rgba(118,136,158,.28);--blue:#2563eb;--green:#14804a;--red:#d12b2b;--orange:#c26a16;--shadow:0 24px 70px rgba(31,45,61,.14);--inner:inset 0 1px 0 rgba(255,255,255,.68)}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(135deg,#edf4f8 0,#f6f1e6 48%,#e8f3ed 100%);background-attachment:fixed;color:var(--ink);font-family:"Segoe UI","Microsoft YaHei",sans-serif}body::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.22) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.22) 1px,transparent 1px);background-size:56px 56px;opacity:.45}.wrap{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:24px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;padding:18px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(135deg,rgba(255,255,255,.74),rgba(255,255,255,.44));box-shadow:var(--shadow),var(--inner);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%)}.title h1{margin:0;font-size:28px}.title p{margin:6px 0 0;color:var(--muted)}.grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(360px,.8fr);gap:18px}.card{background:linear-gradient(135deg,rgba(255,255,255,.7),rgba(255,255,255,.48));border:1px solid var(--line);box-shadow:var(--shadow),var(--inner);backdrop-filter:blur(18px) saturate(145%);-webkit-backdrop-filter:blur(18px) saturate(145%);border-radius:8px;padding:18px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.btn{border:1px solid var(--line-strong);background:rgba(255,255,255,.72);color:var(--ink);border-radius:7px;padding:10px 13px;font-weight:700;cursor:pointer;box-shadow:0 8px 22px rgba(31,45,61,.07);transition:border-color .18s,background .18s,box-shadow .18s,transform .18s}.btn:hover{border-color:rgba(37,99,235,.45);background:rgba(255,255,255,.9);box-shadow:0 12px 28px rgba(31,45,61,.11);transform:translateY(-1px)}.btn:disabled{opacity:.55;cursor:not-allowed;transform:none}.primary{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border-color:rgba(37,99,235,.5)}.danger{color:var(--red);border-color:rgba(209,43,43,.28);background:rgba(255,245,245,.72)}.green{color:var(--green);border-color:rgba(20,128,74,.3);background:rgba(241,252,246,.72)}.muted{color:var(--muted)}input,select,textarea{width:100%;border:1px solid var(--line-strong);border-radius:7px;background:rgba(255,255,255,.76);padding:10px 12px;font:inherit;color:var(--ink);box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}input:focus,select:focus,textarea:focus{outline:2px solid rgba(37,99,235,.18);border-color:rgba(37,99,235,.55);background:rgba(255,255,255,.94)}textarea{min-height:76px;resize:vertical}.field{margin-bottom:12px}.field label{display:block;font-size:13px;font-weight:700;color:var(--muted);margin-bottom:6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.routes{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}.route{border:1px solid var(--line);border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.82),rgba(255,255,255,.58));box-shadow:0 14px 32px rgba(31,45,61,.08),var(--inner);padding:14px;display:flex;flex-direction:column;gap:11px}.route-head{display:flex;justify-content:space-between;gap:10px}.prefix{font-size:20px;font-weight:800}.badge{display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:999px;padding:3px 8px;font-size:12px;color:var(--muted);background:rgba(255,255,255,.62);box-shadow:inset 0 1px 0 rgba(255,255,255,.6)}.target{font-family:Consolas,monospace;font-size:12px;word-break:break-all;color:#334155}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}.ip-list{display:grid;gap:8px;max-height:280px;overflow:auto}.ip-item{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:7px;padding:9px;background:rgba(255,255,255,.66);box-shadow:var(--inner)}.ip-item code{font-size:13px}.toast{position:fixed;left:50%;top:-80px;transform:translateX(-50%);background:rgba(29,36,48,.92);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:12px 18px;transition:.25s;z-index:10;box-shadow:0 18px 40px rgba(31,45,61,.22);backdrop-filter:blur(14px)}.toast.show{top:18px}.empty{border:1px dashed var(--line-strong);border-radius:8px;padding:26px;text-align:center;color:var(--muted);background:rgba(255,255,255,.38)}.footer{position:relative;z-index:1;margin-top:18px;color:var(--muted);font-size:13px}.split{display:flex;align-items:center;justify-content:space-between;gap:12px}.switch{display:flex;gap:8px;align-items:center}.switch input{width:auto}.small{font-size:12px}.status-line{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.doctor{margin-bottom:18px}.doctor-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:12px}.doctor-item{min-width:0;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.64);box-shadow:var(--inner);padding:11px;display:grid;grid-template-columns:70px 1fr;gap:10px;align-items:start}.doctor-item.pass{border-color:rgba(20,128,74,.28)}.doctor-item.warn,.doctor-item.info{border-color:rgba(194,106,22,.28)}.doctor-item.fail{border-color:rgba(209,43,43,.3)}.doctor-level{font-weight:800;font-size:12px;text-transform:uppercase}.doctor-item.pass .doctor-level{color:var(--green)}.doctor-item.warn .doctor-level{color:var(--orange)}.doctor-item.info .doctor-level{color:var(--muted)}.doctor-item.fail .doctor-level{color:var(--red)}.doctor-message{overflow-wrap:anywhere}.doctor-action{margin-top:4px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.wizard{margin-bottom:18px}.wizard[hidden]{display:none}.wizard-grid{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(320px,1.2fr);gap:14px;margin-top:12px}.wizard-steps{display:grid;gap:8px}.wizard-step{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.64);box-shadow:var(--inner);padding:10px;display:flex;justify-content:space-between;gap:10px;align-items:center}.wizard-step strong{overflow-wrap:anywhere}.wizard-form{display:grid;gap:10px}.wizard-form .row{align-items:end}
.wizard-step{display:grid;grid-template-columns:1fr auto;gap:6px 10px;justify-content:normal}
.dns-preview{display:grid;gap:8px;margin:8px 0 12px}.dns-preview[hidden]{display:none}.dns-plan{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.62);box-shadow:var(--inner);padding:10px}.dns-plan h3{font-size:14px;margin:0 0 8px}.dns-records{display:grid;gap:6px}.dns-record{display:grid;grid-template-columns:64px 1fr;gap:8px;align-items:center;font-size:12px}.dns-record code{word-break:break-all}
.version-card{margin-bottom:18px}
.access-card{margin-bottom:18px}.access-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.snapshot-card{margin-bottom:18px}
.stats{margin-bottom:18px}.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}.stat-box{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.6);box-shadow:var(--inner);padding:12px}.stat-value{font-size:26px;font-weight:800;color:#172033}.stat-list{display:grid;gap:7px}.stat-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:7px;padding:8px;background:rgba(255,255,255,.58);box-shadow:var(--inner)}
.quick-card{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.56);box-shadow:var(--inner);padding:12px;margin:0 0 14px}.quick-card h3{font-size:16px;margin:0 0 6px}.quick-result{border:1px dashed rgba(37,99,235,.35);border-radius:8px;background:rgba(239,246,255,.62);padding:10px;margin-top:10px}.quick-url{display:block;margin:6px 0 10px;font-family:Consolas,monospace;font-size:13px;word-break:break-all;color:#1d4ed8}.route{position:relative;transition:transform .18s,box-shadow .18s,opacity .18s}.routes.dragging .route{cursor:grabbing}.route.dragging{opacity:.55;transform:scale(.985)}.route.drag-before::before,.route.drag-after::after{content:"";position:absolute;left:12px;right:12px;height:3px;border-radius:999px;background:#2563eb;box-shadow:0 0 0 4px rgba(37,99,235,.13)}.route.drag-before::before{top:-8px}.route.drag-after::after{bottom:-8px}.prefix-row{display:flex;align-items:center;gap:8px}.drag-handle{display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line-strong);border-radius:7px;background:rgba(255,255,255,.68);color:var(--muted);cursor:grab;user-select:none;font-weight:800}.route.dragging .drag-handle{cursor:grabbing}
body::after{content:"";position:fixed;inset:0;pointer-events:none;background-image:var(--custom-bg);background-size:cover;background-position:center;background-repeat:no-repeat;opacity:var(--custom-bg-opacity,0);filter:saturate(1.1) contrast(1.02);transition:opacity .25s;z-index:0}.appearance-card{position:relative;overflow:hidden}.appearance-card::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(37,99,235,.08),rgba(20,128,74,.06));pointer-events:none}.appearance-card>*{position:relative}.bg-preview{height:78px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(135deg,#edf4f8,#f6f1e6);background-image:var(--custom-bg);background-size:cover;background-position:center;box-shadow:var(--inner);margin-top:10px}.range-row{display:grid;grid-template-columns:1fr 54px;gap:10px;align-items:center}.range-row input{padding:0}.route-placeholder{border:1px dashed rgba(37,99,235,.5);border-radius:8px;background:rgba(37,99,235,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.45);min-height:112px}.route.drag-source{display:none}.route-drag-ghost{position:fixed;left:0;top:0;z-index:30;pointer-events:none;margin:0;box-shadow:0 28px 68px rgba(31,45,61,.22),var(--inner);transform:translate3d(0,0,0) rotate(.2deg);opacity:.96;will-change:transform}.routes.dragging{user-select:none}.routes.dragging .route:not(.drag-source){transition:transform .12s,box-shadow .12s}
@media(max-width:900px){.grid,.wizard-grid{grid-template-columns:1fr}.wrap{padding:14px}.top{flex-direction:column}.row{grid-template-columns:1fr}.routes{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="toast" class="toast"></div>
<main class="wrap">
  <section class="top">
    <div class="title">
      <h1>Emby 反代面板</h1>
      <p>路径分流、前后端分离、优选 IP、Cloudflare DNS 自动 A/AAAA/CNAME 记录。</p>
      <div class="status-line">
        <span class="badge">v${VERSION}</span>
        <span class="badge" id="dbBadge">D1 检测中</span>
        <span class="badge" id="dnsBadge">DNS 检测中</span>
      </div>
    </div>
    <button class="btn" onclick="logout()">退出登录</button>
  </section>
  <section class="card doctor" id="doctorCard">
    <div class="split">
      <div>
        <strong>部署自检</strong>
        <p class="small muted" id="doctorSummary">正在检查 D1、DNS、默认上游和安全设置。</p>
      </div>
      <div class="toolbar" style="margin:0">
        <button class="btn" onclick="copyDoctorReport()">复制报告</button>
        <button class="btn" onclick="loadDoctor()">重新检查</button>
      </div>
    </div>
    <div id="doctorList" class="doctor-list"></div>
  </section>
  <section class="card version-card" id="versionCard">
    <div class="split">
      <div>
        <strong>项目版本</strong>
        <p class="small muted" id="versionSummary">正在检查 GitHub 最新版本。</p>
      </div>
      <button class="btn" onclick="loadVersionCheck()">检查更新</button>
    </div>
    <div id="versionInfo" class="status-line"></div>
  </section>
  <section class="card access-card" id="accessCard">
    <div class="split">
      <div>
        <strong>访问控制</strong>
        <p class="small muted" id="accessSummary">读取全局访问控制和浏览器访问模式。</p>
      </div>
    </div>
    <div id="accessGrid" class="stat-grid"></div>
  </section>
  <section class="card snapshot-card" id="snapshotCard">
    <div class="split">
      <div>
        <strong>运维快照</strong>
        <p class="small muted" id="snapshotSummary">汇总面板保护、D1、DNS、路由和统计状态。</p>
      </div>
      <button class="btn" onclick="copySnapshot()">复制快照</button>
    </div>
    <div id="snapshotGrid" class="stat-grid"></div>
  </section>
  <section class="card wizard" id="wizardCard" hidden>
    <div class="split">
      <div>
        <strong>首次使用向导</strong>
        <p class="small muted" id="wizardSummary">添加第一条 Emby 路由后，客户端就可以使用 /路径 访问。</p>
      </div>
      <button class="btn" onclick="dismissWizard()">稍后处理</button>
    </div>
    <div class="wizard-grid">
      <div id="wizardSteps" class="wizard-steps"></div>
      <form class="wizard-form" onsubmit="saveWizardRoute(event)">
        <div class="row">
          <div class="field"><label>入口路径</label><input id="wizardPrefix" value="emby" placeholder="emby"></div>
          <div class="field"><label>模式</label><select id="wizardMode"><option value="clean">clean</option><option value="origin">origin</option><option value="real-ip">real-ip</option><option value="direct">direct</option></select></div>
        </div>
        <div class="field"><label>Emby 上游</label><input id="wizardTarget" placeholder="https://emby.example.com:443"></div>
        <div class="split">
          <span class="small muted" id="wizardHint">推荐先用 clean；前后端分离再试 origin。</span>
          <button class="btn primary" id="wizardSave" type="submit">保存第一条路由</button>
        </div>
      </form>
    </div>
  </section>
  <section class="card stats" id="statsCard">
    <div class="split">
      <div>
        <strong>播放统计</strong>
        <p class="small muted" id="statsSummary">正在读取播放统计。</p>
      </div>
      <button class="btn" onclick="loadStats()">刷新统计</button>
    </div>
    <div id="statsGrid" class="stat-grid"></div>
  </section>
  <section class="grid">
    <div class="card">
      <div class="toolbar">
        <button class="btn primary" onclick="newRoute()">新增路径</button>
        <button class="btn" onclick="loadRoutes()">刷新</button>
        <button class="btn" onclick="pingAllRoutes()">测试全部</button>
        <button class="btn" onclick="exportRoutes()">导出配置</button>
        <button class="btn" onclick="pickImportFile()">导入配置</button>
        <input id="importFile" type="file" accept="application/json,.json" onchange="importRoutesFile(event)" hidden>
        <input id="search" placeholder="搜索路径/备注/上游" oninput="renderRoutes()" style="max-width:260px">
      </div>
      <div id="routes" class="routes"></div>
    </div>
    <aside class="card">
      <h2 style="margin-top:0">配置</h2>
      <section class="quick-card">
        <h3>小白生成器</h3>
        <p class="small muted">填原 Emby 地址和入口路径，自动生成客户端要填写的反代后地址。</p>
        <div class="field"><label>Emby 原地址</label><input id="quickTarget" placeholder="https://emby.example.com:443"></div>
        <div class="row">
          <div class="field"><label>入口路径</label><input id="quickPrefix" value="emby" placeholder="emby" oninput="updateQuickProxyUrl()"></div>
          <div class="field"><label>推荐模式</label><select id="quickMode"><option value="clean">clean</option><option value="origin">origin 前后端分离</option><option value="real-ip">real-ip</option><option value="direct">direct</option></select></div>
        </div>
        <div class="toolbar" style="margin-bottom:0">
          <button class="btn primary" type="button" onclick="generateBeginnerRoute()">生成并填入</button>
          <button class="btn" type="button" onclick="copyQuickProxyUrl()">复制反代地址</button>
        </div>
        <div class="quick-result" id="quickResult" hidden>
          <div class="small muted">反代后地址</div>
          <code class="quick-url" id="quickProxyUrl"></code>
          <div class="small muted">确认无误后，点下面的“保存路径”。</div>
        </div>
      </section>
      <section class="quick-card appearance-card">
        <h3>外观背景</h3>
        <p class="small muted">支持图床直链或随机图 API，配置会保存到 D1 的 settings 表。</p>
        <div class="field"><label>背景图片 / 图床 API URL</label><input id="bgUrl" placeholder="https://example.com/background.jpg"></div>
        <div class="field"><label>背景可见度</label><div class="range-row"><input id="bgOpacity" type="range" min="0" max="70" value="28" oninput="previewBackgroundOpacity()"><span class="badge" id="bgOpacityLabel">28%</span></div></div>
        <div class="toolbar" style="margin-bottom:0">
          <button class="btn primary" type="button" onclick="applyBackground()">应用背景</button>
          <button class="btn" type="button" onclick="refreshBackground()">刷新随机图</button>
          <button class="btn" type="button" onclick="resetBackground()">恢复默认</button>
        </div>
        <div class="bg-preview" id="bgPreview"></div>
      </section>
      <form id="routeForm" onsubmit="saveRoute(event)">
        <input id="oldPrefix" type="hidden">
        <div class="row">
          <div class="field"><label>路径前缀</label><input id="prefix" placeholder="hk / jp / home" required></div>
          <div class="field"><label>图标</label><input id="icon" placeholder="🎬"></div>
        </div>
        <div class="field"><label>上游 Emby，可用逗号分隔做故障切换</label><textarea id="target" placeholder="https://emby.example.com:443" required></textarea></div>
        <div class="row">
          <div class="field"><label>反代模式</label><select id="mode"><option value="clean">clean 隐藏真实 IP</option><option value="real-ip">real-ip 传递客户端 IP</option><option value="origin">origin 前后端分离</option><option value="direct">direct 尽量保留请求头</option></select></div>
          <div class="field"><label>浏览器访问</label><select id="browserMode"><option value="proxy">proxy 直接反代</option><option value="status">status 显示状态页</option><option value="block">block 阻止浏览器</option></select></div>
        </div>
        <div class="field"><label>备注</label><input id="remark" placeholder="香港主线 / 家宽 / 备用节点"></div>
        <div class="split">
          <label class="switch"><input id="cacheImages" type="checkbox" checked> 缓存图片和静态资源</label>
          <button class="btn primary" type="submit">保存路径</button>
        </div>
      </form>
      <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
      <h2>优选 IP</h2>
      <div class="toolbar">
        <select id="ipType" style="max-width:150px"><option value="all">全部</option><option value="best">优选</option><option value="电信">电信</option><option value="联通">联通</option><option value="移动">移动</option><option value="ipv6">IPv6</option></select>
        <button class="btn" onclick="loadRemoteIps()">拉取</button>
        <button class="btn" onclick="pingSelected()">测速</button>
      </div>
      <div class="field"><label>自定义 IP 源 URL</label><input id="ipSource" placeholder="https://example.com/ips.json"></div>
      <div class="toolbar">
        <button class="btn" onclick="loadCustomIps()">解析自定义源</button>
        <button class="btn" onclick="previewDns()">预览 DNS</button>
        <button class="btn green" onclick="updateDns()">写入 CF DNS</button>
      </div>
      <div id="dnsPreview" class="dns-preview"></div>
      <div id="ipList" class="ip-list"></div>
      <p class="small muted">DNS 写入会删除目标域名已有 A/AAAA/CNAME，再创建你勾选的记录。</p>
    </aside>
  </section>
  <div class="footer">环境变量：ADMIN_TOKEN、CF_API_TOKEN、CF_ZONE_ID、CF_DOMAIN、DEFAULT_TARGET、BLOCKED_COUNTRIES、BLOCKED_CLIENTS、BROWSER_MODE。</div>
</main>
<script>
let routes = [];
let ips = [];
let envState = {};
let doctorState = null;
let versionState = null;
let routeHealth = {};
let statsState = [];
let routePointerDrag = null;
let wizardDismissed = false;
const $ = (id) => document.getElementById(id);
function toast(msg){ const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); }
async function api(path, init={}){
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers||{}) } });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if(!res.ok) throw new Error(data.error || data.message || data);
  return data;
}
async function loadDoctor(){
  const list = $("doctorList");
  const summary = $("doctorSummary");
  if(!list) return;
  list.innerHTML = '<div class="empty">正在检查部署状态...</div>';
  if(summary) summary.textContent = "正在检查 D1、DNS、默认上游和安全设置。";
  try {
    const data = await api("/api/doctor");
    doctorState = data;
    renderDoctor(data);
  } catch(e) {
    doctorState = null;
    if(summary) summary.textContent = "自检接口调用失败。";
    list.innerHTML = '<div class="doctor-item fail"><div class="doctor-level">fail</div><div class="doctor-message"><strong>Doctor API</strong><br>'+escapeHtml(e.message)+'</div></div>';
  }
}
function renderDoctor(data){
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const fail = checks.filter(x => x.status === "fail").length;
  const warn = checks.filter(x => x.status === "warn").length;
  const summary = $("doctorSummary");
  if(summary) {
    summary.textContent = fail ? ("发现 "+fail+" 个必须处理的问题。") : warn ? ("核心配置可用，还有 "+warn+" 个建议项。") : "核心配置看起来正常。";
  }
  $("doctorList").innerHTML = checks.length ? checks.map(doctorItem).join("") : '<div class="empty">没有返回检查结果。</div>';
}
function doctorItem(item){
  const status = ["pass","warn","fail","info"].includes(item.status) ? item.status : "info";
  return '<div class="doctor-item '+status+'"><div class="doctor-level">'+status+'</div><div class="doctor-message"><strong>'+escapeHtml(item.label || item.id || "Check")+'</strong><br>'+escapeHtml(item.message || "")+(item.action ? '<div class="doctor-action">'+escapeHtml(item.action)+'</div>' : '')+'</div></div>';
}
async function copyDoctorReport(){
  if(!doctorState) await loadDoctor();
  if(!doctorState) return toast("没有可复制的诊断报告");
  await navigator.clipboard.writeText(buildDoctorReport(doctorState));
  toast("诊断报告已复制");
}
function buildDoctorReport(data){
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const lines = [
    "CF Emby Proxy Panel Doctor Report",
    "Generated: "+new Date().toISOString(),
    "Page: "+location.origin,
    "Version: "+(data.version || ""),
    "Ready: "+(data.ready ? "yes" : "no"),
    "CheckedAt: "+(data.checkedAt || ""),
    "D1 binding: "+(envState.hasDb ? "yes" : "no"),
    "DNS env: "+(envState.hasDnsEnv ? "yes" : "no"),
    "Browser mode: "+(envState.browserMode || ""),
    "Blocked countries: "+((envState.blockedCountries || []).join(", ") || "none"),
    "Blocked client keywords: "+(((envState.blockedClients || []).length || (envState.defaultBlockedClients || []).length)),
    "Route count: "+routes.length,
    "Latest commit: "+(versionState?.latestShortSha || "unknown"),
    "",
    "Checks:",
  ];
  for (const item of checks) {
    lines.push("- ["+(item.status || "info").toUpperCase()+"] "+(item.label || item.id || "Check")+": "+(item.message || ""));
    if(item.action) lines.push("  action: "+item.action);
  }
  return lines.join("\\n");
}
async function boot(){
  envState = await api("/api/env");
  await loadAppearance();
  $("dbBadge").textContent = envState.hasDb ? "D1 已绑定" : "D1 未绑定";
  $("dnsBadge").textContent = envState.hasDnsEnv ? "DNS 已配置: " + envState.cfDomain : "DNS 未配置";
  renderAccessControl();
  renderSnapshot();
  loadVersionCheck();
  await loadDoctor();
  await loadRoutes();
  await loadStats();
}
function renderAccessControl(){
  const grid = $("accessGrid");
  if(!grid) return;
  const countries = Array.isArray(envState.blockedCountries) ? envState.blockedCountries : [];
  const customClients = Array.isArray(envState.blockedClients) ? envState.blockedClients : [];
  const defaultClients = Array.isArray(envState.defaultBlockedClients) ? envState.defaultBlockedClients : [];
  const clientList = customClients.length ? customClients : defaultClients;
  $("accessSummary").textContent = countries.length || customClients.length
    ? "全局访问控制已配置；每条路由仍可单独设置浏览器访问模式。"
    : "当前使用默认脚本客户端关键词保护；每条路由可单独设置浏览器访问模式。";
  grid.innerHTML =
    accessBox("全局浏览器模式", envState.browserMode || "proxy", ["proxy","status","block"])+
    accessBox("阻止国家", countries.length ? countries.join(", ") : "未设置", countries)+
    accessBox("客户端关键词", clientList.length+" 个", clientList.slice(0, 12))+
    '<div class="stat-box" style="grid-column:1 / -1"><strong>路由级浏览器访问</strong><p class="small muted" style="margin-bottom:0">编辑路由时可选 proxy/status/block；路由级设置优先于全局 BROWSER_MODE。</p></div>';
  renderSnapshot();
}
function accessBox(label, value, chips){
  return '<div class="stat-box"><div class="small muted">'+escapeHtml(label)+'</div><div class="stat-value" style="font-size:20px">'+escapeHtml(value)+'</div><div class="access-list">'+(chips || []).map(item => '<span class="badge">'+escapeHtml(item)+'</span>').join("")+'</div></div>';
}
async function loadVersionCheck(){
  const summary = $("versionSummary");
  const info = $("versionInfo");
  if(!summary || !info) return;
  summary.textContent = "正在检查 GitHub 最新版本。";
  info.innerHTML = '<span class="badge">当前 '+escapeHtml(envState.version || "${VERSION}")+'</span><span class="badge">检查中</span>';
  try {
    const data = await api("/api/version-check");
    versionState = data;
    const stateText = data.upToDate === true ? "已是最新" : data.upToDate === false ? "可能有更新" : "已获取最新提交";
    summary.textContent = data.latestDate ? ("GitHub main 最新提交: "+new Date(data.latestDate).toLocaleString()) : stateText;
    info.innerHTML =
      '<span class="badge">当前 '+escapeHtml(data.version || "")+'</span>'+
      '<span class="badge">'+escapeHtml(stateText)+'</span>'+
      '<a class="badge" href="'+escapeAttr(data.latestUrl || data.repo || "#")+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(data.latestShortSha || "GitHub")+'</a>';
    renderSnapshot();
  } catch(e) {
    versionState = null;
    summary.textContent = "版本检查暂时不可用。";
    info.innerHTML = '<span class="badge">当前 '+escapeHtml(envState.version || "${VERSION}")+'</span><span class="badge">'+escapeHtml(e.message)+'</span>';
    renderSnapshot();
  }
}
async function loadStats(){
  const grid = $("statsGrid");
  const summary = $("statsSummary");
  if(!grid) return;
  grid.innerHTML = '<div class="empty">正在读取统计...</div>';
  try {
    const data = await api("/api/stats");
    statsState = data.result || [];
    renderStats(data.result || []);
  } catch(e) {
    statsState = [];
    if(summary) summary.textContent = "统计不可用。";
    grid.innerHTML = '<div class="empty">'+escapeHtml(e.message)+'</div>';
    renderSnapshot();
  }
}
function renderStats(rows){
  const list = Array.isArray(rows) ? rows : [];
  statsState = list;
  const total = list.reduce((sum, item) => sum + Number(item.totalReqs || 0), 0);
  const active = list.filter(item => Number(item.totalReqs || 0) > 0).length;
  const lastDate = list.map(item => item.lastDate || "").filter(Boolean).sort().pop() || "-";
  const top = list.slice(0, 5);
  $("statsSummary").textContent = total ? "累计播放请求 "+total+" 次，最近记录 "+lastDate+"。" : "还没有播放统计，客户端访问后会自动记录。";
  $("statsGrid").innerHTML =
    statBox("累计播放", total)+
    statBox("活跃路径", active)+
    statBox("路由数量", routes.length)+
    statBox("最近日期", lastDate)+
    '<div class="stat-box" style="grid-column:1 / -1"><strong>热门路径</strong><div class="stat-list" style="margin-top:10px">'+(top.length ? top.map(statRow).join("") : '<div class="small muted">暂无排行</div>')+'</div></div>';
  renderSnapshot();
}
function statBox(label, value){
  return '<div class="stat-box"><div class="small muted">'+escapeHtml(label)+'</div><div class="stat-value">'+escapeHtml(value)+'</div></div>';
}
function statRow(item){
  return '<div class="stat-row"><strong>/'+escapeHtml(item.prefix || "-")+'</strong><span class="badge">'+Number(item.totalReqs || 0)+' 次</span></div>';
}
async function loadRoutes(){
  try { routes = await api("/api/routes"); renderRoutes(); renderWizard(); renderSnapshot(); } catch(e){ routes = []; $("routes").innerHTML = '<div class="empty">'+e.message+'</div>'; renderWizard(e.message); renderSnapshot(); }
}
function renderRoutes(){
  const q = $("search").value.trim().toLowerCase();
  const list = routes.filter(r => !q || [r.prefix,r.target,r.remark,r.mode].join(" ").toLowerCase().includes(q));
  $("routes").innerHTML = list.length ? list.map(routeCard).join("") : '<div class="empty">还没有路径，先新增一个 /emby 或 /hk。</div>';
}
function renderWizard(errorMessage=""){
  const card = $("wizardCard");
  if(!card) return;
  const shouldShow = !wizardDismissed && (Boolean(errorMessage) || routes.length === 0);
  card.hidden = !shouldShow;
  if(!shouldShow) return;
  const dbOk = Boolean(envState.hasDb) && !errorMessage;
  const steps = [
    { label:"D1 数据库", status:dbOk ? "pass" : "fail", note:dbOk ? "DB 已就绪" : (errorMessage || "需要绑定 D1，变量名必须是 DB") },
    { label:"第一条路由", status:routes.length ? "pass" : "warn", note:routes.length ? "已创建 "+routes.length+" 条" : "填写右侧表单保存" },
    { label:"DNS 自动化", status:envState.hasDnsEnv ? "pass" : "info", note:envState.hasDnsEnv ? envState.cfDomain : "可选，不影响先添加路由" },
  ];
  $("wizardSteps").innerHTML = steps.map(wizardStep).join("");
  $("wizardSummary").textContent = dbOk ? "添加第一条 Emby 路由后，客户端就可以使用 /路径 访问。" : "先处理 D1，再保存第一条路由。";
  $("wizardSave").disabled = !dbOk;
}
function wizardStep(step){
  return '<div class="wizard-step '+step.status+'"><strong>'+escapeHtml(step.label)+'</strong><span class="badge">'+escapeHtml(step.status)+'</span><div class="small muted" style="grid-column:1 / -1">'+escapeHtml(step.note)+'</div></div>';
}
function dismissWizard(){
  wizardDismissed = true;
  renderWizard();
}
async function saveWizardRoute(e){
  e.preventDefault();
  const prefix = $("wizardPrefix").value.trim() || "emby";
  const target = $("wizardTarget").value.trim();
  if(!target) return toast("先填写 Emby 上游地址");
  await api("/api/routes", { method:"POST", body:JSON.stringify({ prefix, target, mode:$("wizardMode").value, remark:"首次向导", icon:"", cacheImages:true, accessPolicy:{ browserMode:"status" } }) });
  toast("第一条路由已保存");
  await loadRoutes();
}
function routeCard(r){
  const targets = routeTargets(r).length;
  const url = location.origin + "/" + r.prefix;
  const safePrefix = escapeAttr(r.prefix);
  return '<article class="route" data-prefix="'+safePrefix+'"><div class="route-head"><div><div class="prefix-row"><span class="drag-handle" title="按住拖动排序" aria-label="按住拖动排序" onpointerdown="beginRoutePointerDrag(event,\\''+safePrefix+'\\')">↕</span><div class="prefix">'+escapeHtml(r.icon || "🎞️")+" /"+escapeHtml(r.prefix)+'</div></div><div class="muted small">'+escapeHtml(r.remark || "无备注")+'</div></div><span class="badge">'+escapeHtml(r.mode || "clean")+'</span></div><div class="target">'+escapeHtml(r.target)+'</div><div class="status-line"><span class="badge">'+targets+' 个上游</span>'+routeHealthBadge(r.prefix)+'<span class="badge">今日播放 '+(r.todayReqs||0)+'</span><span class="badge">'+(r.cacheImages ? "缓存开" : "缓存关")+'</span></div><div class="actions"><button class="btn" onclick="copyText(\\''+url+'\\')">复制入口</button><button class="btn" onclick="pingRoute(\\''+safePrefix+'\\')">测速</button><button class="btn" onclick="moveRoute(\\''+safePrefix+'\\',-1)">上移</button><button class="btn" onclick="moveRoute(\\''+safePrefix+'\\',1)">下移</button><button class="btn" onclick="editRoute(\\''+safePrefix+'\\')">编辑</button><button class="btn danger" onclick="deleteRoute(\\''+safePrefix+'\\')">删除</button></div></article>';
}
function routeTargets(route){
  return String(route.target || "").split(",").map(x => x.trim()).filter(Boolean);
}
function normalizeBeginnerPrefix(value){
  const cleaned = String(value || "emby").trim().replace(new RegExp("^/+"), "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  return cleaned || "emby";
}
function normalizeBeginnerTarget(value){
  let input = String(value || "").trim();
  if(!input) throw new Error("先填写 Emby 原地址");
  if(!new RegExp("^https?://", "i").test(input)) input = "https://" + input;
  const url = new URL(input);
  url.hash = "";
  url.search = "";
  if(url.pathname === "/web" || url.pathname.startsWith("/web/")) url.pathname = "/";
  const normalized = url.toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
function updateQuickProxyUrl(prefixValue){
  const input = $("quickPrefix");
  const result = $("quickResult");
  const output = $("quickProxyUrl");
  if(!input || !result || !output) return "";
  const prefix = normalizeBeginnerPrefix(prefixValue || input.value);
  const url = location.origin + "/" + prefix;
  output.textContent = url;
  result.hidden = false;
  return url;
}
function generateBeginnerRoute(){
  try {
    const prefix = normalizeBeginnerPrefix($("quickPrefix").value);
    const target = normalizeBeginnerTarget($("quickTarget").value);
    $("quickPrefix").value = prefix;
    $("oldPrefix").value = "";
    $("prefix").value = prefix;
    $("target").value = target;
    $("mode").value = $("quickMode").value || "clean";
    $("browserMode").value = "status";
    $("icon").value = "";
    $("remark").value = "小白生成";
    $("cacheImages").checked = true;
    updateQuickProxyUrl(prefix);
    toast("已生成反代地址，确认后点保存路径");
  } catch(e) {
    toast(e.message || "生成失败");
  }
}
async function copyQuickProxyUrl(){
  const url = updateQuickProxyUrl();
  if(!url) return;
  await navigator.clipboard.writeText(url);
  toast("反代地址已复制");
}
function normalizeBackgroundUrl(value, cacheBust=false){
  const raw = String(value || "").trim();
  if(!raw) return "";
  const parsed = new URL(raw, location.href);
  if(!["http:", "https:"].includes(parsed.protocol)) throw new Error("背景地址只支持 http/https 图片或随机图 API URL");
  if(cacheBust) parsed.searchParams.set("_cfbg", Date.now().toString());
  return parsed.toString();
}
function cssImageUrl(url){
  return "url("+JSON.stringify(String(url))+")";
}
function setBackground(url, opacityValue){
  const opacity = Math.max(0, Math.min(70, Number(opacityValue || 0)));
  const root = document.documentElement;
  const preview = $("bgPreview");
  if(url) {
    root.style.setProperty("--custom-bg", cssImageUrl(url));
    root.style.setProperty("--custom-bg-opacity", String(opacity / 100));
    document.body.classList.add("custom-bg");
    if(preview) preview.style.backgroundImage = cssImageUrl(url);
  } else {
    root.style.removeProperty("--custom-bg");
    root.style.setProperty("--custom-bg-opacity", "0");
    document.body.classList.remove("custom-bg");
    if(preview) preview.style.backgroundImage = "";
  }
  if($("bgOpacity")) $("bgOpacity").value = String(opacity);
  if($("bgOpacityLabel")) $("bgOpacityLabel").textContent = opacity+"%";
}
async function loadAppearance(){
  if(!envState.hasDb) {
    setBackground("", 28);
    if($("bgUrl")) $("bgUrl").placeholder = "需要先绑定 D1 才能保存背景";
    return;
  }
  try {
    const data = await api("/api/settings/appearance");
    const appearance = data.appearance || {};
    const url = appearance.backgroundUrl || "";
    const opacity = appearance.backgroundOpacity ?? 28;
    if($("bgUrl")) $("bgUrl").value = url;
    setBackground(url, opacity);
  } catch(e) {
    setBackground("", 28);
    if($("bgUrl")) $("bgUrl").placeholder = "读取背景配置失败，可重新保存";
    toast("背景配置读取失败: "+e.message);
  }
}
function previewBackgroundOpacity(){
  const opacity = $("bgOpacity")?.value || "28";
  if($("bgOpacityLabel")) $("bgOpacityLabel").textContent = opacity+"%";
  document.documentElement.style.setProperty("--custom-bg-opacity", String(Number(opacity) / 100));
}
async function applyBackground(){
  try {
    const raw = $("bgUrl").value;
    const url = normalizeBackgroundUrl(raw, false);
    if(!url) return await resetBackground();
    const opacity = $("bgOpacity").value || "28";
    await saveAppearance({ backgroundUrl: raw.trim(), backgroundOpacity: Number(opacity) });
    setBackground(url, opacity);
    toast("背景已保存到 D1");
  } catch(e) {
    toast(e.message || "背景地址无效");
  }
}
async function refreshBackground(){
  try {
    const raw = $("bgUrl").value;
    const url = normalizeBackgroundUrl(raw, true);
    if(!url) return toast("先填写背景图片或随机图 API");
    const opacity = $("bgOpacity").value || "28";
    await saveAppearance({ backgroundUrl: raw.trim(), backgroundOpacity: Number(opacity) });
    setBackground(url, opacity);
    toast("背景已刷新并保存");
  } catch(e) {
    toast(e.message || "背景刷新失败");
  }
}
async function resetBackground(){
  try {
    await saveAppearance({ backgroundUrl:"", backgroundOpacity:28 });
  } catch(e) {
    toast("背景配置保存失败: "+e.message);
    return;
  }
  if($("bgUrl")) $("bgUrl").value = "";
  setBackground("", 28);
  toast("已恢复默认背景并保存");
}
async function saveAppearance(appearance){
  if(!envState.hasDb) throw new Error("需要先绑定 D1，背景配置会保存到 settings 表");
  return api("/api/settings/appearance", { method:"POST", body:JSON.stringify(appearance) });
}
function renderSnapshot(){
  const grid = $("snapshotGrid");
  if(!grid) return;
  const routeCount = routes.length;
  const upstreamCount = routes.reduce((sum, route) => sum + routeTargets(route).length, 0);
  const stats = Array.isArray(statsState) ? statsState : [];
  const totalReqs = stats.reduce((sum, item) => sum + Number(item.totalReqs || 0), 0);
  const lastDate = stats.map(item => item.lastDate || "").filter(Boolean).sort().pop() || "-";
  const protectedText = envState.protected ? "已设置" : "未设置";
  const dnsText = envState.hasDnsEnv ? (envState.cfDomain || "已配置") : "未配置";
  const defaultTargetText = envState.defaultTarget ? "已设置" : "未设置";
  const latestText = versionState?.latestShortSha || "未检查";
  $("snapshotSummary").textContent = "当前共有 "+routeCount+" 条路径、"+upstreamCount+" 个上游，累计播放 "+totalReqs+" 次。";
  grid.innerHTML =
    statBox("面板保护", protectedText)+
    statBox("D1 绑定", envState.hasDb ? "已绑定" : "未绑定")+
    statBox("DNS 自动化", dnsText)+
    statBox("默认上游", defaultTargetText)+
    statBox("路由数量", routeCount)+
    statBox("上游数量", upstreamCount)+
    statBox("累计播放", totalReqs)+
    statBox("最近统计", lastDate)+
    statBox("浏览器模式", envState.browserMode || "proxy")+
    statBox("最新提交", latestText);
}
async function copySnapshot(){
  if(!routes.length && envState.hasDb) {
    try { routes = await api("/api/routes"); } catch {}
  }
  const stats = Array.isArray(statsState) ? statsState : [];
  const totalReqs = stats.reduce((sum, item) => sum + Number(item.totalReqs || 0), 0);
  const lastDate = stats.map(item => item.lastDate || "").filter(Boolean).sort().pop() || "-";
  const countries = Array.isArray(envState.blockedCountries) ? envState.blockedCountries : [];
  const customClients = Array.isArray(envState.blockedClients) ? envState.blockedClients : [];
  const defaultClients = Array.isArray(envState.defaultBlockedClients) ? envState.defaultBlockedClients : [];
  const routeLines = routes.length
    ? routes.map(r => "- /"+r.prefix+" | mode="+(r.mode || "clean")+" | upstreams="+routeTargets(r).length+" | browser="+((r.accessPolicy && r.accessPolicy.browserMode) || "proxy")).join("\\n")
    : "- none";
  const lines = [
    "CF Emby Proxy Panel Snapshot",
    "Generated: "+new Date().toISOString(),
    "Page: "+location.origin,
    "Version: "+(envState.version || ""),
    "Latest: "+(versionState?.latestShortSha || "unknown"),
    "Protected: "+(envState.protected ? "yes" : "no"),
    "D1: "+(envState.hasDb ? "bound" : "missing"),
    "DNS: "+(envState.hasDnsEnv ? (envState.cfDomain || "configured") : "not configured"),
    "Default target: "+(envState.defaultTarget ? "set" : "empty"),
    "Browser mode: "+(envState.browserMode || "proxy"),
    "Blocked countries: "+(countries.join(", ") || "none"),
    "Blocked client keywords: "+(customClients.length || defaultClients.length),
    "Routes: "+routes.length,
    "Upstreams: "+routes.reduce((sum, route) => sum + routeTargets(route).length, 0),
    "Total play requests: "+totalReqs,
    "Last stats date: "+lastDate,
    "",
    "Route summary:",
    routeLines,
  ];
  await navigator.clipboard.writeText(lines.join("\\n"));
  toast("运维快照已复制");
  renderSnapshot();
}
function routeHealthBadge(prefix){
  const item = routeHealth[prefix];
  if(!item) return "";
  if(item.loading) return '<span class="badge">测试中</span>';
  const best = item.best >= 0 ? item.best+" ms" : "全部失败";
  return '<span class="badge">'+item.ok+'/'+item.total+' 可用 · '+best+'</span>';
}
function exportRoutes(){
  if(!routes.length) return toast("还没有可导出的路径");
  const payload = {
    app:"cf-emby-proxy-panel",
    version:"${VERSION}",
    exportedAt:new Date().toISOString(),
    routes:routes.map(r => ({
      prefix:r.prefix,
      target:r.target,
      mode:r.mode || "clean",
      remark:r.remark || "",
      icon:r.icon || "",
      cacheImages:!!r.cacheImages,
      order_idx:r.order_idx || 0,
      accessPolicy:r.accessPolicy || {},
    })),
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "emby-routes-"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
  toast("配置已导出");
}
function pickImportFile(){
  $("importFile").value = "";
  $("importFile").click();
}
async function importRoutesFile(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.routes;
    if(!Array.isArray(list) || !list.length) return toast("没有找到 routes 配置");
    if(!confirm("确认导入 "+list.length+" 条路径？同名路径会被覆盖。")) return;
    const result = await api("/api/routes/import", { method:"POST", body:JSON.stringify({ routes:list }) });
    toast("已导入 "+(result.imported || 0)+" 条路径");
    await loadRoutes();
    await loadStats();
  } catch(e) {
    toast("导入失败: "+e.message);
  }
}
function newRoute(){ $("routeForm").reset(); $("oldPrefix").value=""; $("cacheImages").checked=true; $("mode").value="clean"; $("browserMode").value="proxy"; $("prefix").focus(); }
function editRoute(prefix){
  const r = routes.find(x => x.prefix === prefix); if(!r) return;
  $("oldPrefix").value = r.prefix; $("prefix").value = r.prefix; $("target").value = r.target; $("mode").value = r.mode || "clean"; $("icon").value = r.icon || ""; $("remark").value = r.remark || ""; $("cacheImages").checked = !!r.cacheImages; $("browserMode").value = (r.accessPolicy && r.accessPolicy.browserMode) || "proxy";
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function saveRoute(e){
  e.preventDefault();
  const body = { oldPrefix:$("oldPrefix").value, prefix:$("prefix").value, target:$("target").value, mode:$("mode").value, icon:$("icon").value, remark:$("remark").value, cacheImages:$("cacheImages").checked, accessPolicy:{ browserMode:$("browserMode").value } };
  await api("/api/routes", { method:"POST", body:JSON.stringify(body) });
  toast("路径已保存"); newRoute(); await loadRoutes(); await loadStats();
}
async function moveRoute(prefix, direction){
  const index = routes.findIndex(x => x.prefix === prefix);
  const nextIndex = index + direction;
  if(index < 0 || nextIndex < 0 || nextIndex >= routes.length) return;
  const previous = routes.slice();
  const item = routes.splice(index, 1)[0];
  routes.splice(nextIndex, 0, item);
  routes.forEach((route, order) => { route.order_idx = order; });
  renderRoutes();
  try {
    await saveRouteOrder();
    toast("排序已保存");
  } catch(e) {
    routes = previous;
    renderRoutes();
    toast("排序保存失败: "+e.message);
  }
}
async function saveRouteOrder(){
  await api("/api/routes/reorder", { method:"POST", body:JSON.stringify(routes.map(r => r.prefix)) });
}
function beginRoutePointerDrag(event, prefix){
  if(event.button !== undefined && event.button !== 0) return;
  const source = event.currentTarget.closest(".route");
  const container = $("routes");
  if(!source || !container) return;
  event.preventDefault();
  const rect = source.getBoundingClientRect();
  const placeholder = document.createElement("div");
  placeholder.className = "route-placeholder";
  placeholder.style.height = rect.height+"px";
  placeholder.style.width = rect.width+"px";
  source.after(placeholder);

  const ghost = source.cloneNode(true);
  ghost.classList.add("route-drag-ghost");
  ghost.style.width = rect.width+"px";
  ghost.style.minHeight = rect.height+"px";
  document.body.appendChild(ghost);

  source.classList.add("drag-source");
  container.classList.add("dragging");
  routePointerDrag = {
    prefix,
    source,
    placeholder,
    ghost,
    container,
    offsetX:event.clientX - rect.left,
    offsetY:event.clientY - rect.top,
    previous:routes.slice(),
  };
  moveRouteDragGhost(event);
  document.addEventListener("pointermove", moveRoutePointerDrag);
  document.addEventListener("pointerup", finishRoutePointerDrag);
  document.addEventListener("pointercancel", cancelRoutePointerDrag);
}
function moveRouteDragGhost(event){
  if(!routePointerDrag?.ghost) return;
  const x = event.clientX - routePointerDrag.offsetX;
  const y = event.clientY - routePointerDrag.offsetY;
  routePointerDrag.ghost.style.transform = "translate3d("+x+"px,"+y+"px,0) rotate(.2deg)";
}
function moveRoutePointerDrag(event){
  if(!routePointerDrag) return;
  event.preventDefault();
  moveRouteDragGhost(event);
  const { container, placeholder, source, ghost } = routePointerDrag;
  ghost.hidden = true;
  const below = document.elementFromPoint(event.clientX, event.clientY);
  ghost.hidden = false;
  const target = below?.closest?.(".route");
  if(target && target.parentElement === container && target !== source) {
    const rect = target.getBoundingClientRect();
    if(event.clientY > rect.top + rect.height / 2) target.after(placeholder);
    else target.before(placeholder);
    return;
  }
  const containerRect = container.getBoundingClientRect();
  if(event.clientY > containerRect.bottom - 24) container.appendChild(placeholder);
  if(event.clientY < containerRect.top + 24) container.prepend(placeholder);
}
async function finishRoutePointerDrag(event){
  if(!routePointerDrag) return;
  event?.preventDefault?.();
  const state = routePointerDrag;
  const orderedPrefixes = Array.from(state.container.children)
    .filter(el => el !== state.source)
    .map(el => el.classList.contains("route-placeholder") ? state.prefix : el.dataset?.prefix)
    .filter(Boolean);
  cleanupRoutePointerDrag();
  const changed = orderedPrefixes.join("|") !== state.previous.map(route => route.prefix).join("|");
  if(!changed) {
    renderRoutes();
    return;
  }
  const byPrefix = new Map(state.previous.map(route => [route.prefix, route]));
  routes = orderedPrefixes.map(prefix => byPrefix.get(prefix)).filter(Boolean);
  routes.forEach((route, order) => { route.order_idx = order; });
  renderRoutes();
  try {
    await saveRouteOrder();
    toast("拖动排序已保存");
  } catch(e) {
    routes = state.previous;
    renderRoutes();
    toast("排序保存失败: "+e.message);
  }
}
function cancelRoutePointerDrag(){
  if(!routePointerDrag) return;
  const previous = routePointerDrag.previous;
  cleanupRoutePointerDrag();
  routes = previous;
  renderRoutes();
}
function cleanupRoutePointerDrag(){
  if(!routePointerDrag) return;
  document.removeEventListener("pointermove", moveRoutePointerDrag);
  document.removeEventListener("pointerup", finishRoutePointerDrag);
  document.removeEventListener("pointercancel", cancelRoutePointerDrag);
  routePointerDrag.source?.classList.remove("drag-source");
  routePointerDrag.placeholder?.remove();
  routePointerDrag.ghost?.remove();
  routePointerDrag.container?.classList.remove("dragging");
  routePointerDrag = null;
}
async function deleteRoute(prefix){ if(!confirm("删除 /"+prefix+" ?")) return; await api("/api/routes?prefix="+encodeURIComponent(prefix), { method:"DELETE" }); toast("已删除"); await loadRoutes(); await loadStats(); }
async function pingRoute(prefix){
  const r = routes.find(x => x.prefix === prefix); if(!r) return;
  await pingOneRoute(r, true);
}
async function pingAllRoutes(){
  if(!routes.length) return toast("还没有路径");
  toast("开始测试全部上游");
  for (const route of routes) {
    await pingOneRoute(route, false);
  }
  toast("全部上游测试完成");
}
async function pingOneRoute(route, showToast){
  const targets = routeTargets(route);
  if(!targets.length) return;
  routeHealth[route.prefix] = { loading:true, total:targets.length, ok:0, best:-1 };
  renderRoutes();
  const results = [];
  for (const target of targets) {
    try {
      const data = await api("/api/ping?url="+encodeURIComponent(target));
      results.push(Number(data.ms));
    } catch {
      results.push(-1);
    }
  }
  const okResults = results.filter(ms => ms >= 0);
  routeHealth[route.prefix] = {
    loading:false,
    total:targets.length,
    ok:okResults.length,
    best:okResults.length ? Math.min(...okResults) : -1,
  };
  renderRoutes();
  if(showToast) {
    const item = routeHealth[route.prefix];
    toast("/"+route.prefix+" 上游: "+item.ok+"/"+item.total+" 可用，最快 "+(item.best >= 0 ? item.best+" ms" : "失败"));
  }
}
async function loadRemoteIps(){ const data = await api("/api/get-remote-ips?type="+encodeURIComponent($("ipType").value)); setIps(data.ips || []); toast("已拉取 "+(data.totalCount||0)+" 条"); }
async function loadCustomIps(){ const src=$("ipSource").value.trim(); if(!src) return toast("先填自定义源 URL"); const data=await api("/api/fetch-ips?url="+encodeURIComponent(src)); setIps(data.ips || []); toast("已解析 "+(data.totalCount||0)+" 条"); }
function setIps(list){ ips = list.map(ip => ({ ip, ms:null, checked:true })); renderIps(); }
function renderIps(){ $("ipList").innerHTML = ips.length ? ips.map((item,i)=>'<label class="ip-item"><input type="checkbox" '+(item.checked?'checked':'')+' onchange="ips['+i+'].checked=this.checked"><code>'+escapeHtml(item.ip)+'</code><span class="badge">'+(item.ms===null?"未测":(item.ms>=0?item.ms+" ms":"失败"))+'</span></label>').join("") : '<div class="empty">还没有 IP，先拉取或解析源。</div>'; }
async function pingSelected(){
  const selected = ips.filter(x=>x.checked);
  for (const item of selected) {
    const host = item.ip.includes(":") && !item.ip.startsWith("[") ? "["+item.ip+"]" : item.ip;
    try { const data = await api("/api/ping?url="+encodeURIComponent("https://"+host)); item.ms = data.ms; } catch { item.ms = -1; }
    renderIps();
  }
  ips.sort((a,b)=>(a.ms<0?999999:a.ms??999999)-(b.ms<0?999999:b.ms??999999)); renderIps();
}
function selectedDnsIps(){
  return ips.filter(x=>x.checked).map(x=>x.ip);
}
async function getDnsPreview(selected){
  return api("/api/dns-preview", { method:"POST", body:JSON.stringify({ ips:selected, proxied:false }) });
}
async function previewDns(){
  const selected = selectedDnsIps();
  if(!selected.length) return toast("先勾选 IP");
  $("dnsPreview").hidden = false;
  $("dnsPreview").innerHTML = '<div class="dns-plan">正在读取现有 DNS 记录...</div>';
  try {
    const data = await getDnsPreview(selected);
    renderDnsPreview(data);
    toast("DNS 预览已生成");
    return data;
  } catch(e) {
    $("dnsPreview").innerHTML = '<div class="dns-plan"><strong>DNS 预览失败</strong><p class="small muted">'+escapeHtml(e.message)+'</p></div>';
    toast("DNS 预览失败");
    return null;
  }
}
function renderDnsPreview(data){
  const del = data.toDelete || [];
  const create = data.toCreate || [];
  const keep = data.toKeep || [];
  $("dnsPreview").hidden = false;
  $("dnsPreview").innerHTML =
    '<div class="dns-plan"><h3>将删除 '+del.length+' 条 A/AAAA/CNAME</h3><div class="dns-records">'+dnsRecordList(del, "没有要删除的记录")+'</div></div>'+
    '<div class="dns-plan"><h3>将创建 '+create.length+' 条记录</h3><div class="dns-records">'+dnsRecordList(create, "没有要创建的记录")+'</div></div>'+
    (keep.length ? '<div class="dns-plan"><h3>保留 '+keep.length+' 条其他类型记录</h3><div class="dns-records">'+dnsRecordList(keep, "")+'</div></div>' : '');
}
function dnsRecordList(list, emptyText){
  if(!list.length) return '<div class="small muted">'+escapeHtml(emptyText)+'</div>';
  return list.map(r => '<div class="dns-record"><span class="badge">'+escapeHtml(r.type || "?")+'</span><code>'+escapeHtml(r.content || "")+'</code></div>').join("");
}
async function updateDns(){
  const selected = selectedDnsIps();
  if(!selected.length) return toast("先勾选 IP");
  const plan = await previewDns();
  if(!plan) return;
  if(!confirm("确认写入 "+selected.length+" 条记录？\\n将删除 "+(plan.toDelete||[]).length+" 条现有 A/AAAA/CNAME。")) return;
  const data = await api("/api/update-dns", { method:"POST", body:JSON.stringify({ ips:selected, proxied:false }) });
  toast(data.message || "DNS 已更新");
}
async function copyText(text){ await navigator.clipboard.writeText(text); toast("已复制"); }
async function logout(){ await api("/api/logout", { method:"POST" }); location.reload(); }
function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[m])); }
function escapeAttr(s){ return escapeHtml(s).replace(/\\\\/g,"\\\\\\\\").replace(/'/g,"\\\\'"); }
boot();
</script>
</body>
</html>`;
}

function loginPage(protectedPanel) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emby Proxy Login</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#edf5f2,#f8f1e5);font-family:"Segoe UI","Microsoft YaHei",sans-serif}.box{width:min(420px,calc(100vw - 28px));background:#fffdf7;border:1px solid #d9ded4;border-radius:8px;box-shadow:0 20px 45px rgba(30,42,35,.1);padding:24px}h1{margin:0 0 8px}p{color:#68706a}input,button{width:100%;box-sizing:border-box;border-radius:7px;padding:12px;font:inherit}input{border:1px solid #d9ded4}button{margin-top:12px;border:0;background:#2563eb;color:white;font-weight:700;cursor:pointer}.hint{font-size:13px}</style></head>
<body><form class="box" onsubmit="login(event)"><h1>Emby 反代面板</h1><p>${protectedPanel ? "输入 ADMIN_TOKEN 登录。" : "未设置 ADMIN_TOKEN，点击进入面板。"}</p><input id="token" type="password" placeholder="ADMIN_TOKEN"><button>进入</button><p id="msg" class="hint"></p></form>
<script>
async function login(e){e.preventDefault();const token=document.getElementById("token").value;const res=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});const data=await res.json();if(data.success) location.href="/"; else document.getElementById("msg").textContent=data.error||"登录失败";}
</script></body></html>`;
}

function statusPage({ request, route, prefix, delay, clients }) {
  const url = new URL(request.url);
  const country = request.headers.get("CF-IPCountry") || "未知";
  const clientIp = request.headers.get("CF-Connecting-IP") || "未知";
  const colo = request.cf?.colo || "未知";
  const status = delay < 0 ? ["#d12b2b", "连接异常"] : delay < 160 ? ["#14804a", "极快"] : delay < 350 ? ["#c26a16", "良好"] : ["#d12b2b", "较慢"];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emby Proxy Status</title><style>
body{margin:0;min-height:100vh;background:linear-gradient(135deg,#f7f8f2,#edf5f2 45%,#f8f1e5);font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#202124}.wrap{max-width:1100px;margin:0 auto;padding:28px}.hero{margin-bottom:20px}h1{font-size:32px;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.card{background:#fffdf7;border:1px solid #d9ded4;border-radius:8px;padding:18px;box-shadow:0 18px 45px rgba(30,42,35,.08)}.big{font-size:42px;font-weight:800;color:${status[0]}}.muted{color:#68706a}.clients{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px}.client{display:block;text-decoration:none;color:#202124;background:#fff;border:1px solid #d9ded4;border-radius:8px;padding:12px}.client:hover{border-color:#2563eb}.mono{font-family:Consolas,monospace;word-break:break-all}@media(max-width:600px){.wrap{padding:16px}.big{font-size:34px}}</style></head><body><main class="wrap"><section class="hero"><h1>${escapeHtml(route.icon || "🎬")} /${escapeHtml(prefix)} 代理状态</h1><p class="muted">${escapeHtml(route.remark || "Emby reverse proxy")}</p></section><section class="grid"><div class="card"><div class="muted">上游延迟</div><div class="big">${delay >= 0 ? delay : "--"}<small>ms</small></div><strong style="color:${status[0]}">${status[1]}</strong></div><div class="card"><div class="muted">连接信息</div><p>CDN 节点：${escapeHtml(colo)}</p><p>地区：${escapeHtml(country)}</p><p class="mono">IP：${escapeHtml(clientIp)}</p></div><div class="card"><div class="muted">入口</div><p class="mono">${escapeHtml(url.origin + "/" + prefix)}</p><p class="muted">建议使用 Emby 客户端访问。</p></div></section><section class="card" style="margin-top:14px"><h2 style="margin-top:0">推荐客户端</h2><div class="clients">${clients.map((c) => `<a class="client" href="${c.url}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(c.name)}</strong><br><span class="muted">${escapeHtml(new URL(c.url).hostname)}</span></a>`).join("")}</div></section></main></body></html>`;
}

function requireDb(env) {
  if (!env.DB) throw new Error("未绑定 D1 数据库，请绑定变量名 DB");
}

function normalizeRoute(input = {}) {
  const accessPolicy = typeof input.access_policy === "string"
    ? safeJson(input.access_policy, {})
    : input.accessPolicy || {};
  return {
    oldPrefix: cleanPrefix(input.oldPrefix),
    prefix: cleanPrefix(input.prefix),
    target: String(input.target || "").trim(),
    mode: input.mode || DEFAULT_MODE,
    remark: input.remark || "",
    icon: input.icon || "",
    last_play: input.last_play || "",
    cacheImages: input.cacheImages === undefined ? input.cacheImages !== 0 : Boolean(input.cacheImages),
    order_idx: input.order_idx || 0,
    accessPolicy,
    todayReqs: input.todayReqs || 0,
  };
}

function validateRoute(route) {
  if (!route.prefix) throw new Error("路径前缀不能为空");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(route.prefix)) throw new Error("路径只允许字母、数字、下划线和短横线");
  const targets = splitTargets(route.target);
  if (!targets.length) throw new Error("上游不能为空");
  for (const target of targets) {
    if (!/^https?:\/\//i.test(target)) throw new Error(`上游必须以 http:// 或 https:// 开头: ${target}`);
  }
}

function fallbackRoute(env) {
  return {
    prefix: "",
    target: env.DEFAULT_TARGET || "",
    mode: env.DEFAULT_MODE || DEFAULT_MODE,
    remark: "Default target",
    icon: "",
    cacheImages: env.CACHE_IMAGES !== "0",
    accessPolicy: { browserMode: getEnvBrowserMode(env) },
  };
}

function getBlockReason(request, env) {
  const country = request.headers.get("CF-IPCountry") || request.cf?.country || "";
  const blockedCountries = splitList(env.BLOCKED_COUNTRIES).map((item) => item.toUpperCase());
  if (country && blockedCountries.includes(country.toUpperCase())) return "Forbidden: access from this region is restricted";

  const keywords = splitList(env.BLOCKED_CLIENTS);
  const blockedClients = keywords.length ? keywords : DEFAULT_BLOCKED_CLIENTS;
  const haystack = `${decodeURIComponentSafe(request.url)} ${JSON.stringify(Object.fromEntries(request.headers))}`.toLowerCase();
  const hit = blockedClients.find((item) => haystack.includes(String(item).toLowerCase()));
  return hit ? "Forbidden: client blocked" : "";
}

function isAuthorized(request, env) {
  const token = getAdminToken(env);
  if (!token) return true;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return Boolean(match && match[1] === syncAuthDigest(token));
}

async function authDigest(token) {
  return syncAuthDigest(token);
}

function syncAuthDigest(token) {
  let hash = 2166136261;
  for (let i = 0; i < String(token).length; i += 1) {
    hash ^= String(token).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function getAdminToken(env) {
  return env.ADMIN_TOKEN || env.ADMIN_PASSWORD || env.PASSWORD || "";
}

function getEnvBrowserMode(env) {
  const mode = String(env.BROWSER_MODE || DEFAULT_BROWSER_MODE).toLowerCase();
  return ["proxy", "status", "block"].includes(mode) ? mode : DEFAULT_BROWSER_MODE;
}

async function measureDelay(target) {
  if (!target) return -1;
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const targetUrl = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    await fetch(stripTrailingSlash(targetUrl) + "/", { method: "HEAD", signal: controller.signal });
    return Date.now() - start;
  } catch {
    return -1;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    }),
  });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: corsHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders({
      "Access-Control-Max-Age": "86400",
    }),
  });
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "Access-Control-Allow-Headers": "*",
    ...extra,
  };
}

function cleanPrefix(value) {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function splitTargets(value) {
  return String(value || "").split(",").map((item) => stripTrailingSlash(item.trim())).filter(Boolean);
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/g, "");
}

function normalizeRestPath(restPath) {
  if (!restPath || restPath === "/") return "/";
  return restPath.startsWith("/") ? restPath : `/${restPath}`;
}

function safeDecodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function today() {
  return new Date(Date.now() + 8 * 3600000).toISOString().split("T")[0];
}

function isBrowserRequest(request) {
  const ua = request.headers.get("User-Agent") || "";
  if (!ua) return false;
  return /mozilla|chrome|safari|firefox|edge|edg|opera|msie|trident/i.test(ua);
}

function isPlaybackRequest(pathname) {
  return /\/PlaybackInfo|\/stream|\.m3u8|\/videos\/.*\/main\.m3u8/i.test(pathname);
}

function isPlaylistRequest(pathname, contentType) {
  return /\.m3u8($|\?)/i.test(pathname) || /mpegurl|application\/vnd\.apple\.mpegurl/i.test(contentType);
}

function isCacheableAsset(pathname) {
  return /\.(jpg|jpeg|gif|png|svg|ico|webp|js|css|woff2?|ttf|otf|map|webmanifest|srt|ass|vtt|sub)$/i.test(pathname)
    || /(\/Images\/|\/Icons\/|\/Branding\/|\/emby\/covers\/)/i.test(pathname);
}

function isLikelyMediaUrl(value) {
  return /(\/videos\/|\/audio\/|\/stream|\.m3u8|\.mp4|\.mkv|\.ts|\.aac|\.mp3|\.flac)/i.test(value);
}

function rewriteLocation(location, workerOrigin, upstreamOrigin, prefix) {
  try {
    const absolute = new URL(location, upstreamOrigin).toString();
    if (absolute.startsWith(upstreamOrigin)) {
      return `${workerOrigin}${prefix ? `/${prefix}` : ""}${absolute.slice(upstreamOrigin.length)}`;
    }
    return `/${absolute}`;
  } catch {
    return location;
  }
}

function base64UrlEncode(value) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  try {
    return atob(base64);
  } catch {
    return "";
  }
}

function wrapIpv6(value) {
  const ip = String(value || "").replace(/^\[|\]$/g, "");
  return ip.includes(":") ? `[${ip}]` : ip;
}

function normalizeDnsContent(value) {
  return String(value || "").trim().replace(/^\[|\]$/g, "");
}

function getDnsRecordType(content) {
  if (content.includes(":")) return "AAAA";
  if (/[a-zA-Z]/.test(content)) return "CNAME";
  return "A";
}

function isPrivateIpv4(ip) {
  return ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("127.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
