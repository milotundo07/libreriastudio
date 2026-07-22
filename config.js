export const APP_VERSION = "1.0.2";
export const SCHEMA_VERSION = 2;
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
