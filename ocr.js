import { VENDOR_URLS } from "./config.js";
import { canvasResizeImage, loadScript } from "./utils.js";

let activeWorker = null;
let operationId = 0;

export async function recognizeCover(file, { onProgress = () => {}, signal } = {}) {
  operationId += 1;
  const currentId = operationId;
  await cancelOcr();
  await loadScript(VENDOR_URLS.tesseract, "Tesseract");
  if (!globalThis.Tesseract) throw new Error("Modulo OCR non disponibile.");
  if (signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");

  onProgress(0.03, "Preparo la fotografia…");
  const optimized = await canvasResizeImage(file, {
    maxDimension: 1800,
    quality: 0.9,
    grayscale: true,
    contrast: 1.3,
  });
  if (currentId !== operationId || signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");

  activeWorker = await globalThis.Tesseract.createWorker("ita+eng", 1, {
    logger: (message) => {
      if (currentId !== operationId) return;
      if (typeof message.progress === "number") {
        const progress = Math.max(0.05, message.progress);
        const text = message.status === "recognizing text"
          ? `Leggo la copertina… ${Math.round(message.progress * 100)}%`
          : "Analisi della copertina…";
        onProgress(progress, text);
      }
    },
  });
  await activeWorker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: globalThis.Tesseract.PSM?.AUTO ?? 3,
  });
  const result = await activeWorker.recognize(optimized);
  await activeWorker.terminate();
  activeWorker = null;
  if (currentId !== operationId || signal?.aborted) throw new DOMException("Operazione annullata", "AbortError");
  const text = result?.data?.text?.trim() || "";
  if (text.replace(/\s/g, "").length < 4) throw new Error("Non riesco a leggere abbastanza testo. Prova con più luce e una foto più dritta.");
  onProgress(1, "Testo letto. Cerco le edizioni…");
  return { text, optimizedBlob: optimized };
}

export async function cancelOcr() {
  operationId += 1;
  if (!activeWorker) return;
  try { await activeWorker.terminate(); } catch {}
  activeWorker = null;
}
