const DB_NAME = "bibliotecaStudioDB";
const DB_VERSION = 1;
const STORE_NAME = "books";

const state = {
  books: [],
  scanner: null,
  searchTimer: null,
  coverWorker: null,
  coverPhotoDataUrl: "",
  coverResults: [],
};

const $ = (selector) => document.querySelector(selector);
const booksGrid = $("#booksGrid");
const emptyState = $("#emptyState");
const bookDialog = $("#bookDialog");
const scannerDialog = $("#scannerDialog");
const coverDialog = $("#coverDialog");
const bookForm = $("#bookForm");


const OPTIONAL_SCRIPTS = {
  scanner: {
    url: "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
    globalName: "Html5Qrcode",
  },
  ocr: {
    url: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    globalName: "Tesseract",
  },
};

const scriptLoads = new Map();

function loadOptionalScript(name) {
  const config = OPTIONAL_SCRIPTS[name];
  if (!config) return Promise.reject(new Error("Modulo sconosciuto."));
  if (window[config.globalName]) return Promise.resolve(window[config.globalName]);
  if (scriptLoads.has(name)) return scriptLoads.get(name);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = config.url;
    script.async = true;
    script.onload = () => {
      if (window[config.globalName]) resolve(window[config.globalName]);
      else reject(new Error(`Il modulo ${name} è stato scaricato ma non inizializzato.`));
    };
    script.onerror = () => reject(new Error(`Impossibile caricare il modulo ${name}.`));
    document.head.appendChild(script);
  }).catch((error) => {
    scriptLoads.delete(name);
    throw error;
  });

  scriptLoads.set(name, promise);
  return promise;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("isbn13", "isbn13", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbSave(book) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = book.id ? store.put(book) : store.add(book);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbDelete(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).delete(Number(id));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbClear() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("visible");
  clearTimeout(element.timer);
  element.timer = setTimeout(() => element.classList.remove("visible"), 3200);
}

function normalizeIsbn(raw) {
  return String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function isbn13To10(isbn13) {
  const value = normalizeIsbn(isbn13);
  if (value.length !== 13 || !value.startsWith("978")) return "";

  const core = value.slice(3, 12);
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(core[index]) * (10 - index);
  }
  const remainder = 11 - (sum % 11);
  const check = remainder === 10 ? "X" : remainder === 11 ? "0" : String(remainder);
  return core + check;
}

function isbn10To13(isbn10) {
  const value = normalizeIsbn(isbn10);
  if (value.length !== 10) return "";

  const core = "978" + value.slice(0, 9);
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(core[index]) * (index % 2 === 0 ? 1 : 3);
  }
  const check = String((10 - (sum % 10)) % 10);
  return core + check;
}

function isbnCandidates(raw) {
  const value = normalizeIsbn(raw);
  const candidates = new Set([value]);

  if (value.length === 13) {
    const isbn10 = isbn13To10(value);
    if (isbn10) candidates.add(isbn10);
  } else if (value.length === 10) {
    const isbn13 = isbn10To13(value);
    if (isbn13) candidates.add(isbn13);
  }

  return [...candidates].filter(Boolean);
}


function nextInternalCode() {
  const highest = state.books.reduce((maximum, book) => {
    const match = String(book.internal_code || "").match(/^BIB-(\d+)$/i);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `BIB-${String(highest + 1).padStart(6, "0")}`;
}

function normalizeCatalogText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COVER_STOP_WORDS = new Set([
  "a", "al", "alla", "alle", "allo", "ai", "agli", "all", "anche", "che", "con", "da", "dal", "dalla",
  "dalle", "dei", "del", "della", "delle", "di", "e", "ed", "gli", "i", "il", "in", "la", "le", "lo",
  "nel", "nella", "nelle", "non", "o", "per", "su", "sul", "sulla", "tra", "un", "una", "uno",
  "the", "of", "and", "a", "an", "by", "for", "from", "in", "on", "to", "with",
  "biblioteca", "collana", "edizioni", "editore", "edition", "volume"
]);

function textTokens(value = "") {
  return normalizeCatalogText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !COVER_STOP_WORDS.has(token));
}

function buildCoverSearchQuery(ocrText) {
  const lines = String(ocrText)
    .split(/\r?\n/)
    .map((line, index) => ({
      raw: line.trim(),
      index,
    }))
    .filter((line) => line.raw.length >= 3 && line.raw.length <= 90)
    .map((line) => {
      const letters = line.raw.match(/[A-Za-zÀ-ÿ]/g) || [];
      const uppercase = line.raw.match(/[A-ZÀ-Ý]/g) || [];
      const uppercaseRatio = letters.length ? uppercase.length / letters.length : 0;
      const words = textTokens(line.raw);
      let score = 0;
      if (uppercaseRatio > 0.7) score += 5;
      if (words.length >= 1 && words.length <= 7) score += 3;
      if (line.index < 8) score += 2;
      if (line.raw.length > 45) score -= 3;
      return { ...line, words, score };
    })
    .filter((line) => line.words.length);

  const chosen = lines
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 7)
    .sort((a, b) => a.index - b.index);

  const tokens = [];
  for (const line of chosen) {
    for (const token of line.words) {
      if (!tokens.includes(token)) tokens.push(token);
      if (tokens.length >= 14) break;
    }
    if (tokens.length >= 14) break;
  }

  if (tokens.length < 3) {
    for (const token of textTokens(ocrText)) {
      if (!tokens.includes(token)) tokens.push(token);
      if (tokens.length >= 14) break;
    }
  }

  return tokens.join(" ");
}


const COVER_PUBLISHER_WORDS = new Set([
  "adelphi", "bompiani", "boringhieri", "bur", "einaudi", "feltrinelli", "garzanti",
  "laterza", "mondadori", "rizzoli", "sellerio", "utET", "zanichelli", "penguin",
  "oxford", "cambridge", "faber", "vintage", "gallimard", "seuil", "flammarion"
].map((word) => normalizeCatalogText(word)));

function uppercaseRatio(value = "") {
  const letters = String(value).match(/[A-Za-zÀ-ÿ]/g) || [];
  const uppercase = String(value).match(/[A-ZÀ-Ý]/g) || [];
  return letters.length ? uppercase.length / letters.length : 0;
}

