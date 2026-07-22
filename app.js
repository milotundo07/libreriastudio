import { APP_VERSION, COVER_AUTO_ACCEPT_THRESHOLD } from "./config.js";
import {
  deleteCover,
  emptyTrash,
  getCover,
  getMeta,
  getTrash,
  importBooksTransaction,
  migrateDatabaseBooks,
  moveBookToTrash,
  nextInternalCode,
  openDatabase,
  restorePreImportSnapshot,
  restoreTrashItem,
  saveBook,
  saveCover,
  setMeta,
} from "./db.js";
import { base64ToBlob, createBackupPayload, getLastBackupAt, parseBackupPayload } from "./backup.js";
import { exportExcel, parseExcelFile } from "./excel.js";
import { lookupByIsbn, metadataFromOcr, searchByCoverText } from "./catalogs.js";
import { validateIsbn } from "./isbn.js";
import { emptyBook, editionFingerprint, normalizeBook, validateBook } from "./model.js";
import { cancelOcr, recognizeCover } from "./ocr.js";
import { startScanner, stopScanner } from "./scanner.js";
import {
  cloudConfigured,
  createAccount,
  getCloudSession,
  onCloudAuthChange,
  sendPasswordReset,
  signIn,
  signOut,
  startRealtime,
  stopRealtime,
  syncLibrary,
  updatePassword,
} from "./cloud.js";
import {
  $, $$, canvasResizeImage, debounce, downloadText, escapeHtml, formatDate, formatDateTime,
  normalizeText, objectUrl, splitList,
} from "./utils.js";

const state = {
  books: [],
  trash: [],
  currentBookId: null,
  detailBookId: null,
  dirty: false,
  pendingCoverBlob: null,
  removeExistingCover: false,
  coverObjectUrls: new Map(),
  importPayload: null,
  importFileName: "",
  coverSearchResults: [],
  coverOcrText: "",
  coverOcrBlob: null,
  coverController: null,
  isbnController: null,
  cloudSession: null,
  cloudSyncTimer: null,
  cloudSyncing: false,
  cloudLastError: "",
  authRecovery: false,
  renderId: 0,
};

const dialogs = {
  book: $("#bookDialog"),
  details: $("#detailsDialog"),
  scanner: $("#scannerDialog"),
  cover: $("#coverDialog"),
  data: $("#dataDialog"),
  import: $("#importDialog"),
  trash: $("#trashDialog"),
  account: $("#accountDialog"),
};

function toast(message, isError = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", isError);
  element.classList.add("visible");
  clearTimeout(element.timer);
  element.timer = setTimeout(() => element.classList.remove("visible"), 3800);
}

function announce(message) {
  $("#globalLiveRegion").textContent = "";
  requestAnimationFrame(() => { $("#globalLiveRegion").textContent = message; });
}

function setCloudStatus(kind, message) {
  const status = $("#cloudStatus");
  status.classList.remove("online", "syncing", "error");
  if (kind) status.classList.add(kind);
  $("#cloudStatusText").textContent = message;
}

async function renderAccountState() {
  const configured = cloudConfigured();
  const session = state.cloudSession;
  $("#cloudNotConfiguredPanel").classList.toggle("hidden", configured);
  $("#signedOutPanel").classList.toggle("hidden", !configured || Boolean(session));
  $("#signedInPanel").classList.toggle("hidden", !configured || !session || state.authRecovery);
  $("#passwordRecoveryPanel").classList.toggle("hidden", !configured || !session || !state.authRecovery);

  if (!configured) {
    $("#accountButton").textContent = "Configura account";
    setCloudStatus("", "Solo locale");
    return;
  }
  if (!session) {
    $("#accountButton").textContent = "Accedi";
    setCloudStatus(navigator.onLine ? "" : "error", navigator.onLine ? "Non connesso" : "Offline");
    return;
  }
  $("#accountButton").textContent = "Account";
  $("#accountEmail").textContent = session.user.email || "Account Supabase";
  const lastSync = await getMeta("last_cloud_sync");
  $("#lastCloudSyncText").textContent = lastSync?.completed_at
    ? `Ultima sincronizzazione: ${formatDateTime(lastSync.completed_at)}`
    : "Non ancora sincronizzato.";
  if (!state.cloudSyncing) setCloudStatus(navigator.onLine ? "online" : "error", navigator.onLine ? "Sincronizzato" : "Offline");
}

async function runCloudSync({ silent = false } = {}) {
  if (!cloudConfigured() || !state.cloudSession || state.cloudSyncing) return null;
  state.cloudSyncing = true;
  state.cloudLastError = "";
  setCloudStatus("syncing", "Sincronizzazione…");
  $("#cloudSyncProgress").classList.remove("hidden");
  $("#cloudSyncProgress").value = 0;
  $("#syncNowButton").disabled = true;
  try {
    const result = await syncLibrary({
      onProgress: (message, progress) => {
        $("#cloudSyncMessage").textContent = message;
        $("#cloudSyncProgress").value = progress;
      },
    });
    await refresh();
    $("#lastCloudSyncText").textContent = `Ultima sincronizzazione: ${formatDateTime(result.completedAt)}`;
    setCloudStatus("online", "Sincronizzato");
    if (!silent) toast(`Cloud aggiornato: ${result.pushed} inviati, ${result.pulled} ricevuti.`);
    return result;
  } catch (error) {
    console.error("Sincronizzazione cloud:", error);
    state.cloudLastError = error.message || "Sincronizzazione non riuscita.";
    $("#cloudSyncMessage").textContent = state.cloudLastError;
    setCloudStatus("error", navigator.onLine ? "Errore cloud" : "Offline");
    if (!silent) toast(state.cloudLastError, true);
    return null;
  } finally {
    state.cloudSyncing = false;
    $("#cloudSyncProgress").classList.add("hidden");
    $("#syncNowButton").disabled = false;
    await renderAccountState();
  }
}

