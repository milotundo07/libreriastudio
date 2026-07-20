const DB_NAME = "bibliotecaStudioDB";
const DB_VERSION = 1;
const STORE_NAME = "books";

const state = {
  books: [],
  scanner: null,
  searchTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const booksGrid = $("#booksGrid");
const emptyState = $("#emptyState");
const bookDialog = $("#bookDialog");
const scannerDialog = $("#scannerDialog");
const bookForm = $("#bookForm");

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

function bookCard(book) {
  const cover = book.cover_url
    ? `<img src="${escapeHtml(book.cover_url)}" alt="Copertina di ${escapeHtml(book.title)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid'"><div class="card-cover-placeholder" style="display:none">Nessuna copertina</div>`
    : `<div class="card-cover-placeholder">Nessuna copertina</div>`;
  const authors = (book.authors || []).join(", ") || "Autore non indicato";
  const location = [book.room, book.shelf].filter(Boolean).join(" · ");
  return `
    <article class="book-card">
      <div>${cover}</div>
      <div>
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(authors)}</p>
        <p>${escapeHtml([book.publisher, book.publication_year].filter(Boolean).join(", "))}</p>
        ${location ? `<p>${escapeHtml(location)}</p>` : ""}
        <div class="book-meta">
          <span class="pill">${escapeHtml(book.status || "Disponibile")}</span>
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
      ...(book.authors || []),
      book.isbn13,
      book.isbn10,
      book.publisher,
      ...(book.categories || []),
      book.room,
      book.shelf,
      book.notes,
    ].filter(Boolean).join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!status || book.status === status);
  });

  filtered.sort((a, b) => {
    if (sort === "author") return ((a.authors || [""])[0] || "").localeCompare((b.authors || [""])[0] || "", "it");
    if (sort === "year_desc") return Number(b.publication_year || 0) - Number(a.publication_year || 0);
    if (sort === "added_desc") return String(b.created_at || "").localeCompare(String(a.created_at || ""));
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
  const authors = new Set(state.books.flatMap((book) => book.authors || []).map((name) => name.trim()).filter(Boolean));
  $("#statTotal").textContent = state.books.length;
  $("#statAvailable").textContent = state.books.filter((book) => book.status === "Disponibile").length;
  $("#statLoan").textContent = state.books.filter((book) => book.status === "In prestito").length;
  $("#statAuthors").textContent = authors.size;
}

async function refresh() {
  state.books = await dbGetAll();
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
  $("#status").value = "Disponibile";
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
    title: "title",
    subtitle: "subtitle",
    isbn13: "isbn13",
    isbn10: "isbn10",
    language: "language",
    publication_year: "publicationYear",
    publication_date: "publicationDate",
    pages: "pages",
    publisher: "publisher",
    room: "room",
    shelf: "shelf",
    status: "status",
    condition: "condition",
    acquisition_date: "acquisitionDate",
    notes: "notes",
    cover_url: "coverUrl",
    source: "source",
  };
  Object.entries(mapping).forEach(([source, target]) => {
    if (book[source] !== undefined && book[source] !== null) $("#" + target).value = book[source];
  });
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
    title: $("#title").value.trim(),
    subtitle: $("#subtitle").value.trim(),
    authors: $("#authors").value.split(",").map((v) => v.trim()).filter(Boolean),
    isbn13: normalizeIsbn($("#isbn13").value),
    isbn10: normalizeIsbn($("#isbn10").value),
    language: $("#language").value.trim(),
    publication_year: $("#publicationYear").value ? Number($("#publicationYear").value) : "",
    publication_date: $("#publicationDate").value.trim(),
    pages: $("#pages").value ? Number($("#pages").value) : "",
    publisher: $("#publisher").value.trim(),
    categories: $("#categories").value.split(",").map((v) => v.trim()).filter(Boolean),
    room: $("#room").value.trim(),
    shelf: $("#shelf").value.trim(),
    status: $("#status").value,
    condition: $("#condition").value.trim(),
    acquisition_date: $("#acquisitionDate").value,
    notes: $("#notes").value.trim(),
    cover_url: $("#coverUrl").value.trim(),
    source: $("#source").value.trim(),
    custom_fields: customFields,
  };
}

async function closeScanner() {
  if (state.scanner) {
    try { await state.scanner.clear(); } catch (_) {}
    state.scanner = null;
  }
  if (scannerDialog.open) scannerDialog.close();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Servizio bibliografico non disponibile.");
  return response.json();
}

function parseOpenLibrary(data, isbn) {
  const entry = data[`ISBN:${isbn}`];
  if (!entry) return null;
  const identifiers = entry.identifiers || {};
  return {
    title: entry.title || "",
    subtitle: entry.subtitle || "",
    authors: (entry.authors || []).map((a) => a.name).filter(Boolean),
    isbn13: (identifiers.isbn_13 || []).find(Boolean) || (isbn.length === 13 ? isbn : ""),
    isbn10: (identifiers.isbn_10 || []).find(Boolean) || (isbn.length === 10 ? isbn : ""),
    publisher: (entry.publishers || []).map((p) => p.name).filter(Boolean).join(", "),
    publication_date: entry.publish_date || "",
    publication_year: String(entry.publish_date || "").match(/\d{4}/)?.[0] || "",
    pages: entry.number_of_pages || "",
    cover_url: entry.cover?.large || entry.cover?.medium || entry.cover?.small || "",
    categories: (entry.subjects || []).slice(0, 12).map((s) => s.name).filter(Boolean),
    source: "Open Library",
  };
}

function parseGoogleBooks(data, isbn) {
  const item = data.items?.[0]?.volumeInfo;
  if (!item) return null;
  const identifiers = item.industryIdentifiers || [];
  const byType = (type) => identifiers.find((x) => x.type === type)?.identifier || "";
  return {
    title: item.title || "",
    subtitle: item.subtitle || "",
    authors: item.authors || [],
    isbn13: byType("ISBN_13") || (isbn.length === 13 ? isbn : ""),
    isbn10: byType("ISBN_10") || (isbn.length === 10 ? isbn : ""),
    publisher: item.publisher || "",
    publication_date: item.publishedDate || "",
    publication_year: String(item.publishedDate || "").match(/\d{4}/)?.[0] || "",
    pages: item.pageCount || "",
    language: item.language || "",
    cover_url: (item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail || "").replace(/^http:/, "https:"),
    categories: item.categories || [],
    source: "Google Books",
  };
}

async function lookupBook(isbn) {
  const existing = state.books.find((book) => normalizeIsbn(book.isbn13) === isbn || normalizeIsbn(book.isbn10) === isbn);
  if (existing) return { existing: true, book: existing };

  try {
    const openLibrary = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`);
    const parsed = parseOpenLibrary(openLibrary, isbn);
    if (parsed) return { existing: false, book: parsed };
  } catch (_) {}

  try {
    const google = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`);
    const parsed = parseGoogleBooks(google, isbn);
    if (parsed) return { existing: false, book: parsed };
  } catch (_) {}

  throw new Error("Il libro non è stato trovato nei cataloghi online.");
}

async function lookupIsbn(raw) {
  const code = normalizeIsbn(raw);
  const status = $("#scanStatus");
  if (!code) return;
  status.classList.remove("error");
  status.textContent = "Codice letto. Recupero dei dati bibliografici…";

  try {
    const result = await lookupBook(code);
    await closeScanner();
    openBook(result.book);
    toast(result.existing ? "Il libro era già presente: ho aperto la sua scheda." : "Dati trovati. Controllali e salva il libro.");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    await closeScanner();
    openBook(code.length === 13 ? { isbn13: code } : { isbn10: code });
    toast("Libro non trovato online: completa la scheda manualmente.", true);
  }
}

function startScanner() {
  $("#scanStatus").textContent = "";
  $("#manualIsbnInput").value = "";
  scannerDialog.showModal();

  if (typeof Html5QrcodeScanner === "undefined") {
    $("#scanStatus").textContent = "Modulo scanner non caricato. Controlla la connessione internet.";
    $("#scanStatus").classList.add("error");
    return;
  }

  const formats = typeof Html5QrcodeSupportedFormats !== "undefined"
    ? [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.UPC_A]
    : undefined;

  state.scanner = new Html5QrcodeScanner("reader", {
    fps: 12,
    qrbox: { width: 300, height: 125 },
    aspectRatio: 1.7778,
    rememberLastUsedCamera: true,
    showTorchButtonIfSupported: true,
    showZoomSliderIfSupported: true,
    formatsToSupport: formats,
  }, false);

  let handled = false;
  state.scanner.render(async (decodedText) => {
    if (handled) return;
    handled = true;
    await lookupIsbn(decodedText);
  }, () => {});
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

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportJson() {
  downloadFile(`biblioteca-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state.books, null, 2), "application/json");
}

