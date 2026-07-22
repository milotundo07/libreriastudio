import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("tutti i selettori ID diretti usati da app.js esistono nell’HTML", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/app.js", root), "utf8"),
  ]);
  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const selectorIds = new Set([...app.matchAll(/\$\(["']#([A-Za-z0-9_-]+)["']/g)].map((match) => match[1]));
  const missing = [...selectorIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, []);
});
