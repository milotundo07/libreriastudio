import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalIsbn, isValidIsbn10, isValidIsbn13, isbn10To13, isbn13To10, validateIsbn,
} from "../src/isbn.js";

test("valida ISBN-13 e rifiuta checksum errato", () => {
  assert.equal(isValidIsbn13("9788807901294"), true);
  assert.equal(isValidIsbn13("9788807901295"), false);
});

test("converte ISBN-10 e ISBN-13", () => {
  assert.equal(isbn13To10("9788807901294"), "8807901293");
  assert.equal(isbn10To13("8807901293"), "9788807901294");
  assert.equal(canonicalIsbn("8807901293"), "9788807901294");
});

test("la X è accettata solo in un ISBN-10 valido", () => {
  assert.equal(isValidIsbn10("8807901293"), true);
  assert.equal(validateIsbn("97888079012X4").valid, false);
});