function cleanCoverLines(ocrText) {
  return String(ocrText)
    .split(/\r?\n/)
    .map((raw, index) => {
      const cleaned = raw
        .replace(/[|_[\]{}<>]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9'’:\-]+$/g, "")
        .trim();
      return {
        raw: cleaned,
        index,
        tokens: textTokens(cleaned),
        uppercase: uppercaseRatio(cleaned),
      };
    })
    .filter((line) => {
      const letters = line.raw.match(/[A-Za-zÀ-ÿ]/g) || [];
      return letters.length >= 3 && line.raw.length <= 100;
    });
}

function isPublisherOrSeriesLine(line) {
  const normalized = normalizeCatalogText(line.raw);
  if (/\b(biblioteca|collana|edizioni|editore|classici|tascabili|paperbacks?)\b/.test(normalized)) {
    return true;
  }
  return line.tokens.some((token) => COVER_PUBLISHER_WORDS.has(token));
}

function smartCase(value, person = false) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (uppercaseRatio(source) < 0.65) return source;

  const lowerWords = new Set([
    "a", "al", "alla", "alle", "allo", "ai", "agli", "con", "da", "dal", "dalla",
    "dei", "del", "della", "delle", "di", "e", "ed", "gli", "i", "il", "in", "la",
    "le", "lo", "nel", "nella", "o", "per", "su", "sul", "sulla", "the", "of", "and"
  ]);

  return source
    .toLocaleLowerCase("it")
    .split(/\s+/)
    .map((word, index) => {
      if (!person && index > 0 && lowerWords.has(word)) return word;
      return word.replace(/(^|[-'’])([a-zà-ÿ])/g, (_, prefix, letter) =>
        prefix + letter.toLocaleUpperCase("it")
      );
    })
    .join(" ");
}

function personLineScore(line, totalLines) {
  if (!line.tokens.length || line.tokens.length > 5) return -100;
  if (isPublisherOrSeriesLine(line)) return -100;
  if (/\d/.test(line.raw)) return -20;

  let score = 0;
  if (line.index <= 2) score += 5;
  if (line.tokens.length >= 2 && line.tokens.length <= 4) score += 5;
  if (line.uppercase >= 0.7) score += 3;
  if (line.raw.length <= 42) score += 2;
  if (line.index >= totalLines - 2) score += 1;

  const titleConnectors = /\b(romanzo|racconti|conferenze|storia|introduzione|trattato|manuale|saggi|poesie|psicoanalisi)\b/i;
  if (titleConnectors.test(line.raw)) score -= 5;
  return score;
}

function extractCoverIdentity(ocrText) {
  const lines = cleanCoverLines(ocrText);
  if (!lines.length) {
    return { title: "", author: "", publisher: "", searchText: "" };
  }

  const publisherLine = lines.find(isPublisherOrSeriesLine) || null;
  const authorLine = [...lines]
    .map((line) => ({ line, score: personLineScore(line, lines.length) }))
    .sort((a, b) => b.score - a.score || a.line.index - b.line.index)[0];

  const author = authorLine?.score >= 7 ? smartCase(authorLine.line.raw, true) : "";
  const authorIndex = author ? authorLine.line.index : -1;

  let titleLines = [];
  if (authorIndex >= 0) {
    titleLines = lines.filter((line) =>
      line.index > authorIndex &&
      line.index <= authorIndex + 4 &&
      !isPublisherOrSeriesLine(line)
    );
    if (!titleLines.length) {
      titleLines = lines.filter((line) =>
        line.index < authorIndex &&
        line.index >= Math.max(0, authorIndex - 3) &&
        !isPublisherOrSeriesLine(line)
      );
    }
  }

  if (!titleLines.length) {
    titleLines = lines
      .filter((line) => !isPublisherOrSeriesLine(line) && line.raw !== authorLine?.line.raw)
      .map((line) => {
        let score = line.tokens.length * 2;
        if (line.uppercase >= 0.65) score += 3;
        if (line.index <= 5) score += 2;
        if (line.raw.length >= 10 && line.raw.length <= 70) score += 2;
        return { ...line, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 3)
      .sort((a, b) => a.index - b.index);
  }

  const title = smartCase(
    titleLines
      .slice(0, 4)
      .map((line) => line.raw)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  );

  let publisher = "";
  if (publisherLine) {
    publisher = smartCase(
      publisherLine.raw
        .replace(/\b(biblioteca|collana|edizioni|editore|classici|tascabili)\b/ig, "")
        .trim(),
      true
    );
  }

  const fallbackQuery = buildCoverSearchQuery(ocrText);
  return {
    title,
    author,
    publisher,
    searchText: [title, author].filter(Boolean).join(" ") || fallbackQuery,
    fallbackQuery,
    rawLines: lines.map((line) => line.raw),
  };
}

function tokenCoverage(expected, actual) {
  const expectedTokens = [...new Set(textTokens(expected))];
  if (!expectedTokens.length) return 0;
  const actualTokens = new Set(textTokens(actual));
  const matched = expectedTokens.filter((token) => actualTokens.has(token)).length;
  return matched / expectedTokens.length;
}

function metadataFromCoverIdentity(identity, photoDataUrl) {
  return {
    title: identity.title || "Titolo da verificare",
    subtitle: "",
    authors: identity.author ? [identity.author] : [],
    isbn13: "",
    isbn10: "",
    publisher: identity.publisher || "",
    publication_date: "",
    publication_year: "",
    pages: "",
    language: "it",
    cover_url: photoDataUrl || "",
    categories: [],
    source: "OCR copertina · dati da verificare",
  };
}


function jsonp(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__bookLookup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const separator = url.includes("?") ? "&" : "?";
    let finished = false;

    const cleanup = () => {
      if (script.parentNode) script.remove();
      try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
    };

    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("Il catalogo non ha risposto in tempo."));
    }, timeoutMs);

    window[callbackName] = (data) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("Impossibile contattare il catalogo."));
    };

    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
    script.async = true;
    document.head.appendChild(script);
  });
}


function effectiveCatalogStatus(book) {
  if (book.catalog_status) return book.catalog_status;
  if (String(book.source || "").toLowerCase().includes("verificare")) return "Da verificare";
  if (book.title && (book.authors || []).length && book.publisher && book.publication_year) {
    return "Completa";
  }
  return "Incompleta";
}

async function ensureInternalCodes(books) {
  const used = new Set();
  let maxNumber = 0;

  for (const book of books) {
    const code = String(book.internal_code || "").toUpperCase();
    const match = code.match(/^BIB-(\d{6})$/);
    if (match) {
      used.add(code);
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  }

  for (const book of books) {
    if (book.internal_code) continue;
    do {
      maxNumber += 1;
      book.internal_code = `BIB-${String(maxNumber).padStart(6, "0")}`;
    } while (used.has(book.internal_code));
    used.add(book.internal_code);
    await dbSave(book);
  }

  return books;
}

function bookCard(book) {
  const cover = book.cover_url
    ? `<img src="${escapeHtml(book.cover_url)}" alt="Copertina di ${escapeHtml(book.title)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'"><div class="card-cover-placeholder" style="display:none">Nessuna copertina</div>`
    : `<div class="card-cover-placeholder">Nessuna copertina</div>`;
  const authors = (book.authors || []).join(", ") || "Autore non indicato";
  const location = [book.room, book.shelf].filter(Boolean).join(" · ");
  const edition = [book.series, book.series_number ? `n. ${book.series_number}` : "", book.edition]
    .filter(Boolean)
    .join(" · ");
  const status = effectiveCatalogStatus(book);

  return `
    <article class="book-card">
      <div>${cover}</div>
      <div>
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(authors)}</p>
        <p>${escapeHtml([book.publisher, book.publication_place, book.publication_year].filter(Boolean).join(", "))}</p>
        ${edition ? `<p>${escapeHtml(edition)}</p>` : ""}
        ${location ? `<p>${escapeHtml(location)}</p>` : ""}
        <div class="book-meta">
          <span class="pill">${escapeHtml(status)}</span>
          ${book.internal_code ? `<span class="pill">${escapeHtml(book.internal_code)}</span>` : ""}
          ${book.dewey ? `<span class="pill">Dewey ${escapeHtml(book.dewey)}</span>` : ""}
          ${book.isbn13 ? `<span class="pill">ISBN ${escapeHtml(book.isbn13)}</span>` : ""}
        </div>
        <div class="card-actions">
          <button data-edit="${book.id}">Modifica</button>
        </div>
      </div>
    </article>`;
}

function filteredBooks() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const status = $("#statusFilter").value;
  const sort = $("#sortSelect").value;

  const filtered = state.books.filter((book) => {
    const haystack = [
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
      book.series,
      book.series_number,
      book.edition,
      book.printing,
      book.dewey,
      ...(book.categories || []),
      book.binding,
      book.provenance,
      book.acquisition_source,
      book.room,
      book.shelf,
      book.notes,
    ].filter(Boolean).join(" ").toLowerCase();

    return (!query || haystack.includes(query)) &&
      (!status || effectiveCatalogStatus(book) === status);
  });

  filtered.sort((a, b) => {
    if (sort === "author") {
      return ((a.authors || [""])[0] || "").localeCompare((b.authors || [""])[0] || "", "it");
    }
    if (sort === "publisher") {
      return String(a.publisher || "").localeCompare(String(b.publisher || ""), "it");
    }
    if (sort === "code") {
      return String(a.internal_code || "").localeCompare(String(b.internal_code || ""), "it");
    }
    if (sort === "year_desc") {
      return Number(b.publication_year || 0) - Number(a.publication_year || 0);
    }
    if (sort === "added_desc") {
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    }
    return String(a.title || "").localeCompare(String(b.title || ""), "it");
  });

  return filtered;
}

function renderBooks() {
  const books = filteredBooks();
  booksGrid.innerHTML = books.map(bookCard).join("");
  emptyState.classList.toggle("hidden", books.length !== 0);
  booksGrid.classList.toggle("hidden", books.length === 0);
}

