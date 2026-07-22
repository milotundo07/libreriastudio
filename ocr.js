import { CATALOG_PROXY_URL, COVER_MIN_RESULT_THRESHOLD } from "./config.js";
import { isbnCandidates, normalizeIsbn } from "./isbn.js";
import { normalizeText, splitList, uniqueStrings } from "./utils.js";

async function fetchJson(url, { timeout = 12000, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function parseGoogleVolume(item = {}) {
  const info = item.volumeInfo || {};
  const identifiers = info.industryIdentifiers || [];
  const getIdentifier = (type) => normalizeIsbn(identifiers.find((entry) => entry.type === type)?.identifier || "");
  return {
    title: info.title || "",
    subtitle: info.subtitle || "",
    authors: info.authors || [],
    isbn13: getIdentifier("ISBN_13"),
    isbn10: getIdentifier("ISBN_10"),
    publisher: info.publisher || "",
    publication_date: info.publishedDate || "",
    publication_year: String(info.publishedDate || "").match(/\b\d{4}\b/)?.[0] || "",
    pages: info.pageCount || "",
    language: info.language || "",
    categories: info.categories || [],
    cover_url: (info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.medium || info.imageLinks?.thumbnail || "")
      .replace(/^http:/, "https:")
      .replace("&zoom=1", "&zoom=2"),
    source: "Google Books",
    source_details: { google_books_id: item.id || "" },
  };
}

function parseOpenLibraryDoc(item = {}) {
  const isbns = (item.isbn || []).map(normalizeIsbn);
  return {
    title: item.title || "",
    subtitle: item.subtitle || "",
    authors: item.author_name || [],
    isbn13: isbns.find((value) => value.length === 13) || "",
    isbn10: isbns.find((value) => value.length === 10) || "",
    publisher: (item.publisher || []).slice(0, 3).join(", "),
    publication_date: item.publish_date?.[0] || "",
    publication_year: item.first_publish_year || "",
    pages: item.number_of_pages_median || "",
    language: item.language?.[0] || "",
    categories: (item.subject || []).slice(0, 15),
    cover_url: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : "",
    source: "Open Library",
    source_details: { open_library_key: item.key || "" },
  };
}

function parseSbnRecord(record = {}) {
  const rawTitle = String(record.titolo || "");
  const [titlePart, authorPart = ""] = rawTitle.split(/\s+\/\s+/, 2);
  const [title, subtitle = ""] = titlePart.split(" : ", 2);
  const publication = String(record.pubblicazione || "");
  const year = publication.match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/)?.[0] || "";
  const publisher = publication.includes(":")
    ? publication.slice(publication.indexOf(":") + 1).replace(/,\s*(1[5-9]\d{2}|20\d{2}|21\d{2}).*$/, "").trim()
    : "";
  const identifiers = Array.isArray(record.numeri) ? record.numeri.map((value) => normalizeIsbn(value)) : [];
  return {
    title: title?.trim() || rawTitle,
    subtitle: subtitle.trim(),
    authors: [record.autorePrincipale || authorPart].filter(Boolean),
    isbn13: identifiers.find((value) => value.length === 13) || "",
    isbn10: identifiers.find((value) => value.length === 10) || "",
    publisher,
    publication_date: year,
    publication_year: year,
    pages: "",
    language: "it",
    categories: [],
    cover_url: String(record.copertina || "").replace(/^http:/, "https:"),
    source: "SBN",
    source_details: { bid: record.bid || record.id || "" },
  };
}

async function queryGoogle(query, { signal, maxResults = 20 } = {}) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=${maxResults}&printType=books`;
  const data = await fetchJson(url, { signal });
  return (data.items || []).map(parseGoogleVolume).filter((book) => book.title);
}

async function queryOpenLibrary(params, { signal, limit = 20 } = {}) {
  const fields = [
    "key", "title", "subtitle", "author_name", "isbn", "publisher", "publish_date",
    "first_publish_year", "number_of_pages_median", "language", "cover_i", "subject",
  ].join(",");
  const search = new URLSearchParams({ ...params, fields, limit: String(limit) });
  const data = await fetchJson(`https://openlibrary.org/search.json?${search}`, { signal });
  return (data.docs || []).map(parseOpenLibraryDoc).filter((book) => book.title);
}

async function querySbn(params, { signal } = {}) {
  const search = new URLSearchParams(params);
  const target = `https://opac.sbn.it/opacmobilegw/search.json?${search}`;
  const url = CATALOG_PROXY_URL
    ? `${CATALOG_PROXY_URL.replace(/\/$/, "")}?url=${encodeURIComponent(target)}`
    : target;
  const data = await fetchJson(url, { signal, timeout: 10000 });
  return (data.briefRecords || []).map(parseSbnRecord).filter((book) => book.title);
}

function valueScore(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value ? 1 : 0;
  return String(value || "").trim().length;
}

