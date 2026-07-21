
"use strict";

let installPromptEvent = null;
let currentInventory = null;

function getInventoryCodeSettings() {
  try {
    return {
      prefix: localStorage.getItem("libraryCodePrefix") || "BIB",
      digits: Number(localStorage.getItem("libraryCodeDigits") || 6),
    };
  } catch (_) {
    return { prefix: "BIB", digits: 6 };
  }
}

function saveInventoryCodeSettings(prefix, digits) {
  const cleanPrefix = String(prefix || "BIB").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "") || "BIB";
  const cleanDigits = Math.max(3, Math.min(9, Number(digits) || 6));
  localStorage.setItem("libraryCodePrefix", cleanPrefix);
  localStorage.setItem("libraryCodeDigits", String(cleanDigits));
  return { prefix: cleanPrefix, digits: cleanDigits };
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "it", { sensitivity: "base" }));
}

function authorIdentityKey(name) {
  return normalizeCatalogText(name).split(/\s+/).filter(Boolean).sort().join(" ");
}

function canonicalizeAuthorList(authors) {
  const existing = new Map();
  for (const name of state.books.flatMap((book) => book.authors || [])) {
    const key = authorIdentityKey(name);
    if (key && !existing.has(key)) existing.set(key, name);
  }
  return uniqueSorted(authors.map((name) => existing.get(authorIdentityKey(name)) || smartCase(name, true)));
}

function canonicalizeTermList(terms, fieldName) {
  const existing = new Map();
  for (const term of state.books.flatMap((book) => book[fieldName] || [])) {
    const key = normalizeCatalogText(term);
    if (key && !existing.has(key)) existing.set(key, term);
  }
  return uniqueSorted(terms.map((term) => existing.get(normalizeCatalogText(term)) || smartCase(term)));
}

const REQUIRED_CATALOG_FIELDS = [
  ["authors", "autore"],
  ["publisher", "editore"],
  ["publication_year", "anno"],
  ["language", "lingua"],
  ["pages", "pagine"],
  ["room", "stanza"],
  ["shelf", "scaffale"],
  ["categories", "categoria"],
];

function missingCatalogFields(book) {
  const missing = [];
  for (const [field, label] of REQUIRED_CATALOG_FIELDS) {
    const value = book[field];
    if (Array.isArray(value) ? value.length === 0 : !value) missing.push(label);
  }
  if (!book.isbn13 && !book.isbn10 && !book.internal_code) missing.push("identificatore");
  if (!book.cover_url) missing.push("copertina");
  return missing;
}

function renderCompletenessPanel(book) {
  const list = $("#completenessList");
  if (!list) return;
  const missing = missingCatalogFields(book);
  list.innerHTML = missing.length
    ? missing.map((field) => `<li>${escapeHtml(field)}</li>`).join("")
    : "<li class=\"complete-item\">Scheda completa</li>";
}

