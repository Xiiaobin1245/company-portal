/* Company Portal: lets the portal be installed as an app ("Add to Home screen").
   Nothing is stored on the phone: every page and every piece of data always comes from the server.
   Without a connection a short "no connection" page is shown instead of the browser's error. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;                 // files and data: straight to the server, as usual
  e.respondWith(fetch(e.request).catch(() => new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Company Portal - no connection</title>
    <body style="font-family:Segoe UI,Arial,sans-serif;background:#f4f6fa;color:#1c2433;display:flex;align-items:center;justify-content:center;min-height:90vh;margin:0">
    <div style="text-align:center;padding:24px"><img src="icon-192.png" width="72" height="72" alt="" style="border-radius:16px">
    <h2 style="color:#2e348a">No connection</h2><p>The Company Portal needs the internet (or the office network).<br>Check the connection, then try again.</p>
    <button onclick="location.reload()" style="background:#2e348a;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px">Try again</button></div>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
