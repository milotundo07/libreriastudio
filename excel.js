import { DB_NAME, DB_VERSION, STORES } from "./config.js";
import { migrateLegacyBook, normalizeBook } from "./model.js";
import { nowIso, randomId } from "./utils.js";

let databasePromise;

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("Operazione IndexedDB non riuscita.")), { once: true });
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Transazione annullata.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Transazione non riuscita.")), { once: true });
  });
}

function ensureIndex(store, name, keyPath, options = {}) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

export function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      let booksStore;
      if (!db.objectStoreNames.contains(STORES.books)) {
        booksStore = db.createObjectStore(STORES.books, { keyPath: "id", autoIncrement: true });
      } else {
        booksStore = request.transaction.objectStore(STORES.books);
      }
      ensureIndex(booksStore, "internal_code", "internal_code", { unique: false });
      ensureIndex(booksStore, "canonical_isbn", "canonical_isbn", { unique: false });
      ensureIndex(booksStore, "room", "room", { unique: false });
      ensureIndex(booksStore, "updated_at", "updated_at", { unique: false });

      if (!db.objectStoreNames.contains(STORES.covers)) {
        db.createObjectStore(STORES.covers, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.trash)) {
        db.createObjectStore(STORES.trash, { keyPath: "trash_id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    });

    request.addEventListener("success", () => {
      const db = request.result;
      db.addEventListener("versionchange", () => db.close());
      resolve(db);
    }, { once: true });
    request.addEventListener("error", () => {
      databasePromise = undefined;
      reject(request.error || new Error("Impossibile aprire il database."));
    }, { once: true });
    request.addEventListener("blocked", () => reject(new Error("Aggiornamento del database bloccato da un’altra scheda aperta.")), { once: true });
  });
  return databasePromise;
}

export async function getAllBooks() {
  const db = await openDatabase();
  const tx = db.transaction(STORES.books, "readonly");
  const request = tx.objectStore(STORES.books).getAll();
  const result = await requestPromise(request);
  await transactionPromise(tx);
  return result || [];
}

export async function migrateDatabaseBooks() {
  const books = await getAllBooks();
  const migrated = books.map(migrateLegacyBook);
  const changed = migrated.some((book, index) => JSON.stringify(book) !== JSON.stringify(books[index]));
  if (!changed) return migrated;
  const db = await openDatabase();
  const tx = db.transaction(STORES.books, "readwrite");
  const store = tx.objectStore(STORES.books);
  for (const book of migrated) store.put(book);
  await transactionPromise(tx);
  return migrated;
}

export function nextInternalCode(books = []) {
  const highest = books.reduce((maximum, book) => {
    const match = String(book.internal_code || "").match(/^BIB-(\d+)$/i);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return `BIB-${String(highest + 1).padStart(6, "0")}`;
}

export function assignMissingInternalCodes(books, existingBooks = []) {
  const used = new Set(existingBooks.map((book) => String(book.internal_code || "").toUpperCase()).filter(Boolean));
  let highest = [...used].reduce((maximum, code) => {
    const match = code.match(/^BIB-(\d+)$/);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);

  return books.map((rawBook) => {
    const book = normalizeBook(rawBook, { preserveId: false });
    let code = book.internal_code.toUpperCase();
    if (!/^BIB-\d{6,}$/.test(code) || used.has(code)) {
      do {
        highest += 1;
        code = `BIB-${String(highest).padStart(6, "0")}`;
      } while (used.has(code));
    }
    used.add(code);
    return { ...book, internal_code: code };
  });
}

export async function saveBook(input) {
  const book = normalizeBook(input);
  const allBooks = await getAllBooks();
  if (!book.internal_code) book.internal_code = nextInternalCode(allBooks);
  const conflicting = allBooks.find(
    (item) => item.id !== book.id && String(item.internal_code || "").toUpperCase() === book.internal_code.toUpperCase(),
  );
  if (conflicting) throw new Error(`Il codice inventario ${book.internal_code} è già utilizzato.`);

  book.updated_at = nowIso();
  const db = await openDatabase();
  const tx = db.transaction(STORES.books, "readwrite");
  const store = tx.objectStore(STORES.books);
  const request = book.id ? store.put(book) : store.add(book);
  const id = await requestPromise(request);
  await transactionPromise(tx);
  return { ...book, id: book.id || id };
}

export async function moveBookToTrash(id) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.books, STORES.trash], "readwrite");
  const booksStore = tx.objectStore(STORES.books);
  const trashStore = tx.objectStore(STORES.trash);
  const book = await requestPromise(booksStore.get(Number(id)));
  if (!book) {
    tx.abort();
    throw new Error("Il libro non esiste più.");
  }
  trashStore.add({ deleted_at: nowIso(), book });
  booksStore.delete(Number(id));
  await transactionPromise(tx);
  return book;
}