function scheduleCloudSync(delay = 900) {
  if (!cloudConfigured() || !state.cloudSession) return;
  clearTimeout(state.cloudSyncTimer);
  state.cloudSyncTimer = setTimeout(() => void runCloudSync({ silent: true }), delay);
}

async function applyCloudSession(event, session) {
  state.cloudSession = session;
  state.authRecovery = event === "PASSWORD_RECOVERY";
  stopRealtime();
  if (session?.user) {
    startRealtime(session.user.id, () => scheduleCloudSync(500));
    if (event !== "INITIAL_SESSION" || navigator.onLine) scheduleCloudSync(250);
  }
  await renderAccountState();
  if (state.authRecovery) showDialog(dialogs.account);
}

async function openAccountDialog() {
  await renderAccountState();
  $("#authMessage").textContent = "";
  $("#cloudSyncMessage").textContent = state.cloudLastError;
  showDialog(dialogs.account);
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

async function closeDialog(dialog, { force = false } = {}) {
  if (dialog === dialogs.book && state.dirty && !force) {
    const discard = confirm("Chiudere senza salvare le modifiche?");
    if (!discard) return false;
  }
  if (dialog === dialogs.scanner) await stopScanner();
  if (dialog === dialogs.cover) {
    state.coverController?.abort();
    await cancelOcr();
  }
  dialog.close();
  if (dialog === dialogs.book) resetBookFormState();
  return true;
}

function resetBookFormState() {
  state.currentBookId = null;
  state.dirty = false;
  state.pendingCoverBlob = null;
  state.removeExistingCover = false;
  $("#bookForm").reset();
  $("#customFields").innerHTML = "";
  $("#coverPreview").removeAttribute("src");
  $("#coverPreview").classList.add("hidden");
  $("#coverPlaceholder").classList.remove("hidden");
  $("#removeCoverButton").classList.add("hidden");
}

function cleanupCoverUrls() {
  for (const url of state.coverObjectUrls.values()) URL.revokeObjectURL(url);
  state.coverObjectUrls.clear();
}

async function coverUrlFor(book) {
  if (book.cover_id) {
    if (state.coverObjectUrls.has(book.cover_id)) return state.coverObjectUrls.get(book.cover_id);
    const blob = await getCover(book.cover_id);
    if (blob) {
      const url = objectUrl(blob);
      state.coverObjectUrls.set(book.cover_id, url);
      return url;
    }
  }
  return book.cover_url || "";
}

function bookMatches(book, queryTokens, status, room) {
  const text = book.search_text || normalizeText(JSON.stringify(book));
  return queryTokens.every((token) => text.includes(token))
    && (!status || book.catalog_status === status)
    && (!room || book.room === room);
}

function sortedBooks(books, sort) {
  return [...books].sort((a, b) => {
    if (sort === "author") return String(a.authors?.[0] || "").localeCompare(String(b.authors?.[0] || ""), "it");
    if (sort === "publisher") return String(a.publisher || "").localeCompare(String(b.publisher || ""), "it");
    if (sort === "code") return String(a.internal_code || "").localeCompare(String(b.internal_code || ""), "it", { numeric: true });
    if (sort === "year_desc") return Number(b.publication_year || 0) - Number(a.publication_year || 0);
    if (sort === "updated_desc") return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    return String(a.title || "").localeCompare(String(b.title || ""), "it");
  });
}

async function renderBooks() {
  const renderId = ++state.renderId;
  const queryTokens = normalizeText($("#searchInput").value).split(" ").filter(Boolean);
  const status = $("#statusFilter").value;
  const room = $("#roomFilter").value;
  const sort = $("#sortSelect").value;
  const books = sortedBooks(state.books.filter((book) => bookMatches(book, queryTokens, status, room)), sort);
  const covers = await Promise.all(books.map((book) => coverUrlFor(book)));
  if (renderId !== state.renderId) return;
  const grid = $("#booksGrid");
  grid.innerHTML = "";

  for (const [index, book] of books.entries()) {
    const article = document.createElement("article");
    article.className = "book-card";
    article.dataset.bookId = book.id;
    const cover = covers[index];
    const edition = [book.publisher, book.publication_place, book.publication_year].filter(Boolean).join(", ");
    const location = [book.room, book.shelf].filter(Boolean).join(" · ");
    const authors = book.authors?.join(", ") || "Autore non indicato";
    const coverMarkup = cover
      ? `<img class="book-card-cover" src="${escapeHtml(cover)}" alt="Copertina di ${escapeHtml(book.title)}" loading="lazy">`
      : `<div class="card-cover-placeholder">Nessuna copertina</div>`;
    article.innerHTML = `
      <div>${coverMarkup}</div>
      <div class="book-card-main">
        <h3>${escapeHtml(book.title || "Titolo non indicato")}</h3>
        <p>${escapeHtml(authors)}</p>
        ${edition ? `<p>${escapeHtml(edition)}</p>` : ""}
        ${location ? `<p>${escapeHtml(location)}</p>` : ""}
        <div class="book-meta">
          <span class="pill ${book.catalog_status === "Da verificare" ? "warning" : ""}">${escapeHtml(book.catalog_status)}</span>
          <span class="pill">${escapeHtml(book.internal_code)}</span>
          ${book.copy_number > 1 ? `<span class="pill">Copia ${book.copy_number}</span>` : ""}
          ${book.dewey ? `<span class="pill">Dewey ${escapeHtml(book.dewey)}</span>` : ""}
        </div>
        <div class="card-actions">
          <button class="button secondary" type="button" data-action="details" aria-label="Apri i dettagli di ${escapeHtml(book.title)}">Dettagli</button>
          <button class="button secondary" type="button" data-action="edit" aria-label="Modifica ${escapeHtml(book.title)}">Modifica</button>
        </div>
      </div>`;
    const image = article.querySelector("img");
    image?.addEventListener("error", () => {
      image.replaceWith(Object.assign(document.createElement("div"), { className: "card-cover-placeholder", textContent: "Copertina non disponibile" }));
    }, { once: true });
    grid.appendChild(article);
  }

  const hasResults = books.length > 0;
  grid.classList.toggle("hidden", !hasResults);
  $("#emptyState").classList.toggle("hidden", hasResults);
  $("#emptyStateText").textContent = state.books.length
    ? "Nessun esemplare corrisponde ai filtri attuali."
    : "Aggiungi il primo esemplare manualmente, tramite ISBN o fotografando la copertina.";
  $("#resultsSummary").textContent = `${books.length} ${books.length === 1 ? "risultato" : "risultati"} su ${state.books.length} esemplari`;
}

function renderStats() {
  $("#statTotal").textContent = state.books.length;
  $("#statEditions").textContent = new Set(state.books.map(editionFingerprint)).size;
  $("#statAuthors").textContent = new Set(state.books.flatMap((book) => book.authors || []).map(normalizeText).filter(Boolean)).size;
  $("#statVerify").textContent = state.books.filter((book) => book.catalog_status !== "Completa").length;
}

function renderRoomFilter() {
  const select = $("#roomFilter");
  const current = select.value;
  const rooms = [...new Set(state.books.map((book) => book.room).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  select.innerHTML = `<option value="">Tutte le stanze</option>${rooms.map((room) => `<option>${escapeHtml(room)}</option>`).join("")}`;
  if (rooms.includes(current)) select.value = current;
}

async function refresh() {
  cleanupCoverUrls();
  state.books = await migrateDatabaseBooks();
  state.trash = await getTrash();
  renderStats();
  renderRoomFilter();
  await renderBooks();
  renderTrashSummary();
}

function addCustomField(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "custom-field-row";
  row.innerHTML = `
    <label><span class="visually-hidden">Nome campo personalizzato</span><input class="custom-key" placeholder="Nome del campo" value="${escapeHtml(key)}"></label>
    <label><span class="visually-hidden">Valore campo personalizzato</span><input class="custom-value" placeholder="Valore" value="${escapeHtml(value)}"></label>
    <button class="button secondary" type="button" aria-label="Rimuovi campo personalizzato">Rimuovi</button>`;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    state.dirty = true;
  });
  $("#customFields").appendChild(row);
}

async function setFormCover(book) {
  const url = await coverUrlFor(book);
  const image = $("#coverPreview");
  if (url) {
    image.src = url;
    image.classList.remove("hidden");
    $("#coverPlaceholder").classList.add("hidden");
    $("#removeCoverButton").classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    $("#coverPlaceholder").classList.remove("hidden");
    $("#removeCoverButton").classList.add("hidden");
  }
}

async function openBookForm(input = {}, { duplicate = false } = {}) {
  resetBookFormState();
  const existing = Number(input.id) ? normalizeBook(input) : normalizeBook({ ...emptyBook(), ...input }, { preserveId: false });
  if (duplicate) {
    delete existing.id;
    existing.internal_code = "";
    existing.copy_number = Math.max(1, Number(existing.copy_number || 1) + 1);
    existing.created_at = new Date().toISOString();
    existing.updated_at = existing.created_at;
  }
  state.currentBookId = existing.id || null;
  $("#bookId").value = existing.id || "";
  $("#createdAt").value = existing.created_at || "";
  const mapping = {
    internal_code: "internalCode", title: "title", subtitle: "subtitle", original_title: "originalTitle",
    original_language: "originalLanguage", contributors: "contributors", isbn13: "isbn13", isbn10: "isbn10",
    language: "language", publication_year: "publicationYear", publication_date: "publicationDate",
    publication_place: "publicationPlace", edition: "edition", printing: "printing", series: "series",
    series_number: "seriesNumber", pages: "pages", publisher: "publisher", dewey: "dewey", binding: "binding",
    dimensions: "dimensions", room: "room", shelf: "shelf", copy_number: "copyNumber", catalog_status: "catalogStatus",
    condition: "condition", provenance: "provenance", acquisition_date: "acquisitionDate",
    acquisition_source: "acquisitionSource", acquisition_price: "acquisitionPrice", notes: "notes",
    cover_url: "coverUrl", source: "dataSource",
  };
  for (const [key, id] of Object.entries(mapping)) $("#" + id).value = existing[key] ?? "";
  $("#authors").value = (existing.authors || []).join("; ");
  $("#categories").value = (existing.categories || []).join("; ");
  Object.entries(existing.custom_fields || {}).forEach(([key, value]) => addCustomField(key, value));
  $("#bookDialogEyebrow").textContent = existing.id ? "SCHEDA ESEMPLARE" : duplicate ? "NUOVA COPIA" : "NUOVO ESEMPLARE";
  $("#bookDialogTitle").textContent = existing.id ? "Modifica libro" : duplicate ? "Duplica esemplare" : "Aggiungi libro";
  $("#trashBookButton").classList.toggle("hidden", !existing.id);
  $("#duplicateBookButton").classList.toggle("hidden", !existing.id);
  await setFormCover(existing);
  showDialog(dialogs.book);
  state.dirty = false;
  validateIsbnFields();
}

function collectBookForm() {
  const customFields = {};
  for (const row of $$(".custom-field-row", $("#customFields"))) {
    const key = $(".custom-key", row).value.trim();
    const value = $(".custom-value", row).value.trim();
    if (key && value && !Object.prototype.hasOwnProperty.call(customFields, key)) customFields[key] = value;
  }
  const id = Number($("#bookId").value) || undefined;
  const previous = id ? state.books.find((book) => book.id === id) || {} : {};
  return {
    ...previous,
    ...(id ? { id } : {}),
    created_at: $("#createdAt").value || new Date().toISOString(),
    internal_code: $("#internalCode").value.trim(),
    title: $("#title").value.trim(),
    subtitle: $("#subtitle").value.trim(),
    original_title: $("#originalTitle").value.trim(),
    original_language: $("#originalLanguage").value.trim(),
    authors: splitList($("#authors").value),
    contributors: $("#contributors").value.trim(),
    isbn13: $("#isbn13").value.trim(),
    isbn10: $("#isbn10").value.trim(),
    language: $("#language").value.trim(),
    publication_year: $("#publicationYear").value,
    publication_date: $("#publicationDate").value.trim(),
    publication_place: $("#publicationPlace").value.trim(),
    edition: $("#edition").value.trim(),
    printing: $("#printing").value.trim(),
    series: $("#series").value.trim(),
    series_number: $("#seriesNumber").value.trim(),
    pages: $("#pages").value,
    publisher: $("#publisher").value.trim(),
    dewey: $("#dewey").value.trim(),
    categories: splitList($("#categories").value),
    binding: $("#binding").value.trim(),
    dimensions: $("#dimensions").value.trim(),
    room: $("#room").value.trim(),
    shelf: $("#shelf").value.trim(),
    copy_number: $("#copyNumber").value || 1,
    catalog_status: $("#catalogStatus").value,
    condition: $("#condition").value.trim(),
    provenance: $("#provenance").value.trim(),
    acquisition_date: $("#acquisitionDate").value,
    acquisition_source: $("#acquisitionSource").value.trim(),
    acquisition_price: $("#acquisitionPrice").value.trim(),
    notes: $("#notes").value.trim(),
    cover_url: $("#coverUrl").value.trim(),
    source: $("#dataSource").value.trim(),
    custom_fields: customFields,
  };
}

function validateIsbnFields() {
  const values = [$("#isbn13").value.trim(), $("#isbn10").value.trim()].filter(Boolean);
  const message = $("#isbnValidationMessage");
  if (!values.length) {
    message.textContent = "";
    message.classList.remove("error");
    return true;
  }
  const invalid = values.map(validateIsbn).find((result) => !result.valid);
  if (invalid) {
    message.textContent = `${invalid.value || "Il codice"} non è un ISBN valido.`;
    message.classList.add("error");
    return false;
  }
  message.textContent = "ISBN verificato correttamente.";
  message.classList.remove("error");
  return true;
}

async function saveCurrentBook(event) {
  event.preventDefault();
  if (!$("#bookForm").reportValidity() || !validateIsbnFields()) return;
  const validation = validateBook(collectBookForm());
  if (!validation.valid) {
    toast(validation.errors.join(" "), true);
    return;
  }
  const button = $("#saveBookButton");
  button.disabled = true;
  try {
    const book = validation.book;
    const previous = book.id ? state.books.find((item) => item.id === book.id) : null;
    if (state.pendingCoverBlob) {
      book.cover_id = await saveCover(state.pendingCoverBlob, previous?.cover_id || "");
      book.cover_url = "";
      book.cloud_cover_deleted = false;
    } else if (state.removeExistingCover) {
      if (previous?.cover_id) await deleteCover(previous.cover_id);
      book.cover_id = "";
      book.cloud_cover_deleted = true;
    }
    if (!book.internal_code) book.internal_code = nextInternalCode(state.books);
    await saveBook(book);
    scheduleCloudSync();
    state.dirty = false;
    await closeDialog(dialogs.book, { force: true });
    await refresh();
    toast(book.id ? "Scheda aggiornata." : "Esemplare aggiunto alla biblioteca.");
  } catch (error) {
    console.error(error);
    toast(error.message || "Impossibile salvare il libro.", true);
  } finally {
    button.disabled = false;
  }
}

async function showBookDetails(book) {
  state.detailBookId = book.id;
  $("#detailsDialogTitle").textContent = book.title || "Dettagli libro";
  const cover = await coverUrlFor(book);
  const details = [
    ["Autori", book.authors?.join(", ")], ["Sottotitolo", book.subtitle], ["Titolo originale", book.original_title],
    ["Altri responsabili", book.contributors], ["Editore", book.publisher], ["Luogo", book.publication_place],
    ["Anno", book.publication_year], ["Edizione", book.edition], ["Ristampa", book.printing], ["Collana", [book.series, book.series_number].filter(Boolean).join(" · ")],
    ["Pagine", book.pages], ["ISBN-13", book.isbn13], ["ISBN-10", book.isbn10], ["Dewey", book.dewey],
    ["Categorie", book.categories?.join(", ")], ["Lingua", book.language], ["Stanza", book.room], ["Scaffale", book.shelf],
    ["Codice inventario", book.internal_code], ["Numero copia", book.copy_number], ["Condizione", book.condition],
    ["Provenienza", book.provenance], ["Data acquisizione", formatDate(book.acquisition_date)], ["Fonte acquisto", book.acquisition_source],
    ["Prezzo", book.acquisition_price], ["Stato scheda", book.catalog_status], ["Fonte dati", book.source], ["Note", book.notes],
    ["Inserito", formatDateTime(book.created_at)], ["Ultima modifica", formatDateTime(book.updated_at)],
    ...Object.entries(book.custom_fields || {}),
  ].filter(([, value]) => value !== "" && value !== null && value !== undefined);
  $("#detailsContent").innerHTML = `
    <div class="details-hero">
      ${cover ? `<img class="details-cover" src="${escapeHtml(cover)}" alt="Copertina di ${escapeHtml(book.title)}">` : `<div class="details-cover-placeholder">Nessuna copertina</div>`}
      <div>
        <div class="eyebrow">${escapeHtml(book.internal_code)}</div>
        <div class="details-title">${escapeHtml(book.title)}</div>
        <p>${escapeHtml(book.authors?.join(", ") || "Autore non indicato")}</p>
        <div class="book-meta"><span class="pill">${escapeHtml(book.catalog_status)}</span>${book.isbn13 ? `<span class="pill">ISBN ${escapeHtml(book.isbn13)}</span>` : ""}</div>
      </div>
    </div>
    <dl class="details-grid">${details.map(([label, value]) => `<div class="detail-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
  showDialog(dialogs.details);
}

async function lookupIsbnAndOpen(raw) {
  const result = validateIsbn(raw);
  if (!result.valid) {
    toast("L’ISBN non supera il controllo della cifra finale.", true);
    return;
  }
  state.isbnController?.abort();
  state.isbnController = new AbortController();
  const status = $("#scanStatus");
  status.classList.remove("error");
  status.textContent = `Cerco l’edizione ${result.value} nei cataloghi…`;
  $("#lookupManualIsbnButton").disabled = true;
  try {
    const metadata = await lookupByIsbn(result.value, { signal: state.isbnController.signal });
    await closeDialog(dialogs.scanner, { force: true });
    const sameEditionCopies = state.books.filter((book) => book.edition_fingerprint === editionFingerprint(metadata)).length;
    await openBookForm({
      ...metadata,
      copy_number: sameEditionCopies + 1,
      catalog_status: metadata.confidence >= 0.9 ? "Completa" : "Da verificare",
    });
    toast("Edizione trovata. Controlla i dati e salva l’esemplare.");
  } catch (error) {
    if (error.name === "AbortError") return;
    status.textContent = error.message || "Ricerca non riuscita.";
    status.classList.add("error");
    toast(status.textContent, true);
  } finally {
    $("#lookupManualIsbnButton").disabled = false;
  }
}

async function openScannerDialog() {
  $("#manualIsbnInput").value = "";
  $("#scanStatus").textContent = "Avvio della fotocamera…";
  showDialog(dialogs.scanner);
  try {
    await startScanner({
      elementId: "scannerReader",
      onDetected: (isbn) => void lookupIsbnAndOpen(isbn),
      onStatus: (message, error = false) => {
        $("#scanStatus").textContent = message;
        $("#scanStatus").classList.toggle("error", error);
      },
    });
  } catch (error) {
    $("#scanStatus").textContent = `${error.message} Puoi inserire l’ISBN manualmente.`;
    $("#scanStatus").classList.add("error");
  }
}

function resetCoverDialog() {
  state.coverController?.abort();
  state.coverController = null;
  state.coverSearchResults = [];
  state.coverOcrText = "";
  state.coverOcrBlob = null;
  $("#coverPhotoInput").value = "";
  $("#coverPhotoPreview").removeAttribute("src");
  $("#coverPreviewPanel").classList.add("hidden");
  $("#coverResultsSection").classList.add("hidden");
  $("#coverResults").innerHTML = "";
  $("#ocrDetails").classList.add("hidden");
  $("#ocrText").value = "";
  $("#coverProgress").classList.add("hidden");
  $("#coverStatus").textContent = "Foto pronta.";
}

function renderCoverResults(results) {
  const container = $("#coverResults");
  container.innerHTML = results.map((book, index) => `
    <article class="cover-result">
      ${book.cover_url ? `<img src="${escapeHtml(book.cover_url)}" alt="">` : `<div class="cover-result-placeholder">Nessuna copertina</div>`}
      <div>
        <h4>${escapeHtml(book.title)}</h4>
        <p>${escapeHtml(book.authors?.join(", ") || "Autore non indicato")}</p>
        <p>${escapeHtml([book.publisher, book.publication_year].filter(Boolean).join(", "))}</p>
        <p>${escapeHtml(book.source)} · <span class="confidence">${Math.round(book.confidence * 100)}%</span></p>
      </div>
      <button class="button primary" type="button" data-cover-index="${index}">Usa questa edizione</button>
    </article>`).join("");
  $("#coverResultsSection").classList.remove("hidden");
}

async function performCoverSearch(text) {
  state.coverController?.abort();
  state.coverController = new AbortController();
  $("#coverStatus").textContent = "Cerco le edizioni nei cataloghi…";
  const result = await searchByCoverText(text, { signal: state.coverController.signal });
  state.coverSearchResults = result.results;
  if (!result.results.length) {
    $("#coverStatus").textContent = "Nessuna corrispondenza abbastanza affidabile. Puoi creare una scheda dai dati letti.";
    $("#coverResultsSection").classList.remove("hidden");
    $("#coverResults").innerHTML = "<p class=\"muted\">Nessuna edizione proposta.</p>";
    return;
  }
  const best = result.results[0];
  const message = best.confidence >= COVER_AUTO_ACCEPT_THRESHOLD
    ? `Corrispondenza molto probabile: ${best.title}. Controllala prima di usarla.`
    : `Ho trovato ${result.results.length} possibili edizioni. Scegli quella corretta.`;
  $("#coverStatus").textContent = message;
  renderCoverResults(result.results);
}

async function handleCoverPhoto(file) {
  resetCoverDialog();
  showDialog(dialogs.cover);
  state.coverController = new AbortController();
  const previewBlob = await canvasResizeImage(file, { maxDimension: 900, quality: 0.78 });
  const previewUrl = objectUrl(previewBlob);
  $("#coverPhotoPreview").src = previewUrl;
  $("#coverPreviewPanel").classList.remove("hidden");
  $("#coverProgress").classList.remove("hidden");
  try {
    const result = await recognizeCover(file, {
      signal: state.coverController.signal,
      onProgress: (progress, message) => {
        $("#coverProgress").value = progress;
        $("#coverStatus").textContent = message;
      },
    });
    state.coverOcrText = result.text;
    state.coverOcrBlob = previewBlob;
    $("#ocrText").value = result.text;
    $("#ocrDetails").classList.remove("hidden");
    await performCoverSearch(result.text);
  } catch (error) {
    if (error.name !== "AbortError") {
      $("#coverStatus").textContent = error.message || "Riconoscimento non riuscito.";
      $("#coverStatus").classList.add("error");
      toast($("#coverStatus").textContent, true);
    }
  } finally {
    $("#coverProgress").classList.add("hidden");
    setTimeout(() => URL.revokeObjectURL(previewUrl), 60000);
  }
}

async function useCoverCandidate(metadata) {
  const localCover = metadata.cover_url ? null : state.coverOcrBlob;
  await closeDialog(dialogs.cover, { force: true });
  await openBookForm({ ...metadata, catalog_status: metadata.confidence >= 0.8 ? "Completa" : "Da verificare" });
  state.pendingCoverBlob = localCover;
}

async function openDataDialog() {
  const lastBackup = await getLastBackupAt();
  $("#lastBackupText").textContent = lastBackup ? `Ultimo backup: ${formatDateTime(lastBackup)}` : "Non risulta ancora alcun backup.";
  await updateStorageStatus();
  renderTrashSummary();
  showDialog(dialogs.data);
}

async function exportJsonBackup() {
  const button = $("#exportJsonButton");
  button.disabled = true;
  try {
    const payload = await createBackupPayload({ includeLocalCovers: true });
    downloadText(`biblioteca-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
    $("#lastBackupText").textContent = `Ultimo backup: ${formatDateTime(payload.exportedAt)}`;
    toast("Backup JSON creato correttamente.");
  } catch (error) {
    toast(error.message || "Backup non riuscito.", true);
  } finally {
    button.disabled = false;
  }
}

async function prepareImport(file, parser) {
  try {
    const parsed = await parser(file);
    state.importPayload = parsed;
    state.importFileName = file.name;
    const duplicates = parsed.books.length - new Set(parsed.books.map(editionFingerprint)).size;
    $("#importSummary").innerHTML = `
      <p><strong>${escapeHtml(file.name)}</strong></p>
      <div class="import-summary-grid">
        <div class="import-summary-card"><strong>${parsed.books.length}</strong><span>Esemplari validi</span></div>
        <div class="import-summary-card"><strong>${parsed.errors.length}</strong><span>Righe escluse</span></div>
        <div class="import-summary-card"><strong>${duplicates}</strong><span>Edizioni ripetute</span></div>
      </div>
      ${parsed.warnings.length ? `<h3>Avvisi</h3><ul class="validation-list">${parsed.warnings.slice(0, 50).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}
      ${parsed.errors.length ? `<h3>Errori esclusi</h3><ul class="validation-list">${parsed.errors.slice(0, 50).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : ""}`;
    $("#confirmImportButton").disabled = parsed.books.length === 0;
    dialogs.data.close();
    showDialog(dialogs.import);
  } catch (error) {
    toast(error.message || "File non leggibile.", true);
  }
}

async function confirmImport() {
  if (!state.importPayload?.books?.length) return;
  const mode = $("input[name=importMode]:checked").value;
  const button = $("#confirmImportButton");
  button.disabled = true;
  try {
    const covers = (state.importPayload.covers || []).map((cover) => ({
      id: cover.id,
      blob: base64ToBlob(cover.data, cover.type),
      updated_at: cover.updated_at,
    }));
    const count = await importBooksTransaction(state.importPayload.books, { mode, covers });
    if (mode === "replace" && state.cloudSession) {
      await setMeta("cloud_replace_pending", {
        user_id: state.cloudSession.user.id,
        requested_at: new Date().toISOString(),
      });
    }
    dialogs.import.close();
    state.importPayload = null;
    await refresh();
    scheduleCloudSync(250);
    toast(`${count} esemplari importati correttamente.`);
  } catch (error) {
    console.error(error);
    toast(error.message || "Importazione non riuscita. Il database non è stato modificato.", true);
  } finally {
    button.disabled = false;
  }
}

function renderTrashSummary() {
  const count = state.trash.length;
  $("#trashSummary").textContent = count ? `${count} ${count === 1 ? "elemento recuperabile" : "elementi recuperabili"}.` : "Nessun elemento nel cestino.";
}

function renderTrashList() {
  const list = $("#trashList");
  if (!state.trash.length) {
    list.innerHTML = "<p class=\"muted\">Il cestino è vuoto.</p>";
    $("#emptyTrashButton").disabled = true;
    return;
  }
  $("#emptyTrashButton").disabled = false;
  list.innerHTML = state.trash.map((item) => `
    <article class="trash-item" data-trash-id="${item.trash_id}">
      <div class="trash-item-main"><h3>${escapeHtml(item.book?.title || "Titolo non indicato")}</h3><p>${escapeHtml(item.book?.internal_code || "")} · eliminato ${escapeHtml(formatDateTime(item.deleted_at))}</p></div>
      <button class="button secondary" type="button" data-action="restore">Ripristina</button>
    </article>`).join("");
}

async function updateStorageStatus() {
  const text = $("#storageStatusText");
  if (!navigator.storage) {
    text.textContent = "Il browser non espone informazioni sulla memoria locale.";
    return;
  }
  const [estimate, persisted] = await Promise.all([
    navigator.storage.estimate?.() || {},
    navigator.storage.persisted?.() || false,
  ]);
  const usedMb = estimate.usage ? (estimate.usage / 1024 / 1024).toFixed(1) : "?";
  const quotaMb = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(0) : "?";
  text.textContent = `Uso stimato: ${usedMb} MB su ${quotaMb} MB. Memoria persistente: ${persisted ? "concessa" : "non concessa"}.`;
  $("#requestPersistenceButton").disabled = persisted || !navigator.storage.persist;
}

function bindEvents() {
  $("#addBookButton").addEventListener("click", () => openBookForm());
  $("#emptyAddButton").addEventListener("click", () => openBookForm());
  $("#scanButton").addEventListener("click", openScannerDialog);
  $("#emptyScanButton").addEventListener("click", openScannerDialog);
  $("#coverScanButton").addEventListener("click", () => { resetCoverDialog(); showDialog(dialogs.cover); });
  $("#dataButton").addEventListener("click", openDataDialog);
  $("#accountButton").addEventListener("click", openAccountDialog);

  const rerender = debounce(() => void renderBooks(), 150);
  $("#searchInput").addEventListener("input", rerender);
  $("#statusFilter").addEventListener("change", () => void renderBooks());
  $("#roomFilter").addEventListener("change", () => void renderBooks());
  $("#sortSelect").addEventListener("change", () => void renderBooks());

  $("#booksGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-book-id]");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!card || !action) return;
    const book = state.books.find((item) => item.id === Number(card.dataset.bookId));
    if (!book) return;
    if (action === "details") void showBookDetails(book);
    if (action === "edit") void openBookForm(book);
  });

  $("#bookForm").addEventListener("submit", saveCurrentBook);
  $("#bookForm").addEventListener("input", () => { state.dirty = true; });
  $("#isbn13").addEventListener("input", validateIsbnFields);
  $("#isbn10").addEventListener("input", validateIsbnFields);
  $("#addCustomFieldButton").addEventListener("click", () => { addCustomField(); state.dirty = true; });
  $("#coverUrl").addEventListener("input", async (event) => {
    state.pendingCoverBlob = null;
    const url = event.target.value.trim();
    const previous = state.currentBookId ? state.books.find((book) => book.id === state.currentBookId) : null;
    state.removeExistingCover = Boolean(url && previous?.cover_id);
    const image = $("#coverPreview");
    if (url) {
      image.src = url;
      image.classList.remove("hidden");
      $("#coverPlaceholder").classList.add("hidden");
      $("#removeCoverButton").classList.remove("hidden");
    }
  });
  $("#coverUploadInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.pendingCoverBlob = await canvasResizeImage(file, { maxDimension: 1200, quality: 0.82 });
    state.removeExistingCover = false;
    const url = objectUrl(state.pendingCoverBlob);
    $("#coverPreview").src = url;
    $("#coverPreview").classList.remove("hidden");
    $("#coverPlaceholder").classList.add("hidden");
    $("#removeCoverButton").classList.remove("hidden");
    $("#coverUrl").value = "";
    state.dirty = true;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  $("#removeCoverButton").addEventListener("click", () => {
    state.pendingCoverBlob = null;
    state.removeExistingCover = true;
    $("#coverUrl").value = "";
    $("#coverPreview").removeAttribute("src");
    $("#coverPreview").classList.add("hidden");
    $("#coverPlaceholder").classList.remove("hidden");
    $("#removeCoverButton").classList.add("hidden");
    state.dirty = true;
  });
  $("#trashBookButton").addEventListener("click", async () => {
    const id = Number($("#bookId").value);
    if (!id || !confirm("Spostare questo esemplare nel cestino? Potrà essere ripristinato.")) return;
    await moveBookToTrash(id);
    scheduleCloudSync(250);
    state.dirty = false;
    await closeDialog(dialogs.book, { force: true });
    await refresh();
    toast("Esemplare spostato nel cestino.");
  });
  $("#duplicateBookButton").addEventListener("click", async () => {
    const book = state.books.find((item) => item.id === Number($("#bookId").value));
    if (!book) return;
    state.dirty = false;
    await closeDialog(dialogs.book, { force: true });
    await openBookForm(book, { duplicate: true });
  });

  $("#editFromDetailsButton").addEventListener("click", async () => {
    const book = state.books.find((item) => item.id === state.detailBookId);
    dialogs.details.close();
    if (book) await openBookForm(book);
  });

  $("#lookupManualIsbnButton").addEventListener("click", () => void lookupIsbnAndOpen($("#manualIsbnInput").value));
  $("#manualIsbnInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); void lookupIsbnAndOpen(event.target.value); }
  });

  $("#coverPhotoInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) void handleCoverPhoto(file);
  });
  $("#repeatCoverSearchButton").addEventListener("click", () => {
    const text = $("#ocrText").value.trim();
    state.coverOcrText = text;
    void performCoverSearch(text).catch((error) => toast(error.message, true));
  });
  $("#coverResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-cover-index]");
    if (!button) return;
    const metadata = state.coverSearchResults[Number(button.dataset.coverIndex)];
    if (metadata) void useCoverCandidate(metadata);
  });
  $("#createFromOcrButton").addEventListener("click", async () => {
    const metadata = metadataFromOcr($("#ocrText").value || state.coverOcrText);
    await closeDialog(dialogs.cover, { force: true });
    await openBookForm(metadata);
    state.pendingCoverBlob = state.coverOcrBlob;
  });

  $("#exportJsonButton").addEventListener("click", exportJsonBackup);
  $("#exportExcelButton").addEventListener("click", async () => {
    try { await exportExcel(state.books); } catch (error) { toast(error.message || "Esportazione Excel non riuscita.", true); }
  });
  $("#importJsonInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await prepareImport(file, async (input) => parseBackupPayload(JSON.parse(await input.text())));
  });
  $("#importExcelInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await prepareImport(file, parseExcelFile);
  });
  $("#confirmImportButton").addEventListener("click", confirmImport);
  $("#restorePreImportButton").addEventListener("click", async () => {
    if (!confirm("Ripristinare l’archivio precedente all’ultima importazione?")) return;
    try {
      const count = await restorePreImportSnapshot();
      if (state.cloudSession) {
        await setMeta("cloud_replace_pending", {
          user_id: state.cloudSession.user.id,
          requested_at: new Date().toISOString(),
        });
      }
      scheduleCloudSync(250);
      await refresh();
      toast(`${count} esemplari ripristinati.`);
    } catch (error) {
      toast(error.message || "Ripristino non disponibile.", true);
    }
  });

  $("#openTrashButton").addEventListener("click", () => {
    renderTrashList();
    dialogs.data.close();
    showDialog(dialogs.trash);
  });
  $("#trashList").addEventListener("click", async (event) => {
    const item = event.target.closest("[data-trash-id]");
    if (!item || event.target.closest("[data-action]")?.dataset.action !== "restore") return;
    await restoreTrashItem(Number(item.dataset.trashId));
    scheduleCloudSync(250);
    await refresh();
    renderTrashList();
    toast("Esemplare ripristinato.");
  });
  $("#emptyTrashButton").addEventListener("click", async () => {
    if (!state.trash.length || !confirm("Svuotare definitivamente il cestino? Questa azione non può essere annullata.")) return;
    if (state.cloudSession) {
      const result = await runCloudSync({ silent: true });
      if (!result) {
        toast("Il cestino non è stato svuotato: prima serve una sincronizzazione cloud riuscita.", true);
        return;
      }
    }
    await emptyTrash();
    await refresh();
    renderTrashList();
    toast("Cestino svuotato.");
  });

  $("#requestPersistenceButton").addEventListener("click", async () => {
    const granted = await navigator.storage.persist?.();
    await updateStorageStatus();
    toast(granted ? "Memoria persistente concessa." : "Il browser non ha concesso la memoria persistente.", !granted);
  });

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    $("#signInButton").disabled = true;
    try {
      await signIn(email, password);
      $("#authMessage").classList.remove("error");
      $("#authMessage").textContent = "Accesso riuscito. Avvio la sincronizzazione.";
    } catch (error) {
      $("#authMessage").textContent = error.message || "Accesso non riuscito.";
      $("#authMessage").classList.add("error");
    } finally {
      $("#signInButton").disabled = false;
    }
  });
  $("#signUpButton").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || password.length < 8) {
      $("#authMessage").textContent = "Inserisci un’email valida e una password di almeno 8 caratteri.";
      $("#authMessage").classList.add("error");
      return;
    }
    $("#signUpButton").disabled = true;
    try {
      const data = await createAccount(email, password);
      $("#authMessage").classList.remove("error");
      $("#authMessage").textContent = data.session
        ? "Account creato. Avvio la sincronizzazione."
        : "Account creato. Controlla l’email per confermare l’indirizzo.";
    } catch (error) {
      $("#authMessage").textContent = error.message || "Creazione account non riuscita.";
      $("#authMessage").classList.add("error");
    } finally {
      $("#signUpButton").disabled = false;
    }
  });
  $("#resetPasswordButton").addEventListener("click", async () => {
    const email = $("#authEmail").value.trim();
    if (!email) {
      $("#authMessage").textContent = "Inserisci prima l’indirizzo email.";
      $("#authMessage").classList.add("error");
      return;
    }
    try {
      await sendPasswordReset(email);
      $("#authMessage").classList.remove("error");
      $("#authMessage").textContent = "Email di recupero inviata.";
    } catch (error) {
      $("#authMessage").textContent = error.message || "Invio non riuscito.";
      $("#authMessage").classList.add("error");
    }
  });
  $("#syncNowButton").addEventListener("click", () => void runCloudSync());
  $("#signOutButton").addEventListener("click", async () => {
    try {
      await signOut();
      state.cloudSession = null;
      await renderAccountState();
      toast("Disconnessione completata. I dati locali restano su questo dispositivo.");
    } catch (error) {
      toast(error.message || "Disconnessione non riuscita.", true);
    }
  });
  $("#passwordRecoveryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#newPassword").value;
    if (password.length < 8) return;
    try {
      await updatePassword(password);
      state.authRecovery = false;
      await renderAccountState();
      toast("Password aggiornata.");
    } catch (error) {
      toast(error.message || "Aggiornamento password non riuscito.", true);
    }
  });
  window.addEventListener("online", () => {
    void renderAccountState();
    scheduleCloudSync(250);
  });
  window.addEventListener("offline", () => void renderAccountState());

  $$('[data-close-dialog]').forEach((button) => {
    button.addEventListener("click", () => void closeDialog(document.getElementById(button.dataset.closeDialog)));
  });
  Object.values(dialogs).forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); void closeDialog(dialog); });
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    registration.update().catch(() => {});
  } catch (error) {
    console.warn("Service worker non registrato:", error);
  }
}

async function init() {
  document.documentElement.dataset.appVersion = APP_VERSION;
  try {
    await openDatabase();
    await migrateDatabaseBooks();
    bindEvents();
    await refresh();
    if (cloudConfigured()) {
      try {
        const supabaseLoaded = await Promise.race([
          globalThis.supabaseReady || Promise.resolve(Boolean(globalThis.supabase)),
          new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
        ]);
        if (!supabaseLoaded) throw new Error("Libreria Supabase non raggiungibile.");
        state.cloudSession = await getCloudSession();
        onCloudAuthChange((event, session) => void applyCloudSession(event, session));
        await applyCloudSession("INITIAL_SESSION", state.cloudSession);
      } catch (error) {
        console.error("Account cloud non inizializzato:", error);
        setCloudStatus("error", "Cloud non disponibile");
      }
    } else {
      await renderAccountState();
    }
    await registerServiceWorker();
    announce("Biblioteca caricata.");
  } catch (error) {
    console.error(error);
    toast(`Impossibile inizializzare l’archivio: ${error.message}`, true);
  }
}

void init();