function jaccardSimilarity(a, b) {
  const left = new Set(textTokens(a));
  const right = new Set(textTokens(b));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function findPotentialDuplicates(candidate, excludedId) {
  return state.books.filter((book) => {
    if (book.id === excludedId) return false;
    const candidateIsbns = [candidate.isbn13, candidate.isbn10].map(normalizeIsbn).filter(Boolean);
    const bookIsbns = [book.isbn13, book.isbn10].map(normalizeIsbn).filter(Boolean);
    if (candidateIsbns.some((isbn) => bookIsbns.includes(isbn))) return true;

    const titleScore = jaccardSimilarity(
      `${candidate.title || ""} ${candidate.subtitle || ""}`,
      `${book.title || ""} ${book.subtitle || ""}`
    );
    const candidateAuthors = (candidate.authors || []).map(authorIdentityKey);
    const bookAuthors = (book.authors || []).map(authorIdentityKey);
    const authorMatch = candidateAuthors.some((author) => bookAuthors.includes(author));
    const sameYear = !candidate.publication_year || !book.publication_year ||
      String(candidate.publication_year) === String(book.publication_year);
    return titleScore >= 0.78 && authorMatch && sameYear;
  });
}

function mergeBookValues(primary, secondary) {
  const merged = { ...secondary, ...primary };
  const arrayFields = ["authors", "categories", "tags", "collections"];
  for (const field of arrayFields) {
    merged[field] = uniqueSorted([...(secondary[field] || []), ...(primary[field] || [])]);
  }
  merged.custom_fields = { ...(secondary.custom_fields || {}), ...(primary.custom_fields || {}) };
  for (const [key, value] of Object.entries(secondary)) {
    if ((merged[key] === "" || merged[key] === null || merged[key] === undefined) && value) {
      merged[key] = value;
    }
  }
  merged.updated_at = new Date().toISOString();
  return merged;
}

function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value || "").trim();
  if (!text) return 0;
  text = text.replace(/[^\d,.-]/g, "");
  if (text.includes(",") && text.includes(".")) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else {
    text = text.replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function collectionTotalValue(books) {
  return books.reduce((sum, book) => sum + parseMoney(book.estimated_value || book.acquisition_price), 0);
}

async function snapshotGetAll() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readonly");
    const request = tx.objectStore(SNAPSHOT_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function snapshotAdd(snapshot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    const request = tx.objectStore(SNAPSHOT_STORE_NAME).add(snapshot);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function snapshotDelete(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE_NAME, "readwrite");
    tx.objectStore(SNAPSHOT_STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function saveSnapshot(reason = "Backup automatico") {
  const books = await dbGetAll();
  await snapshotAdd({
    created_at: new Date().toISOString(),
    reason,
    books: structuredClone(books),
  });
  const snapshots = (await snapshotGetAll()).sort((a, b) => b.id - a.id);
  for (const old of snapshots.slice(15)) await snapshotDelete(old.id);
}

async function restoreSnapshot(snapshot) {
  if (!snapshot?.books) return;
  if (!confirm(`Ripristinare il backup "${snapshot.reason}"? I dati correnti saranno sostituiti.`)) return;
  await saveSnapshot("Prima del ripristino");
  await dbClear();
  for (const book of snapshot.books) {
    const copy = { ...book };
    delete copy.id;
    await dbSave(copy);
  }
  await refresh();
  toast("Backup ripristinato.");
}

async function undoLastChange() {
  const snapshots = (await snapshotGetAll()).sort((a, b) => b.id - a.id);
  if (!snapshots.length) {
    toast("Non ci sono modifiche da annullare.", true);
    return;
  }
  await restoreSnapshot(snapshots[0]);
}

async function renderSnapshots() {
  const container = $("#snapshotsContent");
  const snapshots = (await snapshotGetAll()).sort((a, b) => b.id - a.id);
  container.innerHTML = snapshots.length
    ? snapshots.map((snapshot) => `
      <article class="snapshot-row">
        <div><strong>${escapeHtml(snapshot.reason)}</strong>
        <p>${new Date(snapshot.created_at).toLocaleString("it-IT")} · ${snapshot.books?.length || 0} libri</p></div>
        <button class="button secondary" data-restore-snapshot="${snapshot.id}">Ripristina</button>
      </article>`).join("")
    : "<p>Nessun backup automatico disponibile.</p>";
}

async function automaticDailySnapshot() {
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("lastDailyLibrarySnapshot") === today) return;
  await saveSnapshot("Backup giornaliero");
  localStorage.setItem("lastDailyLibrarySnapshot", today);
}

function updateDatalist(id, values) {
  const list = document.getElementById(id);
  if (!list) return;
  list.innerHTML = uniqueSorted(values).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

function replaceSelectOptions(id, values, defaultLabel) {
  const select = document.getElementById(id);
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>` +
    uniqueSorted(values).map((value) => `<option>${escapeHtml(value)}</option>`).join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function updateCatalogOptions() {
  updateDatalist("categoriesDatalist", state.books.flatMap((book) => book.categories || []));
  updateDatalist("tagsDatalist", state.books.flatMap((book) => book.tags || []));
  updateDatalist("collectionsDatalist", state.books.flatMap((book) => book.collections || []));
  replaceSelectOptions("filterAuthor", state.books.flatMap((book) => book.authors || []), "Tutti");
  replaceSelectOptions("filterPublisher", state.books.map((book) => book.publisher), "Tutti");
  replaceSelectOptions("filterSeries", state.books.map((book) => book.series), "Tutte");
  replaceSelectOptions("filterLanguage", state.books.map((book) => book.language), "Tutte");
  replaceSelectOptions("filterRoom", state.books.map((book) => book.room), "Tutte");
  replaceSelectOptions("filterShelf", state.books.map((book) => book.shelf), "Tutti");
  replaceSelectOptions("filterCategory", state.books.flatMap((book) => book.categories || []), "Tutte");
  replaceSelectOptions("filterCollection", state.books.flatMap((book) => book.collections || []), "Tutte");
  replaceSelectOptions("inventoryRoom", state.books.map((book) => book.room), "Tutte");
  replaceSelectOptions("inventoryShelf", state.books.map((book) => book.shelf), "Tutti");
}

function afterLibraryRefresh() {
  updateCatalogOptions();
  updateSelectionBar();
}

function toggleSelectionMode(force) {
  const enabled = typeof force === "boolean" ? force : !document.body.classList.contains("selection-mode");
  document.body.classList.toggle("selection-mode", enabled);
  $("#selectionBar").classList.toggle("hidden", !enabled);
  $("#selectionModeButton").textContent = enabled ? "Esci selezione" : "Seleziona";
  renderBooks();
}

function updateSelectionBar() {
  const count = state.selectedBookIds.size;
  $("#selectionCount").textContent = `${count} ${count === 1 ? "selezionato" : "selezionati"}`;
  $("#bulkEditButton").disabled = count === 0;
  $("#selectedQrButton").disabled = count === 0;
}

function selectedBooks() {
  return state.books.filter((book) => state.selectedBookIds.has(book.id));
}

function applyAdvancedFilters() {
  state.advancedFilters = {
    author: $("#filterAuthor").value,
    publisher: $("#filterPublisher").value,
    series: $("#filterSeries").value,
    language: $("#filterLanguage").value,
    room: $("#filterRoom").value,
    shelf: $("#filterShelf").value,
    category: $("#filterCategory").value,
    collection: $("#filterCollection").value,
    reading_status: $("#filterReadingStatus").value,
    isbn: $("#filterIsbn").value,
    year_from: $("#filterYearFrom").value,
    year_to: $("#filterYearTo").value,
  };
  $("#advancedFiltersDialog").close();
  renderBooks();
}

function clearAdvancedFilters() {
  state.advancedFilters = {};
  ["filterAuthor", "filterPublisher", "filterSeries", "filterLanguage", "filterRoom",
   "filterShelf", "filterCategory", "filterCollection", "filterReadingStatus",
   "filterIsbn", "filterYearFrom", "filterYearTo"].forEach((id) => { $("#" + id).value = ""; });
  renderBooks();
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.map((item) => String(item || "").trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "it"));
}

function barChart(title, entries, limit = 10) {
  const chosen = entries.slice(0, limit);
  const max = Math.max(1, ...chosen.map(([, value]) => value));
  return `<section class="stats-section"><h3>${escapeHtml(title)}</h3>
    <div class="bar-list">${chosen.length ? chosen.map(([label, value]) => `
      <div class="bar-row"><span>${escapeHtml(label)}</span>
      <div><i style="width:${Math.round(value / max * 100)}%"></i></div><strong>${value}</strong></div>`).join("") : "<p>Nessun dato.</p>"}</div>
  </section>`;
}

function renderStatistics() {
  const books = state.books;
  const decades = countValues(books.map((book) => {
    const year = Number(book.publication_year);
    return year ? `${Math.floor(year / 10) * 10}s` : "";
  }));
  const summary = [
    ["Libri", books.length],
    ["Opere", new Set(books.map((book) => normalizeCatalogText(book.work_title || book.original_title || book.title))).size],
    ["Letti", books.filter((book) => book.reading_status === "Letto").length],
    ["Senza ISBN", books.filter((book) => !book.isbn13 && !book.isbn10).length],
    ["Schede incomplete", books.filter((book) => missingCatalogFields(book).length).length],
    ["Valore", new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(collectionTotalValue(books))],
  ];

  $("#statisticsContent").innerHTML = `
    <div class="summary-grid">${summary.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("")}</div>
    <div class="stats-columns">
      ${barChart("Autori", countValues(books.flatMap((book) => book.authors || [])))}
      ${barChart("Editori", countValues(books.map((book) => book.publisher)))}
      ${barChart("Categorie", countValues(books.flatMap((book) => book.categories || [])))}
      ${barChart("Decenni di pubblicazione", decades)}
      ${barChart("Lingue", countValues(books.map((book) => book.language)))}
      ${barChart("Stato di lettura", countValues(books.map((book) => book.reading_status)))}
      ${barChart("Provenienze", countValues(books.map((book) => book.provenance)))}
      ${barChart("Liste", countValues(books.flatMap((book) => book.collections || [])))}
    </div>`;
}

function renderDuplicates() {
  const pairs = [];
  const seen = new Set();
  for (const book of state.books) {
    for (const duplicate of findPotentialDuplicates(book, book.id)) {
      const key = [book.id, duplicate.id].sort((a, b) => a - b).join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([book, duplicate]);
    }
  }

  $("#duplicatesContent").innerHTML = pairs.length
    ? pairs.map(([left, right]) => `
      <article class="duplicate-pair">
        <div><strong>${escapeHtml(left.title)}</strong><p>${escapeHtml((left.authors || []).join(", "))} · ${escapeHtml(left.internal_code || "")}</p></div>
        <span>possibile doppione di</span>
        <div><strong>${escapeHtml(right.title)}</strong><p>${escapeHtml((right.authors || []).join(", "))} · ${escapeHtml(right.internal_code || "")}</p></div>
        <button class="button primary" data-merge-left="${left.id}" data-merge-right="${right.id}">Unisci</button>
      </article>`).join("")
    : "<p>Nessun duplicato convincente trovato.</p>";
}

async function mergeBooks(leftId, rightId) {
  const left = state.books.find((book) => book.id === leftId);
  const right = state.books.find((book) => book.id === rightId);
  if (!left || !right) return;
  if (!confirm(`Unire "${right.title}" dentro "${left.title}" ed eliminare la seconda scheda?`)) return;
  await saveSnapshot("Prima dell’unione di duplicati");
  await dbSave(mergeBookValues(left, right));
  await dbDelete(right.id);
  state.selectedBookIds.delete(right.id);
  await refresh();
  renderDuplicates();
  toast("Schede unite.");
}

async function applyBulkEdit() {
  const books = selectedBooks();
  if (!books.length) return;
  await saveSnapshot("Prima della modifica multipla");
  const updates = {
    room: $("#bulkRoom").value.trim(),
    shelf: $("#bulkShelf").value.trim(),
    catalog_status: $("#bulkCatalogStatus").value,
    reading_status: $("#bulkReadingStatus").value,
    provenance: $("#bulkProvenance").value.trim(),
  };
  const category = $("#bulkCategory").value.trim();
  const collection = $("#bulkCollection").value.trim();
  const tag = $("#bulkTag").value.trim();

  for (const book of books) {
    const copy = { ...book, updated_at: new Date().toISOString() };
    for (const [field, value] of Object.entries(updates)) if (value) copy[field] = value;
    if (category) copy.categories = canonicalizeTermList([...(copy.categories || []), category], "categories");
    if (collection) copy.collections = canonicalizeTermList([...(copy.collections || []), collection], "collections");
    if (tag) copy.tags = canonicalizeTermList([...(copy.tags || []), tag], "tags");
    await dbSave(copy);
  }
  $("#bulkDialog").close();
  await refresh();
  toast(`${books.length} libri aggiornati.`);
}

function booksForQrScope() {
  const scope = $("#qrScope").value;
  if (scope === "selected") return selectedBooks();
  if (scope === "filtered") return filteredBooks();
  return state.books;
}

function renderQrPreview() {
  const books = booksForQrScope();
  const includeTitle = $("#qrIncludeTitle").checked;
  $("#qrPreview").style.setProperty("--qr-columns", $("#qrColumns").value);
  $("#qrPreview").innerHTML = books.length
    ? books.map((book) => `
      <article class="qr-label">
        ${LibraryQR.svg(book.internal_code, { size: 150, margin: 3 })}
        <strong>${escapeHtml(book.internal_code)}</strong>
        ${includeTitle ? `<span>${escapeHtml(book.title)}</span><small>${escapeHtml((book.authors || []).join(", "))}</small>` : ""}
      </article>`).join("")
    : "<p>Nessun libro nel gruppo scelto.</p>";
}

function printWindow(title, body, extraCss = "") {
  const win = window.open("", "_blank");
  if (!win) {
    toast("Il browser ha bloccato la finestra di stampa.", true);
    return;
  }
  win.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
  body{font-family:Arial,sans-serif;color:#111;margin:18mm}h1{font-family:Georgia,serif}
  .print-grid{display:grid;grid-template-columns:repeat(var(--cols,3),1fr);gap:7mm}
  .qr-label{border:1px solid #bbb;padding:4mm;text-align:center;break-inside:avoid;display:flex;flex-direction:column;align-items:center}
  .qr-label svg{width:36mm;height:36mm}.qr-label strong{font-size:12px}.qr-label span{font-size:10px;margin-top:2mm}.qr-label small{font-size:9px}
  .print-book{display:grid;grid-template-columns:25mm 1fr;gap:5mm;border-bottom:1px solid #bbb;padding:4mm 0;break-inside:avoid}
  .print-book img{width:25mm;height:38mm;object-fit:cover}.print-book h2{font-size:16px;margin:0 0 2mm}.print-book p{font-size:10px;margin:1mm 0}
  ${extraCss}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}

function printQrLabels() {
  const books = booksForQrScope();
  if (!books.length) return toast("Nessuna etichetta da stampare.", true);
  const cols = $("#qrColumns").value;
  const includeTitle = $("#qrIncludeTitle").checked;
  const labels = books.map((book) => `<article class="qr-label">
    ${LibraryQR.svg(book.internal_code, { size: 160, margin: 3 })}
    <strong>${escapeHtml(book.internal_code)}</strong>
    ${includeTitle ? `<span>${escapeHtml(book.title)}</span><small>${escapeHtml((book.authors || []).join(", "))}</small>` : ""}
  </article>`).join("");
  printWindow("Etichette QR", `<div class="print-grid" style="--cols:${cols}">${labels}</div>`);
}

function bookPrintHtml(book) {
  const rows = [
    ["Codice", book.internal_code],
    ["Autore", (book.authors || []).join(", ")],
    ["Titolo", book.title],
    ["Sottotitolo", book.subtitle],
    ["Opera", book.work_title],
    ["Editore", [book.publisher, book.publication_place, book.publication_year].filter(Boolean).join(", ")],
    ["Edizione", [book.edition, book.printing].filter(Boolean).join(" · ")],
    ["Collana", [book.series, book.series_number].filter(Boolean).join(" · ")],
    ["ISBN", book.isbn13 || book.isbn10],
    ["Dewey", book.dewey],
    ["Categorie", (book.categories || []).join(", ")],
    ["Collocazione", [book.room, book.shelf].filter(Boolean).join(" · ")],
    ["Condizione", book.condition],
    ["Provenienza", book.provenance],
    ["Stato lettura", book.reading_status],
    ["Valutazione", book.rating ? `${book.rating}/5` : ""],
    ["Note", book.notes],
  ].filter(([, value]) => value);

  return `<article class="print-book">
    <div>${book.cover_url ? `<img src="${escapeHtml(book.cover_url)}">` : LibraryQR.svg(book.internal_code, { size: 150 })}</div>
    <div><h2>${escapeHtml(book.title)}</h2>${rows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}</div>
  </article>`;
}

function printSingleBook(book) {
  if (!book) return;
  printWindow(`Scheda ${book.title}`, `<h1>Biblioteca dello Studio</h1>${bookPrintHtml(book)}`);
}

function printCatalog() {
  const books = filteredBooks();
  printWindow("Catalogo Biblioteca dello Studio",
    `<h1>Biblioteca dello Studio</h1><p>${books.length} libri</p>${books.map(bookPrintHtml).join("")}`);
}

function openQrDialog(scope = "filtered") {
  $("#qrScope").value = scope;
  renderQrPreview();
  $("#qrDialog").showModal();
}

function startInventory() {
  const room = $("#inventoryRoom").value;
  const shelf = $("#inventoryShelf").value;
  const expected = state.books.filter((book) => (!room || book.room === room) && (!shelf || book.shelf === shelf));
  currentInventory = {
    room,
    shelf,
    expectedIds: new Set(expected.map((book) => book.id)),
    presentIds: new Set(),
    misplacedIds: new Set(),
    unknownCodes: [],
  };
  $("#inventoryStatus").textContent = `Controllo avviato: ${expected.length} libri attesi.`;
  renderInventoryResults();
  $("#inventoryCodeInput").focus();
}

function identifyInventoryCode(raw) {
  const entered = String(raw || "").trim().toUpperCase();
  const normalized = normalizeIsbn(raw);
  return state.books.find((book) =>
    String(book.internal_code || "").toUpperCase() === entered ||
    (normalized && [normalizeIsbn(book.isbn13), normalizeIsbn(book.isbn10)].includes(normalized))
  );
}

function markInventoryCode(raw) {
  if (!currentInventory) startInventory();
  const code = String(raw || "").trim();
  if (!code) return;
  const book = identifyInventoryCode(code);
  if (!book) {
    currentInventory.unknownCodes.push(code);
    $("#inventoryStatus").textContent = `Codice non catalogato: ${code}`;
  } else if (currentInventory.expectedIds.has(book.id)) {
    currentInventory.presentIds.add(book.id);
    $("#inventoryStatus").textContent = `Presente: ${book.title}`;
  } else {
    currentInventory.misplacedIds.add(book.id);
    $("#inventoryStatus").textContent = `Fuori posto: ${book.title}`;
  }
  $("#inventoryCodeInput").value = "";
  renderInventoryResults();
}

function renderInventoryResults() {
  if (!currentInventory) {
    $("#inventoryResults").innerHTML = "<p>Seleziona uno scaffale e avvia il controllo.</p>";
    return;
  }
  const missing = [...currentInventory.expectedIds].filter((id) => !currentInventory.presentIds.has(id))
    .map((id) => state.books.find((book) => book.id === id)).filter(Boolean);
  const misplaced = [...currentInventory.misplacedIds].map((id) => state.books.find((book) => book.id === id)).filter(Boolean);

  $("#inventoryResults").innerHTML = `
    <div class="inventory-summary">
      <article><span>Presenti</span><strong>${currentInventory.presentIds.size}</strong></article>
      <article><span>Mancanti</span><strong>${missing.length}</strong></article>
      <article><span>Fuori posto</span><strong>${misplaced.length}</strong></article>
      <article><span>Sconosciuti</span><strong>${currentInventory.unknownCodes.length}</strong></article>
    </div>
    <div class="inventory-columns">
      <section><h3>Mancanti</h3>${missing.length ? missing.map((book) => `<p>${escapeHtml(book.internal_code)} · ${escapeHtml(book.title)}</p>`).join("") : "<p>Nessuno.</p>"}</section>
      <section><h3>Fuori posto</h3>${misplaced.length ? misplaced.map((book) => `<p>${escapeHtml(book.internal_code)} · ${escapeHtml(book.title)} (${escapeHtml([book.room, book.shelf].filter(Boolean).join(" · "))})</p>`).join("") : "<p>Nessuno.</p>"}</section>
      <section><h3>Non catalogati</h3>${currentInventory.unknownCodes.length ? currentInventory.unknownCodes.map((code) => `<p>${escapeHtml(code)}</p>`).join("") : "<p>Nessuno.</p>"}</section>
    </div>`;
}

async function stopInventoryScanner() {
  if (!state.inventoryScanner) return;
  try { await state.inventoryScanner.stop(); } catch (_) {}
  try { await state.inventoryScanner.clear(); } catch (_) {}
  state.inventoryScanner = null;
  $("#inventoryReader").classList.add("hidden");
  $("#inventoryReader").innerHTML = "";
}

async function startInventoryCamera() {
  try {
    await loadOptionalScript("scanner");
    await stopInventoryScanner();
    $("#inventoryReader").classList.remove("hidden");
    state.inventoryScanner = new Html5Qrcode("inventoryReader");
    await state.inventoryScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 180 } },
      (decoded) => markInventoryCode(decoded),
      () => {}
    );
  } catch (error) {
    toast(error.message || "Fotocamera non disponibile.", true);
  }
}

async function lookupMetadataForExisting(book) {
  const isbn = book.isbn13 || book.isbn10;
  if (!isbn) throw new Error("Questa scheda non ha un ISBN.");
  const originalBooks = state.books;
  try {
    state.books = state.books.filter((item) => item.id !== book.id);
    const result = await lookupBook(isbn);
    return result.book;
  } finally {
    state.books = originalBooks;
  }
}

function fillMissingMetadata(book, metadata) {
  const copy = { ...book };
  const fields = [
    "subtitle", "publisher", "publication_date", "publication_year", "pages",
    "language", "cover_url", "publication_place", "series", "series_number",
    "edition", "dewey"
  ];
  for (const field of fields) if (!copy[field] && metadata[field]) copy[field] = metadata[field];
  if (!(copy.authors || []).length && metadata.authors?.length) copy.authors = metadata.authors;
  if (!(copy.categories || []).length && metadata.categories?.length) copy.categories = metadata.categories;
  copy.source = [copy.source, metadata.source].filter(Boolean).join(" + ");
  copy.updated_at = new Date().toISOString();
  copy.catalog_status = missingCatalogFields(copy).length ? "Da verificare" : "Completa";
  return copy;
}

async function completeBookOnline(book) {
  const metadata = await lookupMetadataForExisting(book);
  await saveSnapshot("Prima del completamento online");
  const updated = fillMissingMetadata(book, metadata);
  await dbSave(updated);
  await refresh();
  return updated;
}

async function completeCurrentBook() {
  const id = Number($("#bookId").value);
  const book = state.books.find((item) => item.id === id);
  if (!book) return toast("Salva prima la scheda, poi completala online.", true);
  $("#completeOnlineButton").disabled = true;
  try {
    const updated = await completeBookOnline(book);
    fillForm(updated);
    toast("Scheda completata con i dati disponibili.");
  } catch (error) {
    toast(error.message || "Completamento non riuscito.", true);
  } finally {
    $("#completeOnlineButton").disabled = false;
  }
}

async function completeMultipleBooks() {
  const chosen = selectedBooks().length ? selectedBooks() : state.books.filter((book) => missingCatalogFields(book).length && (book.isbn13 || book.isbn10));
  if (!chosen.length) return toast("Nessuna scheda con ISBN da completare.", true);
  if (!confirm(`Cercare online i dati mancanti per ${chosen.length} libri?`)) return;
  let completed = 0;
  for (const book of chosen) {
    try {
      await completeBookOnline(book);
      completed += 1;
      await new Promise((resolve) => setTimeout(resolve, 350));
    } catch (_) {}
  }
  toast(`${completed} schede completate.`);
}

async function normalizeCatalog() {
  if (!state.books.length) return;
  await saveSnapshot("Prima della normalizzazione");
  for (const book of state.books) {
    const copy = {
      ...book,
      authors: canonicalizeAuthorList(book.authors || []),
      categories: canonicalizeTermList(book.categories || [], "categories"),
      tags: canonicalizeTermList(book.tags || [], "tags"),
      collections: canonicalizeTermList(book.collections || [], "collections"),
      updated_at: new Date().toISOString(),
    };
    await dbSave(copy);
  }
  await refresh();
  toast("Autori, categorie, liste ed etichette uniformati.");
}

function openSettings() {
  const settings = getInventoryCodeSettings();
  $("#codePrefix").value = settings.prefix;
  $("#codeDigits").value = settings.digits;
  $("#settingsDialog").showModal();
}

async function installApplication() {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    return;
  }
  toast("Usa il menu del browser e scegli “Installa app” o “Aggiungi a schermata Home”.");
}

function bindDialogCloseButtons() {
  document.querySelectorAll("[data-close]").forEach((button) => {
    if (button.dataset.enhancedCloseBound) return;
    button.dataset.enhancedCloseBound = "1";
    button.addEventListener("click", async () => {
      const dialog = document.getElementById(button.dataset.close);
      if (dialog === $("#inventoryDialog")) await stopInventoryScanner();
      if (dialog?.open) dialog.close();
    });
  });
}

booksGrid.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-book]");
  if (!checkbox) return;
  const id = Number(checkbox.dataset.selectBook);
  if (checkbox.checked) state.selectedBookIds.add(id);
  else state.selectedBookIds.delete(id);
  updateSelectionBar();
  checkbox.closest(".book-card")?.classList.toggle("selected", checkbox.checked);
});

booksGrid.addEventListener("click", (event) => {
  const qr = event.target.closest("[data-card-qr]");
  if (qr) {
    state.selectedBookIds = new Set([Number(qr.dataset.cardQr)]);
    openQrDialog("selected");
    return;
  }
  const print = event.target.closest("[data-card-print]");
  if (print) printSingleBook(state.books.find((book) => book.id === Number(print.dataset.cardPrint)));
});

$("#statisticsButton").addEventListener("click", () => {
  renderStatistics();
  $("#statisticsDialog").showModal();
});
$("#toolsButton").addEventListener("click", () => $("#toolsDialog").showModal());
$("#advancedFiltersButton").addEventListener("click", () => $("#advancedFiltersDialog").showModal());
$("#applyAdvancedFiltersButton").addEventListener("click", applyAdvancedFilters);
$("#clearAdvancedFiltersButton").addEventListener("click", clearAdvancedFilters);
$("#viewMode").addEventListener("change", renderBooks);
$("#selectionModeButton").addEventListener("click", () => toggleSelectionMode());
$("#selectFilteredButton").addEventListener("click", () => {
  for (const book of filteredBooks()) state.selectedBookIds.add(book.id);
  renderBooks();
});
$("#clearSelectionButton").addEventListener("click", () => {
  state.selectedBookIds.clear();
  renderBooks();
});
$("#bulkEditButton").addEventListener("click", () => {
  $("#bulkCountText").textContent = `${selectedBooks().length} libri selezionati`;
  $("#bulkDialog").showModal();
});
$("#applyBulkButton").addEventListener("click", applyBulkEdit);
$("#selectedQrButton").addEventListener("click", () => openQrDialog("selected"));
$("#findDuplicatesButton").addEventListener("click", () => {
  renderDuplicates();
  $("#duplicatesDialog").showModal();
});
$("#duplicatesContent").addEventListener("click", (event) => {
  const button = event.target.closest("[data-merge-left]");
  if (button) void mergeBooks(Number(button.dataset.mergeLeft), Number(button.dataset.mergeRight));
});
$("#qrLabelsButton").addEventListener("click", () => openQrDialog(selectedBooks().length ? "selected" : "filtered"));
$("#generateQrPreviewButton").addEventListener("click", renderQrPreview);
$("#printQrButton").addEventListener("click", printQrLabels);
$("#qrScope").addEventListener("change", renderQrPreview);
$("#qrColumns").addEventListener("change", renderQrPreview);
$("#qrIncludeTitle").addEventListener("change", renderQrPreview);
$("#printCatalogButton").addEventListener("click", printCatalog);
$("#inventoryButton").addEventListener("click", () => {
  updateCatalogOptions();
  $("#inventoryDialog").showModal();
  renderInventoryResults();
});
$("#startInventoryButton").addEventListener("click", startInventory);
$("#inventoryCameraButton").addEventListener("click", startInventoryCamera);
$("#markInventoryButton").addEventListener("click", () => markInventoryCode($("#inventoryCodeInput").value));
$("#inventoryCodeInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    markInventoryCode(event.target.value);
  }
});
$("#completeAllButton").addEventListener("click", completeMultipleBooks);
$("#completeOnlineButton").addEventListener("click", completeCurrentBook);
$("#normalizeCatalogButton").addEventListener("click", normalizeCatalog);
$("#undoButton").addEventListener("click", undoLastChange);
$("#snapshotsButton").addEventListener("click", async () => {
  await renderSnapshots();
  $("#snapshotsDialog").showModal();
});
$("#snapshotsContent").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-restore-snapshot]");
  if (!button) return;
  const snapshot = (await snapshotGetAll()).find((item) => item.id === Number(button.dataset.restoreSnapshot));
  await restoreSnapshot(snapshot);
});
$("#settingsButton").addEventListener("click", openSettings);
$("#saveSettingsButton").addEventListener("click", () => {
  const settings = saveInventoryCodeSettings($("#codePrefix").value, $("#codeDigits").value);
  $("#settingsDialog").close();
  toast(`Nuovi codici: ${settings.prefix}-${"0".repeat(settings.digits)}`);
});
$("#installAppButton").addEventListener("click", installApplication);
$("#formQrButton").addEventListener("click", () => {
  const id = Number($("#bookId").value);
  if (!id) return toast("Salva prima il libro.", true);
  state.selectedBookIds = new Set([id]);
  openQrDialog("selected");
});
$("#formPrintButton").addEventListener("click", () => {
  const id = Number($("#bookId").value);
  const book = state.books.find((item) => item.id === id);
  if (book) printSingleBook(book);
  else toast("Salva prima il libro.", true);
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker:", error));
  });
}

bindDialogCloseButtons();
refresh().then(() => automaticDailySnapshot()).catch(console.error);
