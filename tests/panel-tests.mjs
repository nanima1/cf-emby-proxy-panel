import vm from "node:vm";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import worker from "../src/worker.js";

async function panelHtml() {
  const response = await worker.fetch(new Request("https://panel.test/"), {}, {});
  assert.equal(response.status, 200);
  return response.text();
}

function scriptFromHtml(html) {
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
  assert.ok(script.includes("updateRoutePreview"), "panel script should include route preview");
  assert.ok(script.includes("copyRouteSummary"), "panel script should include config copy");
  new Function(script);
  return script.replace(/\nboot\(\);\s*$/, "\n");
}

function createDomContext() {
  const elements = new Map();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    location: { origin: "https://panel.test", href: "https://panel.test/" },
    navigator: {
      clipboard: {
        async writeText(text) {
          context.__copied = text;
        },
      },
    },
    document: {
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            id,
            value: "",
            textContent: "",
            innerHTML: "",
            hidden: false,
            checked: false,
            classList: { add() {}, remove() {} },
            focus() {},
            reset() {},
          });
        }
        return elements.get(id);
      },
      addEventListener() {},
      createElement() {
        return this.getElementById(`created-${Math.random()}`);
      },
      body: { appendChild() {} },
    },
    window: { scrollTo() {} },
    URL,
    Blob,
    confirm: () => true,
    __apiCalls: [],
    __copied: "",
  };
  return vm.createContext(context);
}

async function testPanelScriptAndRouteHelpers() {
  const script = scriptFromHtml(await panelHtml());
  const context = createDomContext();
  const testCode = `
(async () => {
routes = [];
api = async (path, init={}) => {
  globalThis.__apiCalls.push({ path, body: init.body ? JSON.parse(init.body) : null });
  return path === "/api/routes" ? { success:true } : [];
};
loadRoutes = async () => {};
loadStats = async () => {};

$("oldPrefix").value = "";
$("prefix").value = "hk";
$("target").value = "";
$("mode").value = "clean";
updateRoutePreview();
if (!$("routePreviewMeta").innerHTML.includes("需修正")) throw new Error("empty upstream should ask for correction");

$("target").value = "emby.example.com/web/index.html, http://backup.example.com:8096/";
$("mode").value = "clean";
$("browserMode").value = "status";
$("cacheImages").checked = true;

const preview = updateRoutePreview();
if (preview !== "https://panel.test/hk") throw new Error("bad preview");
if ($("routePreview").hidden) throw new Error("preview hidden");
if (!$("routePreviewMeta").innerHTML.includes("2")) throw new Error("missing target count");

await saveRoute({ preventDefault(){} });
const saved = globalThis.__apiCalls.find(call => call.path === "/api/routes");
if (!saved) throw new Error("route save was not called");
if (saved.body.target !== "https://emby.example.com\\nhttp://backup.example.com:8096") {
  throw new Error("target was not normalized: " + saved.body.target);
}

routes = [{ prefix:"hk", target:saved.body.target, mode:"clean", cacheImages:true, accessPolicy:{ browserMode:"status" } }];
await copyRouteSummary("hk");
if (!globalThis.__copied.includes("https://panel.test/hk")) throw new Error("copy missing entry URL");
if (!globalThis.__copied.includes("http://backup.example.com:8096")) throw new Error("copy missing upstream");
})();
`;
  await vm.runInContext(script + testCode, context, { timeout: 5000 });
}

async function testInvalidRouteReturnsBadRequest() {
  const db = { exec: async () => undefined };
  const response = await worker.fetch(
    new Request("https://panel.test/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "hk", target: "https://" }),
    }),
    { DB: db },
    {},
  );
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.success, false);
  assert.match(data.error, /上游地址/);
}

function createDbMock() {
  const db = {
    batchCalls: [],
    prepared: [],
    exec: async () => undefined,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          db.prepared.push(this);
          return this;
        },
        async run() {
          return { success: true };
        },
      };
      return statement;
    },
    async batch(statements) {
      this.batchCalls.push(statements);
      return [];
    },
  };
  return db;
}

