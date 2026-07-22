import test from "node:test";
import assert from "node:assert/strict";
import { mergeMetadata, scoreCatalogCandidate } from "../src/catalogs.js";

test("fonde metadati complementari senza perdere autori e categorie", () => {
  const merged = mergeMetadata([
    { title: "Il nome della rosa", authors: ["Umberto Eco"], source: "SBN", publisher: "Bompiani" },
    { title: "Il nome della rosa", authors: ["Umberto Eco"], source: "Google Books", cover_url: "https://books.googleusercontent.com/cover", categories: ["Romanzo"] },
  ]);
  assert.equal(merged.title, "Il nome della rosa");
  assert.equal(merged.publisher, "Bompiani");
  assert.equal(merged.cover_url.includes("googleusercontent"), true);
  assert.deepEqual(merged.authors, ["Umberto Eco"]);
});

test("assegna più confidenza a titolo e autore coerenti", () => {
  const good = scoreCatalogCandidate({ title: "Il nome della rosa", authors: ["Umberto Eco"], source: "SBN" }, "UMBERTO ECO\nIL NOME DELLA ROSA");
  const bad = scoreCatalogCandidate({ title: "Guerra e pace", authors: ["Lev Tolstoj"], source: "Open Library" }, "UMBERTO ECO\nIL NOME DELLA ROSA");
  assert.ok(good > bad);
});