export function mergeMetadata(records = []) {
  const valid = records.filter(Boolean);
  if (!valid.length) return null;
  const sourcePriority = { SBN: 3, "Google Books": 2, "Open Library": 1 };
  const sorted = [...valid].sort((a, b) => (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0));
  const keys = [
    "title", "subtitle", "authors", "isbn13", "isbn10", "publisher", "publication_date",
    "publication_year", "pages", "language", "categories", "cover_url",
  ];
  const merged = {};
  for (const key of keys) {
    const options = sorted.map((record) => record[key]).filter((value) => valueScore(value) > 0);
    if (key === "authors" || key === "categories") merged[key] = uniqueStrings(options.flat());
    else if (key === "cover_url") merged[key] = options.find((value) => /googleusercontent|openlibrary|sbn/i.test(value)) || options[0] || "";
    else merged[key] = options.sort((a, b) => valueScore(b) - valueScore(a))[0] ?? "";
  }
  merged.source = uniqueStrings(sorted.map((record) => record.source)).join(" + ");
  merged.source_details = Object.assign({}, ...sorted.map((record) => record.source_details || {}));
  return merged;
}

export async function lookupByIsbn(rawIsbn, { signal } = {}) {
  const candidates = isbnCandidates(rawIsbn);
  if (!candidates.length) throw new Error("L’ISBN non supera il controllo della cifra finale.");
  const canonical = candidates.find((value) => value.length === 13) || candidates[0];
  const tasks = [
    queryGoogle(`isbn:${canonical}`, { signal, maxResults: 10 }),
    queryOpenLibrary({ isbn: canonical }, { signal, limit: 10 }),
    querySbn({ isbn: canonical }, { signal }).catch(() => []),
  ];
  const settled = await Promise.allSettled(tasks);
  const records = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const exact = records.filter((book) => {
    const values = [book.isbn13, book.isbn10].filter(Boolean);
    return values.some((value) => candidates.includes(value));
  });
  const merged = mergeMetadata(exact.length ? exact : records);
  if (!merged?.title) throw new Error("Nessuna edizione attendibile trovata nei cataloghi.");
  return { ...merged, confidence: exact.length ? 1 : 0.65 };
}

function tokenCoverage(expected, actual) {
  const expectedTokens = uniqueStrings(normalizeText(expected).split(" "));
  if (!expectedTokens.length) return 0;
  const actualTokens = new Set(normalizeText(actual).split(" "));
  return expectedTokens.filter((token) => actualTokens.has(token)).length / expectedTokens.length;
}

function inferIdentity(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3 && line.length <= 100);
  const scored = lines.map((line, index) => {
    const words = normalizeText(line).split(" ").filter(Boolean);
    const letters = line.match(/[A-Za-zÀ-ÿ]/g) || [];
    const uppercase = line.match(/[A-ZÀ-Ý]/g) || [];
    const ratio = letters.length ? uppercase.length / letters.length : 0;
    return { line, index, words, score: (ratio > 0.65 ? 4 : 0) + (words.length <= 7 ? 3 : 0) + (index < 6 ? 2 : 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const title = scored[0]?.line || lines[0] || "";
  const author = scored.find((entry) => entry.line !== title && entry.words.length >= 2 && entry.words.length <= 5)?.line || "";
  return { title, author, query: [title, author].filter(Boolean).join(" ") };
}

export function scoreCatalogCandidate(book, ocrText, identity = inferIdentity(ocrText)) {
  const title = `${book.title || ""} ${book.subtitle || ""}`;
  const authors = (book.authors || []).join(" ");
  const titleForward = tokenCoverage(identity.title, title);
  const titleReverse = tokenCoverage(title, identity.title || ocrText);
  const authorScore = identity.author
    ? Math.max(tokenCoverage(identity.author, authors), tokenCoverage(authors, identity.author))
    : tokenCoverage(authors, ocrText);
  const general = tokenCoverage(`${title} ${authors}`, ocrText);
  const sourceBonus = book.source === "SBN" ? 0.03 : 0;
  return Math.min(1, titleForward * 0.48 + titleReverse * 0.18 + authorScore * 0.24 + general * 0.1 + sourceBonus);
}

export async function searchByCoverText(ocrText, { signal } = {}) {
  const identity = inferIdentity(ocrText);
  if (normalizeText(identity.query).split(" ").filter(Boolean).length < 2) {
    throw new Error("Il testo letto è troppo breve per una ricerca attendibile.");
  }
  const googleQuery = identity.title && identity.author
    ? `intitle:${identity.title} inauthor:${identity.author}`
    : identity.query;
  const tasks = [
    queryGoogle(googleQuery, { signal }),
    queryOpenLibrary(identity.title
      ? { title: identity.title, ...(identity.author ? { author: identity.author } : {}) }
      : { q: identity.query }, { signal }),
    querySbn({ any: identity.query, type: "0", start: "0", rows: "20" }, { signal }).catch(() => []),
  ];
  const settled = await Promise.allSettled(tasks);
  const all = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const seen = new Set();
  const results = all
    .filter((book) => {
      const key = [normalizeText(book.title), normalizeText((book.authors || [])[0]), book.publication_year || ""].join("|");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((book) => ({ ...book, confidence: scoreCatalogCandidate(book, ocrText, identity) }))
    .filter((book) => book.confidence >= COVER_MIN_RESULT_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  return { identity, results };
}

export function metadataFromOcr(text) {
  const identity = inferIdentity(text);
  return {
    title: identity.title || "Titolo da verificare",
    authors: identity.author ? splitList(identity.author) : [],
    source: "OCR copertina · dati da verificare",
    catalog_status: "Da verificare",
    notes: "Scheda creata dal testo della copertina. Verificare edizione, editore e anno.",
    custom_fields: { "Testo OCR": String(text).slice(0, 2000) },
  };
}