export async function getTrash() {
  const db = await openDatabase();
  const tx = db.transaction(STORES.trash, "readonly");
  const items = await requestPromise(tx.objectStore(STORES.trash).getAll());
  await transactionPromise(tx);
  return (items || []).sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}

export async function restoreTrashItem(trashId) {
  const db = await openDatabase();
  const tx = db.transaction([STORES.books, STORES.trash], "readwrite");
  const trashStore = tx.objectStore(STORES.trash);
  const booksStore = tx.objectStore(STORES.books);
  const item = await requestPromise(trashStore.get(Number(trashId)));
  if (!item?.book) {
    tx.abort();
    throw new Error("Elemento del cestino non trovato.");
  }
  const book = { ...item.book };
  delete book.id;
  const allCodes = await requestPromise(booksStore.getAll());
  const [prepared] = assignMissingInternalCodes([book], allCodes);
  const newId = await requestPromise(booksStore.add(prepared));
  trashStore.delete(Number(trashId));
  await transactionPromise(tx);
  return { ...prepared, id: newId };
}

export async function emptyTrash() {
  const db = await openDatabase();
  const tx = db.transaction(STORES.trash, "readwrite");
  tx.objectStore(STORES.trash).clear();
  await transactionPromise(tx);
}

export async function saveCover(blob, existingId = "") {
  if (!(blob instanceof Blob)) throw new TypeError("Copertina non valida.");
  const id = existingId || randomId("cover");
  const db = await openDatabase();
  const tx = db.transaction(STORES.covers, "readwrite");
  tx.objectStore(STORES.covers).put({ id, blob, updated_at: nowIso() });
  await transactionPromise(tx);
  return id;
}

export async function getCover(id) {
  if (!id) return null;
  const db = await openDatabase();
  const tx = db.transaction(STORES.covers, "readonly");
  const item = await requestPromise(tx.objectStore(STORES.covers).get(id));
  await transactionPromise(tx);
  return item?.blob || null;
}

export async function getAllCovers() {
  const db = await openDatabase();
  const tx = db.transaction(STORES.covers, "readonly");
  const items = await requestPromise(tx.objectStore(STORES.covers).getAll());
  await transactionPromise(tx);
  return items || [];
}

export async function deleteCover(id) {
  if (!id) return;
  const db = await openDatabase();
  const tx = db.transaction(STORES.covers, "readwrite");
  tx.objectStore(STORES.covers).delete(id);
  await transactionPromise(tx);
}

export async function getMeta(key) {
  const db = await openDatabase();
  const tx = db.transaction(STORES.meta, "readonly");
  const item = await requestPromise(tx.objectStore(STORES.meta).get(key));
  await transactionPromise(tx);
  return item?.value;
}

export async function setMeta(key, value) {
  const db = await openDatabase();
  const tx = db.transaction(STORES.meta, "readwrite");
  tx.objectStore(STORES.meta).put({ key, value, updated_at: nowIso() });
  await transactionPromise(tx);
}

export async function importBooksTransaction(incomingBooks, { mode = "merge", covers = [] } = {}) {
  const existing = await getAllBooks();
  const existingCodes = new Set(existing.map((book) => String(book.internal_code || "").toUpperCase()).filter(Boolean));
  const filteredIncoming = mode === "merge"
    ? incomingBooks.filter((book) => !book.internal_code || !existingCodes.has(String(book.internal_code).toUpperCase()))
    : incomingBooks;
  const prepared = assignMissingInternalCodes(filteredIncoming, mode === "merge" ? existing : []);
  const previousSnapshot = existing.map((book) => ({ ...book }));
  const db = await openDatabase();
  const tx = db.transaction([STORES.books, STORES.covers, STORES.meta], "readwrite");
  const booksStore = tx.objectStore(STORES.books);
  const coversStore = tx.objectStore(STORES.covers);
  const metaStore = tx.objectStore(STORES.meta);

  metaStore.put({
    key: "last_pre_import_snapshot",
    value: { created_at: nowIso(), books: previousSnapshot },
    updated_at: nowIso(),
  });

  if (mode === "replace") {
    booksStore.clear();
    coversStore.clear();
  }
  for (const cover of covers) {
    if (cover?.id && cover?.blob instanceof Blob) coversStore.put({ id: cover.id, blob: cover.blob, updated_at: cover.updated_at || nowIso() });
  }
  for (const book of prepared) {
    const copy = { ...book, updated_at: nowIso() };
    delete copy.id;
    booksStore.add(copy);
  }
  await transactionPromise(tx);
  return prepared.length;
}

export async function restorePreImportSnapshot() {
  const snapshot = await getMeta("last_pre_import_snapshot");
  if (!snapshot?.books?.length) throw new Error("Nessun ripristino precedente disponibile.");
  const db = await openDatabase();
  const tx = db.transaction(STORES.books, "readwrite");
  const store = tx.objectStore(STORES.books);
  store.clear();
  for (const book of snapshot.books) store.add({ ...book });
  await transactionPromise(tx);
  return snapshot.books.length;
}
