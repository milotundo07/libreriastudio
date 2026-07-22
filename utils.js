/**
 * Proxy CORS opzionale per il solo catalogo SBN.
 * Distribuiscilo come Cloudflare Worker e inserisci il suo URL in src/config.js.
 */
export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const targetValue = requestUrl.searchParams.get("url");
    if (!targetValue) return new Response("Parametro url mancante", { status: 400 });

    let target;
    try { target = new URL(targetValue); }
    catch { return new Response("URL non valido", { status: 400 }); }

    if (target.protocol !== "https:" || target.hostname !== "opac.sbn.it" || !target.pathname.startsWith("/opacmobilegw/")) {
      return new Response("Destinazione non consentita", { status: 403 });
    }

    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "BibliotecaDelloStudio/1.0" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=3600");
    headers.delete("Set-Cookie");
    return new Response(response.body, { status: response.status, headers });
  },
};