function renderStats() {
  const authors = new Set(
    state.books
      .flatMap((book) => book.authors || [])
      .map((name) => name.trim())
      .filter(Boolean)
  );

  $("#statTotal").textContent = state.books.length;
  $("#statAuthors").textContent = authors.size;
  $("#statNoIsbn").textContent = state.books.filter(
    (book) => !book.isbn13 && !book.isbn10
  ).length;
  $("#statVerify").textContent = state.books.filter(
    (book) => effectiveCatalogStatus(book) === "Da verificare"
  ).length;
}

async function refresh() {
  const loadedBooks = await dbGetAll();
  state.books = await ensureInternalCodes(loadedBooks);
  renderBooks();
  renderStats();
}

function setCover(url) {
  const image = $("#coverPreview");
  const placeholder = $("#coverPlaceholder");
  if (url) {
    image.src = url;
    image.classList.remove("hidden");
    placeholder.classList.add("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    placeholder.classList.remove("hidden");
  }
}

function addCustomField(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "custom-field-row";
  row.innerHTML = `
    <input class="custom-key" placeholder="Nome del campo" value="${escapeHtml(key)}">
    <input class="custom-value" placeholder="Valore" value="${escapeHtml(value)}">
    <button type="button" aria-label="Rimuovi campo">Rimuovi</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  $("#customFields").appendChild(row);
}

function resetForm() {
  bookForm.reset();
  $("#bookId").value = "";
  $("#createdAt").value = "";
  $("#internalCode").value = "";
  $("#catalogStatus").value = "Da verificare";
  $("#customFields").innerHTML = "";
  $("#deleteButton").classList.add("hidden");
  $("#formEyebrow").textContent = "NUOVO LIBRO";
  $("#formTitle").textContent = "Aggiungi libro";
  setCover("");
}

function fillForm(book = {}) {
  resetForm();
  const mapping = {
    id: "bookId",
    created_at: "createdAt",
    internal_code: "internalCode",
    title: "title",
    subtitle: "subtitle",
    original_title: "originalTitle",
    original_language: "originalLanguage",
    contributors: "contributors",
    isbn13: "isbn13",
    isbn10: "isbn10",
    language: "language",
    publication_year: "publicationYear",
    publication_date: "publicationDate",
    publication_place: "publicationPlace",
    edition: "edition",
    printing: "printing",
    series: "series",
    series_number: "seriesNumber",
    pages: "pages",
    publisher: "publisher",
    dewey: "dewey",
    binding: "binding",
    dimensions: "dimensions",
    room: "room",
    shelf: "shelf",
    condition: "condition",
    provenance: "provenance",
    acquisition_date: "acquisitionDate",
    acquisition_source: "acquisitionSource",
    acquisition_price: "acquisitionPrice",
    notes: "notes",
    cover_url: "coverUrl",
    source: "source",
  };

  Object.entries(mapping).forEach(([source, target]) => {
    if (book[source] !== undefined && book[source] !== null) {
      $("#" + target).value = book[source];
    }
  });

  $("#catalogStatus").value = effectiveCatalogStatus(book);
  $("#authors").value = (book.authors || []).join(", ");
  $("#categories").value = (book.categories || []).join(", ");
  Object.entries(book.custom_fields || {}).forEach(([key, value]) => addCustomField(key, value));
  setCover(book.cover_url || "");

  if (book.id) {
    $("#deleteButton").classList.remove("hidden");
    $("#formEyebrow").textContent = "SCHEDA LIBRO";
    $("#formTitle").textContent = "Modifica libro";
  }
}

function openBook(book = {}) {
  fillForm(book);
  bookDialog.showModal();
}

function collectForm() {
  const customFields = {};
  document.querySelectorAll(".custom-field-row").forEach((row) => {
    const key = row.querySelector(".custom-key").value.trim();
    const value = row.querySelector(".custom-value").value.trim();
    if (key) customFields[key] = value;
  });

  const id = Number($("#bookId").value) || undefined;
  return {
    ...(id ? { id } : {}),
    created_at: $("#createdAt").value || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    internal_code: $("#internalCode").value.trim(),
    title: $("#title").value.trim(),
    subtitle: $("#subtitle").value.trim(),
    original_title: $("#originalTitle").value.trim(),
    original_language: $("#originalLanguage").value.trim(),
    authors: $("#authors").value.split(",").map((value) => value.trim()).filter(Boolean),
    contributors: $("#contributors").value.trim(),
    isbn13: normalizeIsbn($("#isbn13").value),
    isbn10: normalizeIsbn($("#isbn10").value),
    language: $("#language").value.trim(),
    publication_year: $("#publicationYear").value ? Number($("#publicationYear").value) : "",
    publication_date: $("#publicationDate").value.trim(),
    publication_place: $("#publicationPlace").value.trim(),
    edition: $("#edition").value.trim(),
    printing: $("#printing").value.trim(),
    series: $("#series").value.trim(),
    series_number: $("#seriesNumber").value.trim(),
    pages: $("#pages").value ? Number($("#pages").value) : "",
    publisher: $("#publisher").value.trim(),
    dewey: $("#dewey").value.trim(),
    categories: $("#categories").value.split(",").map((value) => value.trim()).filter(Boolean),
    binding: $("#binding").value.trim(),
    dimensions: $("#dimensions").value.trim(),
    room: $("#room").value.trim(),
    shelf: $("#shelf").value.trim(),
    catalog_status: $("#catalogStatus").value,
    condition: $("#condition").value.trim(),
    provenance: $("#provenance").value.trim(),
    acquisition_date: $("#acquisitionDate").value,
    acquisition_source: $("#acquisitionSource").value.trim(),
    acquisition_price: $("#acquisitionPrice").value.trim(),
    notes: $("#notes").value.trim(),
    cover_url: $("#coverUrl").value.trim(),
    source: $("#source").value.trim(),
    custom_fields: customFields,
  };
}

async function closeScanner() {
  if (state.scanner) {
    try {
      if (typeof state.scanner.stop === "function") {
        await state.scanner.stop();
      }
    } catch (_) {}

    try {
      if (typeof state.scanner.clear === "function") {
        await Promise.resolve(state.scanner.clear());
      }
    } catch (_) {}

    state.scanner = null;
  }

  const reader = $("#reader");
  if (reader) reader.innerHTML = "";
  if (scannerDialog.open) scannerDialog.close();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Servizio bibliografico non disponibile.");
  return response.json();
}


async function fetchJsonTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Risposta HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchThroughCorsProxies(targetUrl) {
  const attempts = [
    targetUrl,
    `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
  ];

  const errors = [];
  for (const url of attempts) {
    try {
      return await fetchJsonTimeout(url);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(errors.join(" | "));
}

function splitTitleAndSubtitle(rawTitle = "") {
  const withoutResponsibility = String(rawTitle).split(/\s+\/\s+/)[0].trim();
  const separatorIndex = withoutResponsibility.indexOf(" : ");

  if (separatorIndex === -1) {
    return { title: withoutResponsibility, subtitle: "" };
  }

  return {
    title: withoutResponsibility.slice(0, separatorIndex).trim(),
    subtitle: withoutResponsibility.slice(separatorIndex + 3).trim(),
  };
}

function parseSbnPublication(rawPublication = "") {
  const text = String(rawPublication);
  const year = text.match(/\b(18|19|20)\d{2}\b/)?.[0] || "";

  let publisher = "";
  const colonIndex = text.indexOf(":");
  if (colonIndex !== -1) {
    publisher = text
      .slice(colonIndex + 1)
      .replace(/,\s*(18|19|20)\d{2}.*$/, "")
      .trim();
  }

  return { publisher, year };
}

function parseSbn(data, isbn) {
  const record = data?.briefRecords?.[0];
  if (!record) return null;

  const parsedTitle = splitTitleAndSubtitle(record.titolo || "");
  const publication = parseSbnPublication(record.pubblicazione || "");
  const authorFromTitle = String(record.titolo || "").split(/\s+\/\s+/)[1]?.trim() || "";
  const author = record.autorePrincipale || authorFromTitle;

  return {
    title: parsedTitle.title || record.titolo || "",
    subtitle: parsedTitle.subtitle,
    authors: author ? [author] : [],
    isbn13: isbn.length === 13 ? isbn : isbn10To13(isbn),
    isbn10: isbn.length === 10 ? isbn : isbn13To10(isbn),
    publisher: publication.publisher,
    publication_date: publication.year,
    publication_year: publication.year,
    pages: "",
    language: "",
    cover_url: String(record.copertina || "").replace(/^http:/, "https:"),
    categories: [],
    source: "SBN",
  };
}

async function lookupSbn(isbn) {
  const target =
    `https://opac.sbn.it/opacmobilegw/search.json?isbn=${encodeURIComponent(isbn)}`;
  const data = await fetchThroughCorsProxies(target);
  return parseSbn(data, isbn);
}

function parseOpenLibraryBooks(data, isbn) {
  const entry = data?.[`ISBN:${isbn}`];
  if (!entry) return null;

  const identifiers = entry.identifiers || {};
  return {
    title: entry.title || "",
    subtitle: entry.subtitle || "",
    authors: (entry.authors || []).map((author) => author.name).filter(Boolean),
    isbn13:
      (identifiers.isbn_13 || []).map(normalizeIsbn).find((value) => value.length === 13) ||
      (isbn.length === 13 ? isbn : isbn10To13(isbn)),
    isbn10:
      (identifiers.isbn_10 || []).map(normalizeIsbn).find((value) => value.length === 10) ||
      (isbn.length === 10 ? isbn : isbn13To10(isbn)),
    publisher: (entry.publishers || []).map((publisher) => publisher.name).filter(Boolean).join(", "),
    publication_date: entry.publish_date || "",
    publication_year: String(entry.publish_date || "").match(/\d{4}/)?.[0] || "",
    pages: entry.number_of_pages || "",
    language: "",
    cover_url: entry.cover?.large || entry.cover?.medium || entry.cover?.small || "",
    categories: (entry.subjects || []).slice(0, 12).map((subject) => subject.name).filter(Boolean),
    source: "Open Library",
  };
}

function parseOpenLibrarySearch(data, isbn) {
  const item = data.docs?.[0];
  if (!item) return null;

  const isbnValues = Array.isArray(item.isbn) ? item.isbn.map(normalizeIsbn) : [];
  const isbn13 = isbnValues.find((value) => value.length === 13) || (isbn.length === 13 ? isbn : "");
  const isbn10 = isbnValues.find((value) => value.length === 10) || (isbn.length === 10 ? isbn : "");

  return {
    title: item.title || "",
    subtitle: item.subtitle || "",
    authors: item.author_name || [],
    isbn13,
    isbn10,
    publisher: (item.publisher || []).slice(0, 3).join(", "),
    publication_date: item.publish_date?.[0] || "",
    publication_year: item.first_publish_year || "",
    pages: item.number_of_pages_median || "",
    language: item.language?.[0] || "",
    cover_url: item.cover_i
      ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`
      : (isbn13 || isbn10
          ? `https://covers.openlibrary.org/b/isbn/${isbn13 || isbn10}-L.jpg`
          : ""),
    categories: (item.subject || []).slice(0, 12),
    source: "Open Library",
  };
}

function parseGoogleBooks(data, isbn) {
  const item = data.items?.[0]?.volumeInfo;
  if (!item) return null;
  const identifiers = item.industryIdentifiers || [];
  const byType = (type) => identifiers.find((entry) => entry.type === type)?.identifier || "";

  return {
    title: item.title || "",
    subtitle: item.subtitle || "",
    authors: item.authors || [],
    isbn13: normalizeIsbn(byType("ISBN_13")) || (isbn.length === 13 ? isbn : ""),
    isbn10: normalizeIsbn(byType("ISBN_10")) || (isbn.length === 10 ? isbn : ""),
    publisher: item.publisher || "",
    publication_date: item.publishedDate || "",
    publication_year: String(item.publishedDate || "").match(/\d{4}/)?.[0] || "",
    pages: item.pageCount || "",
    language: item.language || "",
    cover_url: (item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail || "")
      .replace(/^http:/, "https:")
      .replace("&zoom=1", "&zoom=2"),
    categories: item.categories || [],
    source: "Google Books",
  };
}

async function lookupBook(isbn) {
  const normalized = normalizeIsbn(isbn);
  const existing = state.books.find(
    (book) =>
      normalizeIsbn(book.isbn13) === normalized ||
      normalizeIsbn(book.isbn10) === normalized
  );
  if (existing) return { existing: true, book: existing };

  const candidates = isbnCandidates(normalized);
  const failures = [];

  // 1. Google Books: fast and rich when the exact edition is indexed.
  for (const candidate of candidates) {
    try {
      const google = await jsonp(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${candidate}`)}&maxResults=5&printType=books`
      );
      const parsed = parseGoogleBooks(google, candidate);
      if (parsed?.title) return { existing: false, book: parsed };
    } catch (error) {
      failures.push(`Google Books: ${error.message}`);
    }
  }

  // 2. SBN: especially useful for Italian editions.
  for (const candidate of candidates) {
    try {
      const parsed = await lookupSbn(candidate);
      if (parsed?.title) return { existing: false, book: parsed };
    } catch (error) {
      failures.push(`SBN: ${error.message}`);
    }
  }

  // 3. Open Library Books API, which supports JSONP.
  for (const candidate of candidates) {
    try {
      const openLibrary = await jsonp(
        `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(`ISBN:${candidate}`)}&jscmd=data&format=json`
      );
      const parsed = parseOpenLibraryBooks(openLibrary, candidate);
      if (parsed?.title) return { existing: false, book: parsed };
    } catch (error) {
      failures.push(`Open Library Books: ${error.message}`);
    }
  }

  // 4. Open Library Search API through a CORS-capable request.
  for (const candidate of candidates) {
    try {
      const fields = [
        "title",
        "subtitle",
        "author_name",
        "isbn",
        "publisher",
        "publish_date",
        "first_publish_year",
        "number_of_pages_median",
        "language",
        "cover_i",
        "subject",
      ].join(",");

      const target =
        `https://openlibrary.org/search.json?isbn=${encodeURIComponent(candidate)}` +
        `&fields=${encodeURIComponent(fields)}&limit=5`;
      const openLibrary = await fetchThroughCorsProxies(target);
      const parsed = parseOpenLibrarySearch(openLibrary, candidate);
      if (parsed?.title) return { existing: false, book: parsed };
    } catch (error) {
      failures.push(`Open Library Search: ${error.message}`);
    }
  }

  // 5. Last-resort broad Google search, accepting only an exact identifier match.
  for (const candidate of candidates) {
    try {
      const google = await jsonp(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(candidate)}&maxResults=10&printType=books`
      );
      const items = google.items || [];
      const exactItem = items.find((entry) => {
        const identifiers = entry.volumeInfo?.industryIdentifiers || [];
        return identifiers.some(
          (identifier) => normalizeIsbn(identifier.identifier) === candidate
        );
      });

      if (exactItem) {
        const parsed = parseGoogleBooks({ items: [exactItem] }, candidate);
        if (parsed?.title) return { existing: false, book: parsed };
      }
    } catch (error) {
      failures.push(`Google Books ricerca estesa: ${error.message}`);
    }
  }

  const uniqueFailures = [...new Set(failures)];
  const detail = uniqueFailures.length
    ? ` Errori tecnici: ${uniqueFailures.join(" | ")}`
    : "";
  throw new Error(`Nessuna scheda trovata per ISBN ${normalized}.${detail}`);
}

function makeAutomaticBook(metadata, isbn) {
  const now = new Date().toISOString();
  const source = metadata.source || "";
  const catalogStatus =
    metadata.catalog_status ||
    (source.toLowerCase().includes("verificare") ? "Da verificare" : "Completa");

  return {
    created_at: now,
    updated_at: now,
    internal_code: nextInternalCode(),
    title: metadata.title || `Libro ISBN ${isbn}`,
    subtitle: metadata.subtitle || "",
    original_title: metadata.original_title || "",
    original_language: metadata.original_language || "",
    authors: metadata.authors || [],
    contributors: metadata.contributors || "",
    isbn13: metadata.isbn13 || (isbn.length === 13 ? isbn : ""),
    isbn10: metadata.isbn10 || (isbn.length === 10 ? isbn : ""),
    language: metadata.language || "",
    publication_year: metadata.publication_year || "",
    publication_date: metadata.publication_date || "",
    publication_place: metadata.publication_place || "",
    edition: metadata.edition || "",
    printing: metadata.printing || "",
    series: metadata.series || "",
    series_number: metadata.series_number || "",
    pages: metadata.pages || "",
    publisher: metadata.publisher || "",
    dewey: metadata.dewey || "",
    categories: metadata.categories || [],
    binding: metadata.binding || "",
    dimensions: metadata.dimensions || "",
    room: "",
    shelf: "",
    catalog_status: catalogStatus,
    condition: "",
    provenance: "",
    acquisition_date: "",
    acquisition_source: "",
    acquisition_price: "",
    notes: "",
    cover_url: metadata.cover_url || "",
    source,
    custom_fields: {},
  };
}

async function lookupIsbn(raw) {
  const code = normalizeIsbn(raw);
  const status = $("#scanStatus");

  if (![10, 13].includes(code.length)) {
    status.textContent = "Il codice letto non sembra un ISBN valido.";
    status.classList.add("error");
    toast("Il codice letto non è un ISBN-10 o ISBN-13 valido.", true);
    return;
  }

  status.classList.remove("error");
  status.textContent = `ISBN ${code} letto. Identificazione automatica in corso…`;

  try {
    const result = await lookupBook(code);

    if (result.existing) {
      await closeScanner();
      toast(`"${result.book.title}" è già presente nella biblioteca.`);
      return;
    }

    const book = makeAutomaticBook(result.book, code);
    await dbSave(book);
    await refresh();
    await closeScanner();

    toast(`"${book.title}" è stato riconosciuto e aggiunto automaticamente.`);
  } catch (error) {
    await closeScanner();
    openBook(code.length === 13 ? { isbn13: code } : { isbn10: code });
    toast(error?.message || "Impossibile identificare il libro.", true);
    console.error("Ricerca ISBN fallita:", error);
  }
}

async function startScanner() {
  const status = $("#scanStatus");
  status.textContent = "Avvio della fotocamera…";
  status.classList.remove("error");
  $("#manualIsbnInput").value = "";
  $("#reader").innerHTML = "";
  scannerDialog.showModal();

  try {
    await loadOptionalScript("scanner");
  } catch (error) {
    status.textContent = "Modulo scanner non disponibile. Puoi inserire l’ISBN manualmente qui sotto.";
    status.classList.add("error");
    console.error(error);
    return;
  }

  const formats = typeof Html5QrcodeSupportedFormats !== "undefined"
    ? [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
      ].filter((value) => Number.isInteger(value))
    : undefined;

  const scannerOptions = {
    useBarCodeDetectorIfSupported: false,
  };
  if (formats?.length) scannerOptions.formatsToSupport = formats;

  try {
    state.scanner = new Html5Qrcode("reader", scannerOptions);

    let handled = false;
    const qrbox = (viewfinderWidth, viewfinderHeight) => {
      const width = Math.max(220, Math.min(340, Math.floor(viewfinderWidth * 0.88)));
      const height = Math.max(90, Math.min(145, Math.floor(viewfinderHeight * 0.34)));
      return { width, height };
    };

    await state.scanner.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox,
      },
      (decodedText) => {
        if (handled) return;
        handled = true;

        const code = normalizeIsbn(decodedText);
        status.textContent = `ISBN ${code} letto. Identificazione automatica in corso…`;

        // Leave the scanner callback immediately. Stopping the camera while the
        // decoding callback is still awaited can stall on some mobile browsers.
        window.setTimeout(() => {
          void lookupIsbn(code);
        }, 0);
      },
      () => {}
    );

    status.textContent = "Inquadra l’intero codice a barre ISBN, mantenendo il telefono fermo.";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Errore sconosciuto");
    await closeScanner();
    scannerDialog.showModal();
    status.textContent = `Impossibile avviare la fotocamera: ${message}. Puoi inserire l’ISBN manualmente qui sotto.`;
    status.classList.add("error");
  }
}


async function imageToDataUrl(file, maxDimension = 1800, quality = 0.9) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Impossibile leggere la fotografia."));
      image.src = objectUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Moderate greyscale/contrast enhancement. It improves printed cover text
    // without turning every photograph into a police photocopy.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let index = 0; index < data.length; index += 4) {
      const grey = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      const contrasted = Math.max(0, Math.min(255, (grey - 128) * 1.35 + 128));
      data[index] = contrasted;
      data[index + 1] = contrasted;
      data[index + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function smallCoverDataUrl(file) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });
    const max = 700;
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function parseSbnCoverResult(record) {
  const parsedTitle = splitTitleAndSubtitle(record.titolo || "");
  const publication = parseSbnPublication(record.pubblicazione || "");
  const authorFromTitle = String(record.titolo || "").split(/\s+\/\s+/)[1]?.trim() || "";
  const author = record.autorePrincipale || authorFromTitle;
  const numbers = Array.isArray(record.numeri) ? record.numeri.map((value) => String(value)) : [];
  const isbn13 = numbers.map(normalizeIsbn).find((value) => value.length === 13) || "";
  const isbn10 = numbers.map(normalizeIsbn).find((value) => value.length === 10) || "";

  return {
    title: parsedTitle.title || record.titolo || "",
    subtitle: parsedTitle.subtitle,
    authors: author ? [author] : [],
    isbn13,
    isbn10,
    publisher: publication.publisher,
    publication_date: publication.year,
    publication_year: publication.year,
    pages: "",
    language: "it",
    cover_url: String(record.copertina || "").replace(/^http:/, "https:"),
    categories: [],
    source: "SBN",
  };
}

function parseOpenLibraryCoverDoc(item) {
  const isbnValues = Array.isArray(item.isbn) ? item.isbn.map(normalizeIsbn) : [];
  return {
    title: item.title || "",
    subtitle: item.subtitle || "",
    authors: item.author_name || [],
    isbn13: isbnValues.find((value) => value.length === 13) || "",
    isbn10: isbnValues.find((value) => value.length === 10) || "",
    publisher: (item.publisher || []).slice(0, 3).join(", "),
    publication_date: item.publish_date?.[0] || "",
    publication_year: item.first_publish_year || "",
    pages: item.number_of_pages_median || "",
    language: item.language?.[0] || "",
    cover_url: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : "",
    categories: (item.subject || []).slice(0, 12),
    source: "Open Library",
  };
}

function catalogCandidateScore(book, ocrText, identity = {}) {
  const titleText = `${book.title || ""} ${book.subtitle || ""}`.trim();
  const authorText = (book.authors || []).join(" ");
  const publisherText = book.publisher || "";

  const inferredTitleCoverage = tokenCoverage(identity.title || "", titleText);
  const reverseTitleCoverage = tokenCoverage(titleText, identity.title || ocrText);
  const authorCoverage = identity.author
    ? Math.max(
        tokenCoverage(identity.author, authorText),
        tokenCoverage(authorText, identity.author)
      )
    : tokenCoverage(authorText, ocrText);
  const publisherCoverage = identity.publisher
    ? tokenCoverage(identity.publisher, publisherText)
    : tokenCoverage(publisherText, ocrText);
  const generalCoverage = tokenCoverage(
    `${book.title || ""} ${authorText}`,
    ocrText
  );

  const sourceBonus = book.source === "SBN" ? 0.05 : 0;
  return Math.min(
    1,
    inferredTitleCoverage * 0.46 +
      reverseTitleCoverage * 0.16 +
      authorCoverage * 0.24 +
      publisherCoverage * 0.05 +
      generalCoverage * 0.09 +
      sourceBonus
  );
}

function deduplicateCoverResults(results) {
  const seen = new Set();
  return results.filter((book) => {
    const key = normalizeCatalogText(
      `${book.title}|${(book.authors || [""])[0]}|${book.publication_year || ""}`
    );
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchCatalogsByCoverText(ocrText) {
  const identity = extractCoverIdentity(ocrText);
  const broadQuery = buildCoverSearchQuery(ocrText);

  const queryVariants = [];
  const addQuery = (query) => {
    const cleaned = String(query || "").replace(/\s+/g, " ").trim();
    if (textTokens(cleaned).length >= 2 && !queryVariants.includes(cleaned)) {
      queryVariants.push(cleaned);
    }
  };

  addQuery([identity.title, identity.author].filter(Boolean).join(" "));
  addQuery(identity.title);
  addQuery([identity.author, identity.title].filter(Boolean).join(" "));
  addQuery(broadQuery);

  if (!queryVariants.length) {
    throw new Error("Non sono riuscito a ricavare titolo o autore dalla copertina.");
  }

  const collected = [];
  const failures = [];

  // SBN is especially useful for older Italian editions.
  for (const query of queryVariants.slice(0, 3)) {
    try {
      const target =
        `https://opac.sbn.it/opacmobilegw/search.json?any=${encodeURIComponent(query)}` +
        `&type=0&start=0&rows=20`;
      const data = await fetchThroughCorsProxies(target);
      for (const record of data?.briefRecords || []) {
        const parsed = parseSbnCoverResult(record);
        if (parsed.title) collected.push(parsed);
      }
    } catch (error) {
      failures.push(`SBN: ${error.message}`);
    }
  }

  // Use fielded Google Books queries when title and author were inferred.
  const googleQueries = [];
  if (identity.title && identity.author) {
    googleQueries.push(`intitle:"${identity.title}" inauthor:"${identity.author}"`);
  }
  if (identity.title) googleQueries.push(`intitle:"${identity.title}"`);
  googleQueries.push(...queryVariants);

  for (const query of [...new Set(googleQueries)].slice(0, 4)) {
    try {
      const data = await jsonp(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}` +
        `&maxResults=20&printType=books`
      );
      for (const item of data.items || []) {
        const parsed = parseGoogleBooks({ items: [item] }, "");
        if (parsed?.title) collected.push(parsed);
      }
    } catch (error) {
      failures.push(`Google Books: ${error.message}`);
    }
  }

  const openLibraryTargets = [];
  if (identity.title && identity.author) {
    openLibraryTargets.push(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(identity.title)}` +
      `&author=${encodeURIComponent(identity.author)}`
    );
  }
  if (identity.title) {
    openLibraryTargets.push(
      `https://openlibrary.org/search.json?title=${encodeURIComponent(identity.title)}`
    );
  }
  openLibraryTargets.push(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(queryVariants[0])}`
  );

  const fields = [
    "title", "subtitle", "author_name", "isbn", "publisher", "publish_date",
    "first_publish_year", "number_of_pages_median", "language", "cover_i", "subject"
  ].join(",");

  for (const baseTarget of [...new Set(openLibraryTargets)].slice(0, 3)) {
    try {
      const target = `${baseTarget}&fields=${encodeURIComponent(fields)}&limit=20`;
      const data = await fetchThroughCorsProxies(target);
      for (const item of data.docs || []) {
        const parsed = parseOpenLibraryCoverDoc(item);
        if (parsed.title) collected.push(parsed);
      }
    } catch (error) {
      failures.push(`Open Library: ${error.message}`);
    }
  }

  const ranked = deduplicateCoverResults(collected)
    .map((book) => ({
      ...book,
      match_score: catalogCandidateScore(book, ocrText, identity),
    }))
    .filter((book) => book.match_score >= 0.10)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 8);

  return {
    identity,
    results: ranked,
    failures: [...new Set(failures)],
  };
}

function renderCoverResults(results) {
  const container = $("#coverResults");
  container.innerHTML = results.map((book, index) => {
    const cover = book.cover_url
      ? `<img src="${escapeHtml(book.cover_url)}" alt="" onerror="this.outerHTML='<div class=&quot;cover-result-placeholder&quot;>Nessuna copertina</div>'">`
      : '<div class="cover-result-placeholder">Nessuna copertina</div>';
    const authors = (book.authors || []).join(", ") || "Autore non indicato";
    const publication = [book.publisher, book.publication_year].filter(Boolean).join(", ");
    return `
      <article class="cover-result">
        ${cover}
        <div>
          <h4>${escapeHtml(book.title)}</h4>
          <p>${escapeHtml(authors)}</p>
          ${publication ? `<p>${escapeHtml(publication)}</p>` : ""}
          <p>${escapeHtml(book.source || "Catalogo")} · corrispondenza ${Math.round((book.match_score || 0) * 100)}%</p>
        </div>
        <button class="button primary" type="button" data-cover-choice="${index}">Aggiungi questo</button>
      </article>`;
  }).join("");
  $("#coverResultsSection").classList.remove("hidden");
}


async function saveRecognizedCoverBook(metadata, originalOcrText = "") {
  const sameBook = state.books.find((book) =>
    normalizeCatalogText(book.title) === normalizeCatalogText(metadata.title) &&
    normalizeCatalogText((book.authors || [""])[0]) ===
      normalizeCatalogText((metadata.authors || [""])[0]) &&
    (
      !metadata.publication_year ||
      !book.publication_year ||
      String(book.publication_year) === String(metadata.publication_year)
    )
  );

  if (sameBook) {
    coverDialog.close();
    toast(`"${sameBook.title}" sembra già presente nella biblioteca.`, true);
    return sameBook;
  }

  const book = makeAutomaticBook(
    metadata,
    metadata.isbn13 || metadata.isbn10 || ""
  );
  book.internal_code = nextInternalCode();
  book.cover_url = metadata.cover_url || state.coverPhotoDataUrl;
  book.source = metadata.source || "Riconoscimento copertina";

  if (book.source.includes("dati da verificare")) {
    book.notes =
      "Scheda creata automaticamente dal testo della copertina. " +
      "Controllare edizione, anno ed editore quando possibile.";
    book.custom_fields = {
      ...(book.custom_fields || {}),
      "Testo OCR": String(originalOcrText || "").slice(0, 1200),
    };
  }

  await dbSave(book);
  await refresh();
  coverDialog.close();
  toast(`"${book.title}" è stato aggiunto automaticamente con codice ${book.internal_code}.`);
  return book;
}

async function addCoverResult(index) {
  const metadata = state.coverResults[index];
  if (!metadata) return;
  await saveRecognizedCoverBook(metadata, $("#ocrText").textContent || "");
}

function resetCoverRecognition() {
  $("#coverPhotoInput").value = "";
  $("#coverPhotoPreview").removeAttribute("src");
  $("#coverPreviewPanel").classList.add("hidden");
  $("#coverResultsSection").classList.add("hidden");
  $("#coverResults").innerHTML = "";
  $("#ocrDetails").classList.add("hidden");
  $("#ocrText").textContent = "";
  $("#coverProgress").classList.add("hidden");
  $("#coverProgress").value = 0;
  $("#coverStatus").textContent = "Foto pronta.";
  state.coverPhotoDataUrl = "";
  state.coverResults = [];
}

function openCoverRecognition() {
  resetCoverRecognition();
  coverDialog.showModal();
}

async function recognizeCoverPhoto(file) {
  const status = $("#coverStatus");
  const progress = $("#coverProgress");
  const input = $("#coverPhotoInput");
  input.disabled = true;
  $("#coverResultsSection").classList.add("hidden");

  try {
    await loadOptionalScript("ocr");

    state.coverPhotoDataUrl = await smallCoverDataUrl(file);
    $("#coverPhotoPreview").src = state.coverPhotoDataUrl;
    $("#coverPreviewPanel").classList.remove("hidden");

    status.textContent = "Preparo la fotografia…";
    progress.classList.remove("hidden");
    progress.value = 0.03;
    const ocrImage = await imageToDataUrl(file);

    status.textContent = "Leggo titolo e autore dalla copertina…";
    state.coverWorker = await Tesseract.createWorker("ita+eng", 1, {
      logger: (message) => {
        if (typeof message.progress === "number") {
          progress.value = Math.max(progress.value, message.progress);
        }
        if (message.status === "recognizing text") {
          status.textContent = `Leggo la copertina… ${Math.round((message.progress || 0) * 100)}%`;
        }
      },
    });
    await state.coverWorker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });
    const result = await state.coverWorker.recognize(ocrImage);
    await state.coverWorker.terminate();
    state.coverWorker = null;

    const text = result?.data?.text?.trim() || "";
    if (textTokens(text).length < 2) {
      throw new Error("Non riesco a leggere titolo e autore. Fotografa la copertina più dritta e con più luce.");
    }

    $("#ocrText").textContent = text;
    $("#ocrDetails").classList.remove("hidden");
    status.textContent = "Cerco il libro nei cataloghi…";
    progress.value = 1;

    const catalogSearch = await searchCatalogsByCoverText(text);
    state.coverResults = catalogSearch.results;

    if (catalogSearch.results.length) {
      const best = catalogSearch.results[0];
      status.textContent = `Riconosciuto: ${best.title}. Aggiungo il libro…`;
      await saveRecognizedCoverBook(best, text);
      return;
    }

    const fallback = metadataFromCoverIdentity(
      catalogSearch.identity,
      state.coverPhotoDataUrl
    );
    status.textContent =
      `Nessuna edizione esatta trovata. Creo la scheda da "${fallback.title}"…`;
    await saveRecognizedCoverBook(fallback, text);
  } catch (error) {
    status.textContent = error?.message || "Riconoscimento non riuscito.";
    status.classList.add("error");
    toast(status.textContent, true);
    console.error("Riconoscimento copertina fallito:", error);
    if (state.coverWorker) {
      try { await state.coverWorker.terminate(); } catch (_) {}
      state.coverWorker = null;
    }
  } finally {
    progress.classList.add("hidden");
    input.disabled = false;
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const EXCEL_COLUMNS = [
  { header: "Codice inventario", key: "internal_code" },
  { header: "Titolo", key: "title" },
  { header: "Sottotitolo", key: "subtitle" },
  { header: "Titolo originale", key: "original_title" },
  { header: "Autori", key: "authors", kind: "list" },
  { header: "Traduttore / curatore / altri responsabili", key: "contributors" },
  { header: "ISBN-13", key: "isbn13" },
  { header: "ISBN-10", key: "isbn10" },
  { header: "Editore", key: "publisher" },
  { header: "Luogo di pubblicazione", key: "publication_place" },
  { header: "Anno di pubblicazione", key: "publication_year", kind: "number" },
  { header: "Data completa di pubblicazione", key: "publication_date" },
  { header: "Edizione", key: "edition" },
  { header: "Ristampa / tiratura", key: "printing" },
  { header: "Collana", key: "series" },
  { header: "Numero nella collana", key: "series_number" },
  { header: "Lingua", key: "language" },
  { header: "Lingua originale", key: "original_language" },
  { header: "Numero di pagine", key: "pages", kind: "number" },
  { header: "Classificazione Dewey", key: "dewey" },
  { header: "Categorie / soggetti", key: "categories", kind: "list" },
  { header: "Formato / legatura", key: "binding" },
  { header: "Dimensioni", key: "dimensions" },
  { header: "Stanza", key: "room" },
  { header: "Scaffale", key: "shelf" },
  { header: "Stato della scheda", key: "catalog_status" },
  { header: "Condizione fisica", key: "condition" },
  { header: "Provenienza / dedica / ex libris", key: "provenance" },
  { header: "Data di acquisizione", key: "acquisition_date" },
  { header: "Fonte o luogo di acquisto", key: "acquisition_source" },
  { header: "Prezzo di acquisizione", key: "acquisition_price" },
  { header: "URL copertina", key: "cover_url" },
  { header: "Fonte dei dati bibliografici", key: "source" },
  { header: "Note catalografiche", key: "notes" },
  { header: "Data inserimento", key: "created_at" },
  { header: "Ultima modifica", key: "updated_at" },
];

const EXTRA_COLUMN_PREFIX = "Extra · ";

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function excelColumnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function excelColumnIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function excelCellValue(value, kind = "") {
  if (kind === "list") {
    return Array.isArray(value) ? value.join("; ") : String(value || "");
  }
  if (kind === "number") {
    const number = Number(value);
    return value !== "" && value !== null && value !== undefined && Number.isFinite(number)
      ? number
      : "";
  }
  return value ?? "";
}

function excelColumnWidth(header) {
  if (["Titolo", "Sottotitolo", "Autori", "Note catalografiche"].includes(header)) return 34;
  if (header.startsWith(EXTRA_COLUMN_PREFIX)) return 28;
  if (["ISBN-13", "ISBN-10", "Codice inventario", "Anno di pubblicazione"].includes(header)) return 18;
  return Math.max(14, Math.min(27, header.length + 2));
}

function xlsxCellXml(reference, value, style = 2) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  const text = String(value ?? "");
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function xlsxSheetXml(rows, widths, options = {}) {
  const lastColumn = excelColumnName(Math.max(0, (rows[0]?.length || 1) - 1));
  const lastRow = Math.max(1, rows.length);
  const columns = widths.map((width, index) =>
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  ).join("");

  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      xlsxCellXml(`${excelColumnName(columnIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 2)
    ).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");

  const freeze = options.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = options.filter ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${freeze}
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rowXml}</sheetData>
  ${filter}
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function xlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF17372A"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFB7C5BD"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function buildExcelRows(books) {
  const customFieldNames = [...new Set(
    books.flatMap((book) => Object.keys(book.custom_fields || {}))
  )].sort((a, b) => a.localeCompare(b, "it"));

  const headers = [
    ...EXCEL_COLUMNS.map((column) => column.header),
    ...customFieldNames.map((name) => EXTRA_COLUMN_PREFIX + name),
  ];

  const dataRows = books.map((book) => {
    const row = EXCEL_COLUMNS.map((column) => {
      const value = column.key === "catalog_status"
        ? effectiveCatalogStatus(book)
        : book[column.key];
      return excelCellValue(value, column.kind);
    });
    for (const name of customFieldNames) row.push(book.custom_fields?.[name] ?? "");
    return row;
  });

  return { headers, rows: [headers, ...dataRows] };
}

async function exportExcel() {
  if (typeof JSZip === "undefined") {
    throw new Error("Il modulo Excel locale non è disponibile.");
  }

  const { headers, rows } = buildExcelRows(state.books);
  const instructionRows = [
    ["Biblioteca dello Studio — istruzioni", ""],
    ["Ogni riga del foglio Biblioteca corrisponde a un libro.", ""],
    ["Ogni colonna contiene una singola informazione catalografica.", ""],
    ["Non modificare le intestazioni della prima riga se vuoi reimportare il file.", ""],
    ["I campi personalizzati iniziano con Extra · ", ""],
    ["Data esportazione", new Date().toLocaleString("it-IT")],
    ["Numero di libri", state.books.length],
  ];

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Biblioteca dello Studio</dc:title><dc:creator>Biblioteca dello Studio</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`);
  zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Biblioteca dello Studio</Application>
</Properties>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Biblioteca" sheetId="1" r:id="rId1"/><sheet name="Istruzioni" sheetId="2" r:id="rId2"/></sheets>
</workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.folder("xl").file("styles.xml", xlsxStylesXml());
  zip.folder("xl").folder("worksheets").file(
    "sheet1.xml",
    xlsxSheetXml(rows, headers.map(excelColumnWidth), { freezeHeader: true, filter: true })
  );
  zip.folder("xl").folder("worksheets").file(
    "sheet2.xml",
    xlsxSheetXml(instructionRows, [72, 24], { freezeHeader: false, filter: false })
  );

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `biblioteca-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function splitExcelList(value) {
  return String(value || "").split(/\s*;\s*/).map((item) => item.trim()).filter(Boolean);
}

function parseExcelNumber(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : "";
}

function rowToBook(row) {
  const now = new Date().toISOString();
  const book = { created_at: now, updated_at: now, custom_fields: {} };

  for (const column of EXCEL_COLUMNS) {
    let value = row[column.header];
    if (column.kind === "list") value = splitExcelList(value);
    else if (column.kind === "number") value = parseExcelNumber(value);
    else value = value === null || value === undefined ? "" : String(value).trim();
    book[column.key] = value;
  }

  for (const [header, value] of Object.entries(row)) {
    if (!header.startsWith(EXTRA_COLUMN_PREFIX)) continue;
    const name = header.slice(EXTRA_COLUMN_PREFIX.length).trim();
    const text = value === null || value === undefined ? "" : String(value).trim();
    if (name && text) book.custom_fields[name] = text;
  }

  delete book.id;
  book.isbn13 = normalizeIsbn(book.isbn13);
  book.isbn10 = normalizeIsbn(book.isbn10);
  book.catalog_status = book.catalog_status || "Incompleta";
  book.created_at = book.created_at || now;
  book.updated_at = book.updated_at || now;
  return book;
}

function xmlText(node, localName) {
  const element = node.getElementsByTagNameNS("*", localName)[0];
  return element?.textContent || "";
}

async function readXlsxRows(file) {
  if (typeof JSZip === "undefined") throw new Error("Il modulo Excel locale non è disponibile.");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const workbookFile = zip.file("xl/workbook.xml");
  const relationsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationsFile) throw new Error("Il file non sembra un documento Excel .xlsx valido.");

  const parser = new DOMParser();
  const workbookXml = parser.parseFromString(await workbookFile.async("text"), "application/xml");
  const relationsXml = parser.parseFromString(await relationsFile.async("text"), "application/xml");
  const sheets = [...workbookXml.getElementsByTagNameNS("*", "sheet")];
  const chosen = sheets.find((sheet) => sheet.getAttribute("name") === "Biblioteca") || sheets[0];
  if (!chosen) throw new Error("Il file Excel non contiene fogli.");

  const relationId = chosen.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "id"
  ) || chosen.getAttribute("r:id");
  const relation = [...relationsXml.getElementsByTagNameNS("*", "Relationship")]
    .find((item) => item.getAttribute("Id") === relationId);
  if (!relation) throw new Error("Non riesco a individuare il foglio Biblioteca.");

  let target = relation.getAttribute("Target") || "";
  target = target.replace(/^\//, "");
  if (!target.startsWith("xl/")) target = `xl/${target}`;
  const sheetFile = zip.file(target);
  if (!sheetFile) throw new Error("Il foglio Biblioteca non è leggibile.");

  let sharedStrings = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const sharedXml = parser.parseFromString(await sharedFile.async("text"), "application/xml");
    sharedStrings = [...sharedXml.getElementsByTagNameNS("*", "si")]
      .map((item) => [...item.getElementsByTagNameNS("*", "t")].map((t) => t.textContent || "").join(""));
  }

  const sheetXml = parser.parseFromString(await sheetFile.async("text"), "application/xml");
  const output = [];
  for (const rowNode of sheetXml.getElementsByTagNameNS("*", "row")) {
    const row = [];
    for (const cell of rowNode.getElementsByTagNameNS("*", "c")) {
      const index = excelColumnIndex(cell.getAttribute("r"));
      const type = cell.getAttribute("t") || "";
      let value = "";
      if (type === "inlineStr") {
        value = [...cell.getElementsByTagNameNS("*", "t")].map((node) => node.textContent || "").join("");
      } else {
        const raw = xmlText(cell, "v");
        if (type === "s") value = sharedStrings[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else value = raw;
      }
      row[index] = value;
    }
    output.push(row);
  }
  return output;
}

function detectCsvDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

function parseCsvRows(text) {
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

async function importExcelFile(file) {
  const rows = file.name.toLowerCase().endsWith(".csv")
    ? parseCsvRows(await file.text())
    : await readXlsxRows(file);
  if (rows.length < 2) throw new Error("Il file non contiene righe di libri.");

  const headers = rows[0].map((value) => String(value || "").trim());
  const books = rows.slice(1).map((values) => {
    const row = {};
    headers.forEach((header, index) => { if (header) row[header] = values[index] ?? ""; });
    return rowToBook(row);
  }).filter((book) => book.title || book.isbn13 || book.isbn10);

  if (!books.length) {
    throw new Error("Non trovo libri riconoscibili. Non cambiare le intestazioni della prima riga.");
  }

  if (!confirm(`Importare ${books.length} libri dal file Excel? I dati attuali verranno sostituiti.`)) return;
  await dbClear();
  for (const book of books) await dbSave(book);
  await refresh();
  toast(`${books.length} libri importati correttamente da Excel.`);
}

async function importJsonFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Il file JSON non contiene un elenco di libri.");
  if (!confirm(`Importare ${data.length} libri? I dati attuali verranno sostituiti.`)) return;
  await dbClear();
  for (const book of data) {
    const copy = { ...book };
    delete copy.id;
    await dbSave(copy);
  }
  await refresh();
  toast("Biblioteca importata correttamente.");
}

bookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const book = collectForm();
  if (!book.internal_code) {
    book.internal_code = nextInternalCode();
  }
  const duplicate = state.books.find((item) => item.id !== book.id && book.isbn13 && normalizeIsbn(item.isbn13) === book.isbn13);
  if (duplicate) {
    toast("Esiste già un libro con questo ISBN-13.", true);
    return;
  }

  const button = $("#saveButton");
  button.disabled = true;
  try {
    await dbSave(book);
    bookDialog.close();
    await refresh();
    toast(book.id ? "Scheda aggiornata." : "Libro aggiunto alla biblioteca.");
  } catch (error) {
    toast("Impossibile salvare il libro.", true);
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

$("#deleteButton").addEventListener("click", async () => {
  const id = Number($("#bookId").value);
  if (!id || !confirm("Eliminare definitivamente questo libro dall’archivio?")) return;
  await dbDelete(id);
  bookDialog.close();
  await refresh();
  toast("Libro eliminato.");
});

booksGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit]");
  if (!button) return;
  const book = state.books.find((item) => item.id === Number(button.dataset.edit));
  if (book) openBook(book);
});