function exportCsv() {
  const headers = ["Titolo", "Sottotitolo", "Autori", "ISBN-13", "ISBN-10", "Editore", "Anno", "Data pubblicazione", "Lingua", "Pagine", "Categorie", "Stanza", "Scaffale", "Stato", "Condizione", "Data acquisizione", "Note"];
  const rows = state.books.map((book) => [
    book.title,
    book.subtitle,
    book.authors,
    book.isbn13,
    book.isbn10,
    book.publisher,
    book.publication_year,
    book.publication_date,
    book.language,
    book.pages,
    book.categories,
    book.room,
    book.shelf,
    book.status,
    book.condition,
    book.acquisition_date,
    book.notes,
  ].map(csvEscape).join(","));
  downloadFile(`biblioteca-${new Date().toISOString().slice(0, 10)}.csv`, [headers.map(csvEscape).join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
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
$("#manualAddButton").addEventListener("click", () => openBook());
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
$("#exportCsvButton").addEventListener("click", exportCsv);
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

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", async () => {
    const dialog = document.getElementById(button.dataset.close);
    if (dialog === scannerDialog) await closeScanner();
    else dialog.close();
  });
});

scannerDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  await closeScanner();
});
bookDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  bookDialog.close();
});

refresh().catch((error) => {
  console.error(error);
  toast("Impossibile aprire l’archivio locale del browser.", true);
});
