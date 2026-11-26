#!/usr/bin/env node
// Turn the Expo web export into an installable PWA (workspace/docs/pwa/PWA_PLAN.md).
// Usage: npm run build:pwa  (expo export -p web → dist/, then this script). Writes into dist/:
//   icons (180 apple-touch, 192, 512, 512 maskable), manifest.webmanifest, sw.js, vercel.json, and iPhone tags in index.html.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`${dist}/index.html not found: run expo export -p web first`);
// Icons are generated once from assets/brand and kept in pwa/icons (180 apple-touch, 192, 512, 512 maskable).
mkdirSync(join(dist, "icons"), { recursive: true });
for (const f of readdirSync("pwa/icons")) copyFileSync(join("pwa/icons", f), join(dist, "icons", f));

const version = JSON.parse(readFileSync("app.json", "utf8")).expo.version;
writeFileSync(join(dist, "manifest.webmanifest"), JSON.stringify({
  name: "Dasig", short_name: "Dasig", description: "Doing good work, together: groups, teams, tasks and the record of who helped.",
  id: "/", start_url: "/home", scope: "/", display: "standalone", orientation: "portrait",
  background_color: "#FFF6E9", theme_color: "#F1F5F9",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2));

// Service worker: the app shell loads offline; records always come from the server (never cached here, so nobody's
// records sit in a shared cache). Navigations: network first, the cached shell when offline. Static bundles: cache first.
writeFileSync(join(dist, "sw.js"), `const CACHE = "dasig-${version}-${Date.now()}";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request).catch(() => caches.match("/"))); return; }
  if (u.pathname.startsWith("/_expo/") || u.pathname.startsWith("/assets/") || u.pathname.startsWith("/icons/"))
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })));
});
// Push (server: bayanihan push.ts): show it; a tap focuses an open window on that page, or opens one.
self.addEventListener("push", (e) => {
  let m = { title: "Dasig", body: "Something needs you.", url: "/inbox" };
  try { m = { ...m, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(m.title, { body: m.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: m.url }, tag: m.url }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/inbox";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    const w = ws.find((x) => new URL(x.url).origin === location.origin);
    return w ? w.focus().then(() => w.navigate(url)) : self.clients.openWindow(url);
  }));
});
`);

let html = readFileSync(join(dist, "index.html"), "utf8");
const head = `
    <link rel="preconnect" href="https://ecosystem.dasig.org" crossorigin />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Dasig" />
    <meta name="theme-color" content="#F1F5F9" />
    <meta name="robots" content="noindex" />
    <script>if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));</script>`;
if (!html.includes('rel="manifest"')) html = html.replace("</head>", `${head}\n  </head>`);
// Google Analytics 4 (volunteer.dasig.org stream). Page views are sent by src/lib/analytics.web.ts with route shapes only,
// so the automatic one is off. The page address is cleaned before the tag starts (IDs and invite codes become [id] and
// [token], query strings and fragments are dropped), so Google's automatic events (scrolls, clicks) never see them.
// The stream's "page changes based on browser history events" must stay off: it reads the raw address.
// Analytics is off by default: a fork must set DASIG_GA_ID to its own stream before the tag is injected.
const ga = process.env.DASIG_GA_ID ?? "";
if (ga && !html.includes("googletagmanager.com")) html = html.replace("</head>", `
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());
    (function(){var p=location.pathname.split("/"),k={join:"[token]",need:"[id]",org:"[id]",project:"[id]",task:"[id]",team:"[id]",vote:"[id]"};
    if(k[p[1]]&&p[2]&&p[2]!=="new")p[2]=k[p[1]];p=p.join("/");gtag("set",{page_location:location.origin+p,page_path:p});})();
    gtag("config","${ga}",{send_page_view:false});</script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=${ga}"></script>
  </head>`);
html = html.replace(/<meta name="viewport" content="([^"]*)"/, (m, c) => (c.includes("viewport-fit") ? m : `<meta name="viewport" content="${c}, viewport-fit=cover"`));
writeFileSync(join(dist, "index.html"), html);

// Vercel: every path is the app (single-page), the shell and worker are never cached stale, nothing is indexed.
writeFileSync(join(dist, "vercel.json"), JSON.stringify({
  rewrites: [{ source: "/((?!_expo/|assets/|icons/|sw.js|manifest.webmanifest).*)", destination: "/index.html" }],
  headers: [
    { source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    { source: "/(index.html|sw.js|manifest.webmanifest)", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    { source: "/_expo/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
  ],
}, null, 2));
console.log(`PWA ready in ${dist}/ (v${version})`);
