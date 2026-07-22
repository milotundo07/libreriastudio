import { canonicalIsbn, isbn10To13, isbn13To10, isValidIsbn10, isValidIsbn13, normalizeIsbn } from "./isbn.js";
import { normalizeText, nowIso, safeNumber, splitList, uniqueStrings } from "./utils.js";

export const CATALOG_STATUSES = Object.freeze(["Completa", "Da verificare", "Incompleta"]);

export function emptyBook() {
  const now = nowIso();
  return {
    id: undefined,
    created_at: now,
    updated_at: now,
    internal_code: "",
    copy_number: 1,
    title: "",
    subtitle: "",
    original_title: "",
    original_language: "",
    authors: [],
    contributors: "",
    isbn13: "",
    isbn10: "",
    canonical_isbn: "",
    language: "",
    publication_year: "",
    publication_date: "",
    publication_place: "",
    edition: "",
    printing: "",
    series: "",
    series_number: "",
    pages: "",
    publisher: "",
    dewey: "",
    categories: [],
    binding: "",
    dimensions: "",
    room: "",
    shelf: "",
    catalog_status: "Incompleta",
    condition: "",
    provenance: "",
    acquisition_date: "",
    acquisition_source: "",
    acquisition_price: "",
    notes: "",
    cover_url: "",
    cover_id: "",
    source: "",
    source_details: {},
    custom_fields: {},
  };
}

export function computeCatalogStatus(book) {
  if (book.catalog_status && CATALOG_STATUSES.includes(book.catalog_status)) return book.catalog_status;
  if (/verific|ocr|incert/i.test(String(book.source || ""))) return "Da verificare";
  const essentials = [
    Boolean(String(book.title || "").trim()),
    Array.isArray(book.authors) && book.authors.length > 0,
    Boolean(String(book.publisher || "").trim()),
    Boolean(book.publication_year),
  ];
  return essentials.every(Boolean) ? "Completa" : "Incompleta";
}

export function editionFingerprint(book) {
  const canonical = canonicalIsbn(book.isbn13 || book.isbn10);
  if (canonical) return `isbn:${canonical}`;
  return [
    normalizeText(book.title),
    normalizeText((book.authors || [])[0]),
    normalizeText(book.publisher),
    String(book.publication_year || ""),
    normalizeText(book.edition),
  ].join("|");
}

export function buildSearchText(book) {
  const customValues = Object.entries(book.custom_fields || {}).flat();
  return normalizeText([
    book.title,
    book.subtitle,
    book.original_title,
    ...(book.authors || []),
    book.contributors,
    book.internal_code,
    book.isbn13,
    book.isbn10,
    book.publisher,
    book.publication_place,
    book.publication_year,
    book.edition,
    book.printing,
    book.series,
    book.series_number,
    book.language,
    book.original_language,
    book.dewey,
    ...(book.categories || []),
    book.binding,
    book.dimensions,
    book.room,
    book.shelf,
    book.condition,
    book.provenance,
    book.acquisition_source,
    book.notes,
    ...customValues,
  ].filter(Boolean).join(" "));
}

