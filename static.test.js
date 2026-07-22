import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchText, editionFingerprint, migrateLegacyBook, normalizeBook, validateBook } from "../src/model.js";

test("migra un vecchio record senza perdere i dati", () => {
  const book = migrateLegacyBook({
    id: 4,
    title: "L’insostenibile leggerezza dell’essere",
    authors: ["Milan Kundera"],
    isbn13: "9788807881480",
    source: "Google Books",
  });
  assert.equal(book.id, 4);
  assert.equal(book.copy_number, 1);
  assert.equal(book.title, "L’insostenibile leggerezza dell’essere");
  assert.ok(book.search_text.includes("insostenibile leggerezza"));
});

test("la ricerca normalizza accenti e campi personalizzati", () => {
  const text = buildSearchText(normalizeBook({
    title: "García Márquez",
    custom_fields: { Firma: "Caffè" },
  }));
  assert.ok(text.includes("garcia marquez"));
  assert.ok(text.includes("caffe"));
});

test("due esemplari della stessa edizione hanno la stessa impronta", () => {
  const a = normalizeBook({ title: "Libro", isbn13: "9788807901294", copy_number: 1 });
  const b = normalizeBook({ title: "Libro", isbn10: "8807901293", copy_number: 2 });
  assert.equal(editionFingerprint(a), editionFingerprint(b));
});

test("la validazione segnala ISBN e titolo errati", () => {
  const result = validateBook({ title: "", isbn13: "9780000000000" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});
