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
testMarkdownLinks();
console.log("PANEL_TESTS_OK");