async function testImportRoutesValidation() {
  const invalidDb = createDbMock();
  const invalid = await worker.fetch(
    new Request("https://panel.test/api/routes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes: [{ prefix: "bad", target: "https://" }] }),
    }),
    { DB: invalidDb },
    {},
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalidDb.batchCalls.length, 0);
  assert.match((await invalid.json()).error, /第 1 条路径无效/);

  const validDb = createDbMock();
  const valid = await worker.fetch(
    new Request("https://panel.test/api/routes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routes: [{
          prefix: "ok",
          target: "https://a.example.com/, http://b.example.com:8096/",
          mode: "REAL-IP",
          cacheImages: "false",
          accessPolicy: { browserMode: "BLOCK" },
        }],
      }),
    }),
    { DB: validDb },
    {},
  );
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).imported, 1);
  assert.equal(validDb.batchCalls.length, 1);
  assert.equal(validDb.prepared.at(-1).values[1], "https://a.example.com\nhttp://b.example.com:8096");
  assert.equal(validDb.prepared.at(-1).values[2], "real-ip");
  assert.equal(validDb.prepared.at(-1).values[5], 0);
  assert.equal(JSON.parse(validDb.prepared.at(-1).values[7]).browserMode, "block");
}

async function testInvalidJsonReturnsBadRequest() {
  const response = await worker.fetch(
    new Request("https://panel.test/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
    { DB: { exec: async () => undefined } },
    {},
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /JSON 格式不正确/);
}

async function testEnvBrowserModeNormalization() {
  const upper = await worker.fetch(new Request("https://panel.test/api/env"), { BROWSER_MODE: "BLOCK" }, {});
  assert.equal((await upper.json()).browserMode, "block");

  const invalid = await worker.fetch(new Request("https://panel.test/api/env"), { BROWSER_MODE: "surprise" }, {});
  assert.equal((await invalid.json()).browserMode, "proxy");
}

async function testDnsInputValidationAndNormalization() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({
      success: true,
      result: [
        { id: "old-a", type: "A", name: "emby.example.com", content: "1.1.1.1", proxied: false, ttl: 60 },
        { id: "keep-txt", type: "TXT", name: "emby.example.com", content: "keep", proxied: false, ttl: 60 },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const env = { CF_API_TOKEN: "token", CF_ZONE_ID: "zone", CF_DOMAIN: "emby.example.com" };
  try {
    const preview = await worker.fetch(
      new Request("https://panel.test/api/dns-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: [" 8.8.8.8 ", "[2001:db8::1]", "CDN.Example.COM.", "https://media.example.net/path", "8.8.8.8"] }),
      }),
      env,
      {},
    );
    assert.equal(preview.status, 200);
    const data = await preview.json();
    assert.deepEqual(data.toCreate.map((item) => [item.type, item.content]), [
      ["A", "8.8.8.8"],
      ["AAAA", "2001:db8::1"],
      ["CNAME", "cdn.example.com"],
      ["CNAME", "media.example.net"],
    ]);
    assert.equal(data.toDelete.length, 1);
    assert.equal(data.toKeep.length, 1);

    const beforeInvalidCount = requests.length;
    const privateIp = await worker.fetch(
      new Request("https://panel.test/api/dns-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: ["192.168.1.2"] }),
      }),
      env,
      {},
    );
    assert.equal(privateIp.status, 400);
    assert.match((await privateIp.json()).error, /DNS 内容无效/);
    assert.equal(requests.length, beforeInvalidCount, "invalid DNS input should not call Cloudflare");

    const badHost = await worker.fetch(
      new Request("https://panel.test/api/dns-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: ["bad host"] }),
      }),
      env,
      {},
    );
    assert.equal(badHost.status, 400);

    const badIpv4 = await worker.fetch(
      new Request("https://panel.test/api/dns-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips: ["999.999.999.999"] }),
      }),
      env,
      {},
    );
    assert.equal(badIpv4.status, 400);
    assert.match((await badIpv4.json()).error, /不是有效 IPv4/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testMarkdownLinks() {
  const files = [
    "README.md",
    "docs/QUICK_DEPLOY.md",
    "docs/CF_DEPLOY_BEGINNER.md",
  ];
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1].trim();
      if (!rawTarget || rawTarget.startsWith("#") || /^[a-z]+:/i.test(rawTarget)) continue;
      const [targetPath] = rawTarget.split("#");
      if (!targetPath) continue;
      const absoluteTarget = resolve(dirname(file), decodeURIComponent(targetPath));
      assert.ok(existsSync(absoluteTarget), `${file} has broken link: ${rawTarget}`);
    }
  }
}

await testPanelScriptAndRouteHelpers();
await testInvalidRouteReturnsBadRequest();
await testImportRoutesValidation();
await testInvalidJsonReturnsBadRequest();
await testEnvBrowserModeNormalization();
await testDnsInputValidationAndNormalization();
testMarkdownLinks();
console.log("PANEL_TESTS_OK");
