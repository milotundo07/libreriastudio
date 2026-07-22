import { VENDOR_URLS } from "./config.js";
import { normalizeIsbn, validateIsbn } from "./isbn.js";
import { loadScript } from "./utils.js";

let scanner = null;
let handled = false;

export async function startScanner({ elementId, onDetected, onStatus }) {
  await stopScanner();
  onStatus("Caricamento del modulo scanner…");
  await loadScript(VENDOR_URLS.scanner, "Html5Qrcode");
  if (!globalThis.Html5Qrcode) throw new Error("Modulo scanner non disponibile.");
  handled = false;
  scanner = new globalThis.Html5Qrcode(elementId, {
    formatsToSupport: globalThis.Html5QrcodeSupportedFormats
      ? [globalThis.Html5QrcodeSupportedFormats.EAN_13]
      : undefined,
    useBarCodeDetectorIfSupported: true,
  });
  await scanner.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: (width, height) => ({
        width: Math.max(220, Math.min(360, Math.floor(width * 0.88))),
        height: Math.max(90, Math.min(150, Math.floor(height * 0.34))),
      }),
    },
    (decoded) => {
      if (handled) return;
      const result = validateIsbn(normalizeIsbn(decoded));
      if (!result.valid || result.type !== "ISBN-13") {
        onStatus("Codice letto, ma non è un ISBN-13 valido. Riprova.", true);
        return;
      }
      handled = true;
      onDetected(result.value);
    },
    () => {},
  );
  onStatus("Inquadra l’intero codice ISBN sul retro del libro.");
}

export async function stopScanner() {
  if (!scanner) return;
  try {
    if (typeof scanner.stop === "function") await scanner.stop();
  } catch {}
  try {
    if (typeof scanner.clear === "function") await scanner.clear();
  } catch {}
  scanner = null;
  handled = false;
}