$("#coverUrl").addEventListener("input", (event) => setCover(event.target.value.trim()));
$("#addCustomField").addEventListener("click", () => addCustomField());
$("#scanButton").addEventListener("click", startScanner);
$("#emptyScanButton").addEventListener("click", startScanner);
$("#coverScanButton").addEventListener("click", openCoverRecognition);
$("#emptyCoverButton").addEventListener("click", openCoverRecognition);
$("#manualAddButton").addEventListener("click", () => openBook());
$("#coverPhotoInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) void recognizeCoverPhoto(file);
});
$("#coverResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-cover-choice]");
  if (button) void addCoverResult(Number(button.dataset.coverChoice));
});
$("#lookupManualIsbn").addEventListener("click", () => lookupIsbn($("#manualIsbnInput").value));
$("#manualIsbnInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    lookupIsbn(event.target.value);
  }
});

$("#searchInput").addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(renderBooks, 180);
});
$("#statusFilter").addEventListener("change", renderBooks);
$("#sortSelect").addEventListener("change", renderBooks);
$("#exportJsonButton").addEventListener("click", exportJson);
$("#exportExcelButton").addEventListener("click", async () => {
  try {
    await exportExcel();
  } catch (error) {
    console.error(error);
    toast(error.message || "Esportazione Excel non riuscita.", true);
  }
});
$("#importJsonInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importJsonFile(file);
  } catch (error) {
    toast(error.message || "Importazione non riuscita.", true);
  } finally {
    event.target.value = "";
  }
});

$("#importExcelInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importExcelFile(file);
  } catch (error) {
    console.error(error);
    toast(error.message || "Importazione Excel non riuscita.", true);
  } finally {
    event.target.value = "";
  }
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", async () => {
    const dialog = document.getElementById(button.dataset.close);
    if (dialog === scannerDialog) await closeScanner();
    else if (dialog === coverDialog) {
      if (state.coverWorker) {
        try { await state.coverWorker.terminate(); } catch (_) {}
        state.coverWorker = null;
      }
      dialog.close();
    } else dialog.close();
  });
});

scannerDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  await closeScanner();
});
coverDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  if (state.coverWorker) {
    try { await state.coverWorker.terminate(); } catch (_) {}
    state.coverWorker = null;
  }
  coverDialog.close();
});
bookDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  bookDialog.close();
});

refresh().catch((error) => {
  console.error(error);
  toast("Impossibile aprire l’archivio locale del browser.", true);
});
