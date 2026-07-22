import { APP_VERSION, SCHEMA_VERSION } from "./config.js";
import { getAllBooks, getAllCovers, getMeta, setMeta } from "./db.js";
import { migrateLegacyBook, normalizeBook, validateBook } from "./model.js";
import { nowIso } from "./utils.js";

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBlob(base64, type = "application/octet-stream") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function createBackupPayload({ includeLocalCovers = true } = {}) {
  const books = await getAllBooks();
  const covers = includeLocalCovers ? await getAllCovers() : [];
  const encodedCovers = [];
  for (const cover of covers) {
    encodedCovers.push({
      id: cover.id,
      type: cover.blob?.type || "image/jpeg",
      data: cover.blob ? await blobToBase64(cover.blob) : "",
      updated_at: cover.updated_at || "",
    });
  }
  const payload = {
    format: "biblioteca-dello-studio-backup",
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: nowIso(),
    books,
    covers: encodedCovers,
    metadata: {
      count: books.length,
      localCoverCount: encodedCovers.length,
    },
  };
  await setMeta("last_backup_at", payload.exportedAt);
  return payload;
}

export function parseBackupPayload(raw) {
  const warnings = [];
  let books;
  let covers = [];
  let sourceVersion = 1;

  if (Array.isArray(raw)) {
    books = raw.map(migrateLegacyBook);
    warnings.push("Backup nel vecchio formato: verrà aggiornato durante l’importazione.");
  } else if (raw && typeof raw === "object" && Array.isArray(raw.books)) {
    books = raw.books.map((book) => normalizeBook(book, { preserveId: false }));
    covers = Array.isArray(raw.covers) ? raw.covers : [];
    sourceVersion = Number(raw.schemaVersion || 1);
    if (raw.format && raw.format !== "biblioteca-dello-studio-backup") {
      warnings.push("Il file usa un identificatore di formato non riconosciuto.");
    }
  } else {
    throw new Error("Il file JSON non contiene un backup riconoscibile.");
  }

  const errors = [];
  const validBooks = [];
  books.forEach((book, index) => {
    const validation = validateBook(book, { requireTitle: true });
    if (!validation.valid) {
      errors.push(`Riga ${index + 1}: ${validation.errors.join(" ")}`);
      return;
    }
    validation.warnings.forEach((warning) => warnings.push(`Riga ${index + 1}: ${warning}`));
    validBooks.push(validation.book);
  });

  const validCovers = covers.filter((cover) => cover?.id && cover?.data);
  return {
    books: validBooks,
    covers: validCovers,
    sourceVersion,
    errors,
    warnings,
  };
}

export async function getLastBackupAt() {
  return getMeta("last_backup_at");
}
