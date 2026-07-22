export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function uniqueStrings(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function splitList(value = "") {
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(String(value).split(/\s*[;,\n]\s*/));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function safeNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < min || number > max) return "";
  return number;
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(date);
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function debounce(callback, delay = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, content, mimeType = "text/plain;charset=utf-8") {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}

export function loadScript(src, globalName) {
  if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  const existing = [...document.querySelectorAll("script[data-vendor-src]")].find((script) => script.dataset.vendorSrc === src);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(globalName ? globalThis[globalName] : true), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Impossibile caricare ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.vendorSrc = src;
    script.addEventListener("load", () => resolve(globalName ? globalThis[globalName] : true), { once: true });
    script.addEventListener("error", () => reject(new Error(`Impossibile caricare ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

export async function canvasResizeImage(file, {
  maxDimension = 1200,
  quality = 0.82,
  grayscale = false,
  contrast = 1,
} = {}) {
  if (!(file instanceof Blob)) throw new TypeError("Il file immagine non è valido.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: grayscale || contrast !== 1 });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  if (grayscale || contrast !== 1) {
    const imageData = context.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let index = 0; index < data.length; index += 4) {
      let red = data[index];
      let green = data[index + 1];
      let blue = data[index + 2];
      if (grayscale) {
        const gray = 0.299 * red + 0.587 * green + 0.114 * blue;
        red = green = blue = gray;
      }
      data[index] = clamp((red - 128) * contrast + 128, 0, 255);
      data[index + 1] = clamp((green - 128) * contrast + 128, 0, 255);
      data[index + 2] = clamp((blue - 128) * contrast + 128, 0, 255);
    }
    context.putImageData(imageData, 0, 0);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Impossibile elaborare l’immagine.")),
      "image/jpeg",
      quality,
    );
  });
}

export function objectUrl(blob) {
  return blob ? URL.createObjectURL(blob) : "";
}

export function randomId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
