export const APP_VERSION = "1.1.0";
export const SCHEMA_VERSION = 3;
export const DB_NAME = "bibliotecaStudioDB";
export const DB_VERSION = 2;
export const STORES = Object.freeze({
  books: "books",
  covers: "covers",
  trash: "trash",
  meta: "meta",
});

export const CATALOG_PROXY_URL = "";

export const VENDOR_URLS = Object.freeze({
  scanner: "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  xlsx: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
});

export const COVER_AUTO_ACCEPT_THRESHOLD = 0.86;
export const COVER_MIN_RESULT_THRESHOLD = 0.45;

// Inserisci qui i dati pubblici del progetto Supabase.
// La publishable key può stare nel browser: la protezione reale è affidata alle policy RLS.
export const SUPABASE_URL = "https://delefulmtheulsjapanh.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_OfAZXanPLiOv6w9UwngN0g_4-e-tqDY";
export const CLOUD_TABLE = "library_books";
export const CLOUD_BUCKET = "library-covers";