export function normalizeBook(input = {}, { preserveId = true } = {}) {
  const base = emptyBook();
  const now = nowIso();
  const book = { ...base, ...input };
  const isbn13 = normalizeIsbn(book.isbn13);
  const isbn10 = normalizeIsbn(book.isbn10);
  const valid13 = isValidIsbn13(isbn13) ? isbn13 : "";
  const valid10 = isValidIsbn10(isbn10) ? isbn10 : "";
  const final13 = valid13 || (valid10 ? isbn10To13(valid10) : "");
  const final10 = valid10 || (final13 ? isbn13To10(final13) : "");

  const normalized = {
    ...base,
    ...book,
    ...(preserveId && Number(book.id) ? { id: Number(book.id) } : {}),
    created_at: book.created_at || now,
    updated_at: book.updated_at || now,
    internal_code: String(book.internal_code || "").trim().toUpperCase(),
    copy_number: safeNumber(book.copy_number, { min: 1, max: 999999 }) || 1,
    title: String(book.title || "").trim(),
    subtitle: String(book.subtitle || "").trim(),
    original_title: String(book.original_title || "").trim(),
    original_language: String(book.original_language || "").trim(),
    authors: uniqueStrings(Array.isArray(book.authors) ? book.authors : splitList(book.authors)),
    contributors: String(book.contributors || "").trim(),
    isbn13: final13,
    isbn10: final10,
    canonical_isbn: final13 || "",
    language: String(book.language || "").trim(),
    publication_year: safeNumber(book.publication_year, { min: 1000, max: 2200 }),
    publication_date: String(book.publication_date || "").trim(),
    publication_place: String(book.publication_place || "").trim(),
    edition: String(book.edition || "").trim(),
    printing: String(book.printing || "").trim(),
    series: String(book.series || "").trim(),
    series_number: String(book.series_number || "").trim(),
    pages: safeNumber(book.pages, { min: 1, max: 100000 }),
    publisher: String(book.publisher || "").trim(),
    dewey: String(book.dewey || "").trim(),
    categories: uniqueStrings(Array.isArray(book.categories) ? book.categories : splitList(book.categories)),
    binding: String(book.binding || "").trim(),
    dimensions: String(book.dimensions || "").trim(),
    room: String(book.room || "").trim(),
    shelf: String(book.shelf || "").trim(),
    catalog_status: CATALOG_STATUSES.includes(book.catalog_status)
      ? book.catalog_status
      : computeCatalogStatus(book),
    condition: String(book.condition || "").trim(),
    provenance: String(book.provenance || "").trim(),
    acquisition_date: String(book.acquisition_date || "").trim(),
    acquisition_source: String(book.acquisition_source || "").trim(),
    acquisition_price: String(book.acquisition_price || "").trim(),
    notes: String(book.notes || "").trim(),
    cover_url: String(book.cover_url || "").trim(),
    cover_id: String(book.cover_id || "").trim(),
    source: String(book.source || "").trim(),
    source_details: typeof book.source_details === "object" && book.source_details ? book.source_details : {},
    custom_fields: normalizeCustomFields(book.custom_fields),
  };
  normalized.search_text = buildSearchText(normalized);
  normalized.edition_fingerprint = editionFingerprint(normalized);
  return normalized;
}

export function normalizeCustomFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || "").trim();
    const text = String(rawValue ?? "").trim();
    if (key && text && !Object.prototype.hasOwnProperty.call(output, key)) output[key] = text;
  }
  return output;
}

export function validateBook(input, { requireTitle = true } = {}) {
  const book = normalizeBook(input);
  const errors = [];
  const warnings = [];

  if (requireTitle && !book.title) errors.push("Titolo mancante.");
  if (input.isbn13 && !book.isbn13) errors.push("ISBN-13 non valido.");
  if (input.isbn10 && !book.isbn10) errors.push("ISBN-10 non valido.");
  if (book.internal_code && !/^BIB-\d{6,}$/.test(book.internal_code)) {
    errors.push("Il codice inventario deve avere il formato BIB-000001.");
  }
  if (!book.authors.length) warnings.push("Autore non indicato.");
  if (!book.publisher) warnings.push("Editore non indicato.");
  if (!book.publication_year) warnings.push("Anno di pubblicazione non indicato.");
  if (!book.isbn13 && !book.isbn10) warnings.push("ISBN non indicato.");

  return { book, valid: errors.length === 0, errors, warnings };
}

export function migrateLegacyBook(input = {}) {
  return normalizeBook({
    ...input,
    copy_number: input.copy_number || 1,
    catalog_status: input.catalog_status || (/verific/i.test(String(input.source || "")) ? "Da verificare" : undefined),
    source_details: input.source_details || (input.source ? { legacy: input.source } : {}),
  });
}
