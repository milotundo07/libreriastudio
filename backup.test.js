import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("la pagina contiene gli elementi principali richiesti dall’app", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const requiredIds = [
    "booksGrid", "bookDialog", "bookForm", "scannerDialog", "coverDialog", "dataDialog",
    "exportJsonButton", "exportExcelButton", "importJsonInput", "importExcelInput", "toast",
  ];
  for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test("manifest e service worker sono presenti", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", root), "utf8"));
  const serviceWorker = await readFile(new URL("sw.js", root), "utf8");
  assert.equal(manifest.display, "standalone");
  assert.match(serviceWorker, /CACHE_NAME/);
});
