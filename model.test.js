import { VENDOR_URLS } from "./config.js";
import { normalizeBook, validateBook } from "./model.js";
import { loadScript, safeNumber, splitList } from "./utils.js";

export const EXCEL_COLUMNS = Object.freeze([
  ["Codice inventario", "internal_code"],
  ["Numero copia", "copy_number", "number"],
  ["Titolo", "title"],
  ["Sottotitolo", "subtitle"],
  ["Titolo originale", "original_title"],
  ["Autori", "authors", "list"],
  ["Altri responsabili", "contributors"],
  ["ISBN-13", "isbn13"],
  ["ISBN-10", "isbn10"],
  ["Editore", "publisher"],
  ["Luogo di pubblicazione", "publication_place"],
  ["Anno di pubblicazione", "publication_year", "number"],
  ["Data completa di pubblicazione", "publication_date"],
  ["Edizione", "edition"],
  ["Ristampa / tiratura", "printing"],
  ["Collana", "series"],
  ["Numero nella collana", "series_number"],
  ["Lingua", "language"],
  ["Lingua originale", "original_language"],
  ["Numero di pagine", "pages", "number"],
  ["Classificazione Dewey", "dewey"],
  ["Categorie / soggetti", "categories", "list"],
  ["Formato / legatura", "binding"],
  ["Dimensioni", "dimensions"],
  ["Stanza", "room"],
  ["Scaffale", "shelf"],
  ["Stato della scheda", "catalog_status"],
  ["Condizione fisica", "condition"],
  ["Provenienza / dedica / ex libris", "provenance"],
  ["Data di acquisizione", "acquisition_date"],
  ["Fonte o luogo di acquisto", "acquisition_source"],
  ["Prezzo di acquisizione", "acquisition_price"],
  ["URL copertina", "cover_url"],
  ["Fonte dei dati", "source"],
  ["Note catalografiche", "notes"],
  ["Data inserimento", "created_at"],
  ["Ultima modifica", "updated_at"],
]);

const EXTRA_PREFIX = "Extra · ";

async function getXlsx() {
  return loadScript(VENDOR_URLS.xlsx, "XLSX");
}

function widthFor(header) {
  if (/ISBN|Anno|Pagine|Lingua|Stanza|Scaffale|Numero copia/.test(header)) return 16;
  if (/Titolo|Autori|Categorie|Provenienza|URL|Note|responsabili/.test(header) || header.startsWith(EXTRA_PREFIX)) return 34;
  return Math.max(18, Math.min(29, header.length + 3));
}

export async function exportExcel(books) {
  const XLSX = await getXlsx();
  const customNames = [...new Set(books.flatMap((book) => Object.keys(book.custom_fields || {})))].sort((a, b) => a.localeCompare(b, "it"));
  const headers = [...EXCEL_COLUMNS.map(([header]) => header), ...customNames.map((name) => EXTRA_PREFIX + name)];
  const rows = books.map((book) => {
    const row = {};
    for (const [header, key, type] of EXCEL_COLUMNS) {
      const value = book[key];
      row[header] = type === "list"
        ? (Array.isArray(value) ? value.join("; ") : String(value || ""))
        : type === "number"
          ? (value === "" ? "" : Number(value))
          : (value ?? "");
    }
    customNames.forEach((name) => { row[EXTRA_PREFIX + name] = book.custom_fields?.[name] || ""; });
    return row;
  });
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  worksheet["!autofilter"] = { ref: worksheet["!ref"] || `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
  worksheet["!cols"] = headers.map((header) => ({ wch: widthFor(header) }));
  const info = XLSX.utils.aoa_to_sheet([
    ["Biblioteca dello Studio"],
    ["Ogni riga rappresenta un esemplare fisico."],
    ["Non rinominare le intestazioni se vuoi reimportare il file."],
    ["I campi personalizzati iniziano con “Extra · ”."],
    ["Numero esemplari", books.length],
    ["Data esportazione", new Date().toLocaleString("it-IT")],
  ]);
  info["!cols"] = [{ wch: 70 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Biblioteca");
  XLSX.utils.book_append_sheet(workbook, info, "Istruzioni");
  XLSX.writeFile(workbook, `biblioteca-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
}

function rowToBook(row) {
  const book = { custom_fields: {} };
  for (const [header, key, type] of EXCEL_COLUMNS) {
    const raw = row[header];
    if (type === "list") book[key] = splitList(raw);
    else if (type === "number") book[key] = safeNumber(raw);
    else book[key] = raw === null || raw === undefined ? "" : String(raw).trim();
  }
  for (const [header, value] of Object.entries(row)) {
    if (!header.startsWith(EXTRA_PREFIX)) continue;
    const key = header.slice(EXTRA_PREFIX.length).trim();
    const text = String(value ?? "").trim();
    if (key && text) book.custom_fields[key] = text;
  }
  delete book.id;
  return normalizeBook(book, { preserveId: false });
}

export async function parseExcelFile(file) {
  const XLSX = await getXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheetName = workbook.SheetNames.includes("Biblioteca") ? "Biblioteca" : workbook.SheetNames[0];
  if (!sheetName) throw new Error("Il file non contiene fogli.");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: true });
  const books = [];
  const errors = [];
  const warnings = [];
  rows.forEach((row, index) => {
    const validation = validateBook(rowToBook(row), { requireTitle: true });
    if (!validation.valid) {
      errors.push(`Riga ${index + 2}: ${validation.errors.join(" ")}`);
      return;
    }
    validation.warnings.forEach((warning) => warnings.push(`Riga ${index + 2}: ${warning}`));
    books.push(validation.book);
  });
  return { books, covers: [], errors, warnings, sourceVersion: 2 };
}
