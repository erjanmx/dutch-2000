import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Woord Vooruit application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Woord Vooruit — Dutch 2000<\/title>/i);
  assert.match(html, /Master 2,000 frequent Dutch words/);
  assert.match(html, /Loading your Dutch deck/);
  assert.match(html, /Preparing your Dutch deck/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("includes the client bundle needed to hydrate study interactions", async () => {
  const html = await (await render()).text();
  assert.match(html, /<script id="_R_">import\("\/assets\/index-/);
  assert.match(html, /page:/);
});
