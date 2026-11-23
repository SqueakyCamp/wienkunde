"use strict";
/* Wienkunde – Wien besser kennen. Vanilla JS + Leaflet.
   Daten: Stadt Wien OGD (CC BY 4.0), BEV Verwaltungsgrenzen, Wien Geschichte Wiki, Wikipedia (live), eigene Texte in data/content.json. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss")
  .replace(/strasse\b/g, "str").replace(/str\./g, "str").replace(/[^a-z0-9]+/g, " ").trim();
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, n) => shuffle(a).slice(0, n);
const toast = (t, ms = 1800) => { const e = $("#toast"); e.textContent = t; e.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("on"), ms); };
const GW = id => `https://www.geschichtewiki.wien.gv.at/?curid=${id}`;
const GWT = t => `https://www.geschichtewiki.wien.gv.at/${encodeURIComponent(t.replace(/ /g, "_"))}`;
const fmtD = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;

// ---------------------------------------------------------------- Geometrie
function dist(a, b) { // [lon,lat] -> Meter
  const R = 6371000, toR = Math.PI / 180, dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function inRing(p, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function inGeom(p, g) {
  if (!g) return false;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some(poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h)));
}
function geomPoints(g) {
  const c = g.coordinates;
  return g.type === "Point" ? [c] : g.type === "LineString" ? c : g.type === "MultiLineString" || g.type === "Polygon" ? c.flat() : c.flat(2);
}
function segDist(p, a, b) { // Meter, lokal eben genähert
  const k = Math.cos(p[1] * Math.PI / 180) * 111320, m = 110540;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * m, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
function distToGeom(p, g) {
  if (inGeom(p, g)) return 0;
  const c = g.coordinates;
  const lines = g.type === "LineString" ? [c] : g.type === "MultiLineString" || g.type === "Polygon" ? c : g.type === "MultiPolygon" ? c.flat() : [[c]];
  let best = Infinity;
  for (const ln of lines) {
    if (ln.length === 1) { best = Math.min(best, dist(p, ln[0])); continue; }
    for (let i = 1; i < ln.length; i++) { const d = segDist(p, ln[i - 1], ln[i]); if (d < best) best = d; }
  }
  return best;
}
function bboxOf(g) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of geomPoints(g)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [[y0, x0], [y1, x1]];
}
const centroid = g => { const b = bboxOf(g); return [(b[0][1] + b[1][1]) / 2, (b[0][0] + b[1][0]) / 2]; };

// ---------------------------------------------------------------- Daten
const DATA = {};
const WIKI = {};          // bezirk -> Einträge
async function J(path) { const r = await fetch(path, { cache: path.startsWith("http") ? "default" : "no-cache" }); if (!r.ok) throw new Error(path); return r.json(); }
async function loadBase() {
  const names = ["bezirke", "kg", "lines", "stops", "ubahn_stationen", "gewaesser", "maerkte", "wahl2025", "historisch", "content"];
  const res = await Promise.all(names.map(n => J(`data/${n}.json`).catch(() => null)));
  names.forEach((n, i) => DATA[n] = res[i]);
  DATA.content = DATA.content || { bezirke: {}, orte: [], fragen: [], themen: [] };
  DATA.lineById = Object.fromEntries(DATA.lines.map(l => [l.id, l]));
}
const lazy = {};
function loadLazy(n) { return lazy[n] ||= J(`data/${n}.json`).then(d => (DATA[n] = d)); }
async function wikiFor(b) {
  if (!b) return [];
  if (!WIKI[b]) WIKI[b] = J(`data/wiki/b${String(b).padStart(2, "0")}.json`).catch(() => []);
  return WIKI[b];
}
async function wikiNear(p, r) {
  const bs = DATA.bezirke.filter(b => distToGeom(p, b.geom) < r).map(b => b.nr);
  const all = (await Promise.all(bs.map(wikiFor))).flat();
  return all.map(e => ({ ...e, d: dist(p, e.c) })).filter(e => e.d <= r).sort((a, b) => a.d - b.d);
}
const bezirkAt = p => DATA.bezirke.find(b => inGeom(p, b.geom));
const kgAt = p => DATA.kg.find(k => inGeom(p, k.geom));

// ---------------------------------------------------------------- Zustand (Server + localStorage)
let S = { q: {}, seen: {}, settings: { layers: ["ubahn"] }, stats: { answers: 0, right: 0, days: {} } };
async function loadState() {
  try { const l = JSON.parse(localStorage.getItem("wk-state") || "null"); if (l) S = { ...S, ...l }; } catch { }
  try { const r = await J("api/state"); if (r && r.t && (!S.t || r.t > S.t)) S = { ...S, ...r }; } catch { }
}
let saveT;
function save() {
  S.t = Date.now();
  localStorage.setItem("wk-state", JSON.stringify(S));
  clearTimeout(saveT);
  saveT = setTimeout(() => fetch("api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(S) }).catch(() => { }), 800);
}

// ---------------------------------------------------------------- Karte
let map, baseExplore, baseQuiz, overlay = {}, focusLayer, meMarker, meCircle, me = null, watchId = null, follow = false;
function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 10, maxZoom: 19 }).setView([48.2082, 16.3738], 13);
  baseExplore = L.tileLayer("https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png", { maxZoom: 19, attribution: '<a href="https://basemap.at">basemap.at</a> · Daten: <a href="https://data.wien.gv.at">Stadt Wien</a>, BEV, <a href="https://www.geschichtewiki.wien.gv.at">Wien Geschichte Wiki</a>' });
  baseQuiz = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 16, maxNativeZoom: 16, attribution: "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap" });
  baseExplore.addTo(map);
  focusLayer = L.layerGroup().addTo(map);
  map.on("click", e => { if (VIEW === "karte" && !QZ) showHere([e.latlng.lng, e.latlng.lat], { tapped: true }); });
  map.on("dragstart", () => { follow = false; $("#locate").classList.remove("on"); });
  $("#locate").onclick = () => locate(true);
  $("#layersbtn").onclick = () => { const l = $("#layers"); l.hidden = !l.hidden; if (!l.hidden) renderLayerMenu(); };
}
const LINE_COL = { U: null, S: "#1e7fc4", T: "#c4161c", B: "#0a5aa0", N: "#1b2a4a" };
const LAYERS = [
  ["ubahn", "U-Bahn", "Öffis"], ["sbahn", "S-Bahn", "Öffis"], ["tram", "Straßenbahn", "Öffis"], ["bus", "Autobus", "Öffis"], ["nacht", "NightLine", "Öffis"],
  ["bezirke", "Bezirksgrenzen", "Gebiete"], ["kg", "Katastralgemeinden (alte Dörfer und Vorstädte)", "Gebiete"], ["wahl", "Gemeinderatswahl 2025: stärkste Partei", "Gebiete"],
  ["gewaesser", "Bäche und Flüsse", "Natur"], ["stories", "Geschichten (kuratiert)", "Wissen"], ["wiki", "Wien Geschichte Wiki (ab Zoom 16)", "Wissen"],
  ["gemeindebau", "Gemeindebauten", "Wissen"], ["befestigung", "Stadtbefestigung und Mittelalter", "Wissen"], ["wasserl", "Historische Wasserleitungen", "Wissen"],
];
const PARTY_COL = { "SPÖ": "#e3000f", "ÖVP": "#63c3d0", "FPÖ": "#0056a2", "GRÜNE": "#5fb030", "NEOS": "#e84188", "KPÖ": "#a00", "HC": "#555" };
function renderLayerMenu() {
  const on = new Set(S.settings.layers);
  let h = "", grp = "";
  for (const [id, label, g] of LAYERS) {
    if (g !== grp) { h += `<h4>${g}</h4>`; grp = g; }
    h += `<label><input type="checkbox" data-l="${id}" ${on.has(id) ? "checked" : ""}> ${label}</label>`;
  }
  $("#layers").innerHTML = h;
  $$("#layers input").forEach(i => i.onchange = () => {
    const s = new Set(S.settings.layers); i.checked ? s.add(i.dataset.l) : s.delete(i.dataset.l);
    S.settings.layers = [...s]; save(); applyLayers();
  });
}
async function makeLayer(id) {
  const lineLayer = (types, w) => L.layerGroup(DATA.lines.filter(l => types.includes(l.t)).map(l =>
    L.geoJSON(l.geom, { style: { color: l.color || LINE_COL[l.t], weight: w, opacity: .85 }, interactive: true })
      .bindTooltip(l.id, { sticky: true, className: "lbl" }).on("click", e => { L.DomEvent.stop(e); showLine(l.id); })));
  switch (id) {
    case "ubahn": return L.layerGroup([lineLayer(["U"], 5), ...DATA.ubahn_stationen.map(s => L.circleMarker([s.c[1], s.c[0]], { radius: 4, color: "#1d1a17", weight: 2, fillColor: "#fff", fillOpacity: 1 })
      .bindTooltip(s.n, { className: "lbl" }).on("click", e => { L.DomEvent.stop(e); showHere(s.c, { title: s.n }); }))]);
    case "sbahn": return lineLayer(["S"], 4);
    case "tram": return lineLayer(["T"], 3);
    case "bus": return lineLayer(["B"], 2.5);
    case "nacht": return lineLayer(["N"], 2.5);
    case "bezirke": return L.geoJSON({ type: "FeatureCollection", features: DATA.bezirke.map(b => ({ type: "Feature", properties: b, geometry: b.geom })) },
      { style: { color: "#b3261e", weight: 2, fill: false, dashArray: "6 4" }, interactive: false });
    case "kg": return L.geoJSON({ type: "FeatureCollection", features: DATA.kg.map(k => ({ type: "Feature", properties: k, geometry: k.geom })) },
      { style: { color: "#8a6a2f", weight: 1.3, fillOpacity: 0 }, interactive: false,
        onEachFeature: (f, l) => l.bindTooltip(f.properties.name, { permanent: false, direction: "center", className: "lbl" }) });
    case "wahl": return L.geoJSON({ type: "FeatureCollection", features: DATA.bezirke.map(b => ({ type: "Feature", properties: b, geometry: b.geom })) }, {
      style: f => { const w = DATA.wahl2025.gr[f.properties.nr]; return { color: "#fff", weight: 1, fillColor: PARTY_COL[w.parteien[0][0]] || "#999", fillOpacity: .35 }; },
      onEachFeature: (f, l) => { const w = DATA.wahl2025.gr[f.properties.nr]; l.bindTooltip(`${f.properties.nr}. ${f.properties.name}: ${w.parteien[0][0]} ${String(w.parteien[0][1]).replace(".", ",")} %`, { className: "lbl", sticky: true }); } });
    case "gewaesser": return L.geoJSON({ type: "FeatureCollection", features: DATA.gewaesser.map(g => ({ type: "Feature", properties: g, geometry: g.geom })) },
      { style: { color: "#3d7fb8", weight: 2.5, opacity: .8 }, onEachFeature: (f, l) => l.bindTooltip(f.properties.n, { sticky: true, className: "lbl" }) });
    case "stories": return L.layerGroup(allStories().filter(o => o.c).map(o => L.marker([o.c[1], o.c[0]], { icon: L.divIcon({ className: "", html: '<div class="pin story"></div>', iconSize: [16, 16] }) })
      .bindTooltip(o.n, { className: "lbl" }).on("click", e => { L.DomEvent.stop(e); showStory(o); })));
    case "gemeindebau": { await loadLazy("gemeindebauten");
      return L.layerGroup(DATA.gemeindebauten.map(g => g.geom ? L.geoJSON(g.geom, { style: { color: "#b3261e", weight: 1, fillOpacity: .25 } }).bindTooltip(`${g.n} (${g.y || "?"})`, { className: "lbl", sticky: true })
        : L.circleMarker([g.c[1], g.c[0]], { radius: 3, color: "#b3261e", weight: 1, fillOpacity: .5 }).bindTooltip(`${g.n} (${g.y || "?"}, ${g.w || "?"} Whg.)`, { className: "lbl" }))); }
    case "befestigung": { await loadLazy("befestigung"); const B = DATA.befestigung;
      return L.layerGroup([
        L.geoJSON({ type: "FeatureCollection", features: B.siedlung.map(s => ({ type: "Feature", properties: s, geometry: s.geom })) }, { style: { color: "#8a6a2f", weight: 1, fillOpacity: .12 } }),
        L.geoJSON({ type: "FeatureCollection", features: B.mittelalter.map(s => ({ type: "Feature", properties: s, geometry: s.geom })) }, { style: { color: "#5b3a12", weight: 3 }, onEachFeature: (f, l) => l.bindTooltip(`${f.properties.t || "Mittelalterliche Befestigung"}${f.properties.abschnitt ? ": " + f.properties.abschnitt : ""}`, { sticky: true, className: "lbl" }) }),
        L.geoJSON({ type: "FeatureCollection", features: B.neuzeit.map(s => ({ type: "Feature", properties: s, geometry: s.geom })) }, { style: { color: "#7d5a3c", weight: 1, fillColor: "#a07850", fillOpacity: .3 }, onEachFeature: (f, l) => l.bindTooltip(f.properties.t || "Befestigung 16.–19. Jh.", { sticky: true, className: "lbl" }) })]); }
    case "wasserl": { await loadLazy("wasserleitungen");
      return L.geoJSON({ type: "FeatureCollection", features: DATA.wasserleitungen.map(s => ({ type: "Feature", properties: s, geometry: s.geom })) }, { style: { color: "#2a9d8f", weight: 3, dashArray: "4 4" }, onEachFeature: (f, l) => l.bindTooltip(`${f.properties.n}${f.properties.verlauf ? ": " + f.properties.verlauf : ""}`, { sticky: true, className: "lbl" }) }); }
    case "wiki": return L.layerGroup();
  }
}
async function applyLayers() {
  const want = new Set(VIEW === "karte" && !QZ ? S.settings.layers : []);
  for (const [id] of LAYERS) {
    if (want.has(id)) { if (!overlay[id]) overlay[id] = await makeLayer(id); if (!map.hasLayer(overlay[id])) overlay[id].addTo(map); }
    else if (overlay[id] && map.hasLayer(overlay[id])) map.removeLayer(overlay[id]);
  }
  refreshWikiLayer();
}
let wikiT;
function refreshWikiLayer() {
  clearTimeout(wikiT);
  wikiT = setTimeout(async () => {
    const lg = overlay.wiki; if (!lg || !map.hasLayer(lg)) return;
    lg.clearLayers();
    if (map.getZoom() < 16) return;
    const c = map.getCenter(), b = map.getBounds();
    const items = await wikiNear([c.lng, c.lat], 1500);
    items.filter(e => e.art !== "Verkehrsfläche" && b.contains([e.c[1], e.c[0]])).slice(0, 300).forEach(e =>
      L.marker([e.c[1], e.c[0]], { icon: L.divIcon({ className: "", html: '<div class="pin wiki"></div>', iconSize: [10, 10] }) })
        .bindTooltip(e.n, { className: "lbl" }).on("click", ev => { L.DomEvent.stop(ev); showWikiEntry(e); }).addTo(lg));
  }, 250);
}

// ---------------------------------------------------------------- Standort
function locate(center) {
  if (!navigator.geolocation) return toast("Standort wird von diesem Browser nicht unterstützt");
  if (!window.isSecureContext) return toast("Standort braucht HTTPS (Tailscale-Adresse mit :8445 verwenden)", 4000);
  follow = true; $("#locate").classList.add("on");
  if (me && center) { map.setView([me[1], me[0]], Math.max(map.getZoom(), 16)); showHere(me, { mine: true }); }
  if (watchId != null) return;
  let first = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    const p = [pos.coords.longitude, pos.coords.latitude];
    const moved = !me || dist(me, p) > 60;
    me = p;
    if (!meMarker) {
      meMarker = L.marker([p[1], p[0]], { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle([p[1], p[0]], { radius: pos.coords.accuracy, color: "#1a73e8", weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    } else { meMarker.setLatLng([p[1], p[0]]); meCircle.setLatLng([p[1], p[0]]).setRadius(pos.coords.accuracy); }
    if (follow) map.setView([p[1], p[0]], first ? 16 : map.getZoom(), { animate: !first });
    if ((first || (moved && HERE.mine)) && VIEW === "karte" && !QZ) showHere(p, { mine: true });
    first = false;
  }, err => { toast(err.code === 1 ? "Standortfreigabe verweigert" : "Standort nicht verfügbar"); $("#locate").classList.remove("on"); watchId = null; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
}

// ---------------------------------------------------------------- Bottom Sheet
const sheet = () => $("#sheet");
function setSheet(state) { const s = sheet(); s.classList.toggle("big", state === "big"); s.classList.toggle("min", state === "min"); }
function sheetHTML(h, state = "") { $("#sheetbody").innerHTML = h; sheet().hidden = false; setSheet(state); sheet().scrollTop = 0; }

function srcLinks(o) {
  const q = [...(o.quellen || [])];
  if (o.wiki_id) q.unshift({ t: "Wien Geschichte Wiki", u: GW(o.wiki_id) });
  else if (o.wiki) q.unshift({ t: "Wien Geschichte Wiki", u: GWT(o.wiki) });
  if (!q.length) return "";
  return `<div class="src">${q.map(x => `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)} ↗</a>`).join("")}</div>`;
}
const badge = id => { const l = DATA.lineById[id]; const t = l ? l.t : "B"; return `<span class="line-badge lb-${t}" style="${l && l.color ? `background:${l.color}` : ""}">${esc(id)}</span>`; };
const badges = ls => ls.map(badge).join("");

function allStories() {
  const C = DATA.content; const out = [];
  for (const o of C.orte || []) out.push(o);
  for (const t of C.teile || []) out.push({ ...t, kat: "teil" });
  return out;
}

// ---------------------------------------------------------------- Hier-Ansicht
let HERE = {};
async function showHere(p, opt = {}) {
  HERE = { p, ...opt };
  focusLayer.clearLayers();
  if (!opt.mine) L.circleMarker([p[1], p[0]], { radius: 7, color: "#b3261e", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer);
  const bz = bezirkAt(p), kg = kgAt(p);
  if (!bz) { sheetHTML(`<h2>Außerhalb von Wien</h2><p class="muted">Tippe auf einen Punkt in Wien oder nutze ◎ für deinen Standort.</p>`, "min"); return; }
  const C = DATA.content, prof = C.bezirke?.[bz.nr];
  const teil = kg && (C.teile || []).find(t => norm(t.n) === norm(kg.name));
  // Öffis
  const stops = DATA.stops.map(s => ({ ...s, d: dist(p, s.c) })).sort((a, b) => a.d - b.d).slice(0, 6).filter(s => s.d < 900);
  const ust = DATA.ubahn_stationen.map(s => ({ ...s, d: dist(p, s.c) })).sort((a, b) => a.d - b.d)[0];
  let h = `<div class="where"><h2>${esc(opt.title || (opt.mine ? "Du bist hier" : "Dieser Ort"))}</h2></div>
    <div class="row" style="margin-bottom:8px">
      <a class="chip" href="#/bezirk/${bz.nr}">${bz.nr}. ${esc(bz.name)}</a>
      ${kg ? `<button class="chip" data-kg="${esc(kg.nr)}">KG ${esc(kg.name)}</button>` : ""}
      ${ust ? `<span class="chip">Ⓤ ${esc(ust.n)} · ${fmtD(ust.d)}</span>` : ""}
    </div>`;
  if (prof?.kurz) h += `<p style="margin:4px 0 8px">${esc(prof.kurz)}</p>`;
  if (kg) {
    h += `<div class="card"><h4>Katastralgemeinde ${esc(kg.name)}</h4>`;
    if (teil) h += `<p>${esc(teil.text)}</p>${srcLinks(teil)}`;
    else h += `<p class="muted small">Katastralgemeinden sind die Vermessungseinheiten des Grundbuchs. In Wien entsprechen sie meist den früheren Dörfern, Vororten und Vorstädten, aus denen die Bezirke zusammengewachsen sind.</p><a class="small" href="${GWT(kg.name)}" target="_blank" rel="noopener">${esc(kg.name)} im Wien Geschichte Wiki ↗</a>`;
    h += `</div>`;
  }
  h += `<div id="near-stories"></div>`;
  if (stops.length) h += `<div class="section"><h3>Öffis in der Nähe <small>tippen = Linie zeigen</small></h3>${stops.map(s => `<div class="item" data-stop="${esc(s.n)}"><div class="dist">${fmtD(s.d)}</div><div class="body"><b>${esc(s.n)}</b><div>${s.l.map(id => `<span data-line="${esc(id)}">${badge(id)}</span>`).join("")}</div></div></div>`).join("")}</div>`;
  h += `<div id="near-wiki"><p class="muted small">Lade Einträge aus dem Wien Geschichte Wiki …</p></div><div id="near-wp"></div><div id="near-more"></div>`;
  sheetHTML(h, opt.keep ? "" : "");
  $$("#sheetbody [data-line]").forEach(e => e.onclick = ev => { ev.stopPropagation(); showLine(e.dataset.line); });
  $$("#sheetbody [data-kg]").forEach(e => e.onclick = () => { const k = DATA.kg.find(x => x.nr === e.dataset.kg); L.geoJSON(k.geom, { style: { color: "#8a6a2f", weight: 3, fillOpacity: .08 } }).addTo(focusLayer); map.fitBounds(bboxOf(k.geom), { paddingBottomRight: [0, 200] }); });

  // Geschichten in der Nähe
  const st = allStories().filter(o => o.c).map(o => ({ ...o, d: dist(p, o.c) })).filter(o => o.d < 700 && o.kat !== "teil").sort((a, b) => a.d - b.d).slice(0, 8);
  if (st.length) $("#near-stories").innerHTML = `<div class="section"><h3>Geschichten hier <small>${st.length}</small></h3>${st.map(o => storyCard(o, true)).join("")}</div>`;
  bindStoryCards($("#near-stories"));

  // Wiki
  const near = await wikiNear(p, 450);
  if (HERE.p !== p) return;
  const grp = { bau: [], topo: [], str: [], org: [] };
  for (const e of near) { if (e.art === "Verkehrsfläche") { if (e.d < 220) grp.str.push(e); } else (grp[e.k] || grp.topo).push(e); }
  const list = (arr, max) => arr.slice(0, max).map(e => `<div class="item" data-w="${e.id}"><div class="dist">${fmtD(e.d)}</div><div class="body"><b>${esc(e.n)}</b> ${e.art ? `<span class="muted small">${esc(e.art)}</span>` : ""}
      ${e.t ? `<div class="ex">${esc(e.t)}</div>` : e.benannt ? `<div class="ex">Benannt nach ${esc(e.benannt)}</div>` : ""}<div class="src"><a href="${GW(e.id)}" target="_blank" rel="noopener">Wien Geschichte Wiki ↗</a></div></div></div>`).join("");
  let w = "";
  if (grp.bau.length) w += `<div class="section"><h3>Gebäude und Bauwerke <small>${grp.bau.length} im Umkreis 450 m</small></h3>${list(grp.bau, 12)}</div>`;
  if (grp.topo.length) w += `<div class="section"><h3>Orte, Grätzel, Gewässer <small>${grp.topo.length}</small></h3>${list(grp.topo, 8)}</div>`;
  if (grp.org.length) w += `<div class="section"><h3>Einrichtungen und Organisationen <small>${grp.org.length}</small></h3>${list(grp.org, 8)}</div>`;
  if (grp.str.length) w += `<div class="section"><h3>Woher die Straßen ihre Namen haben</h3>${list(grp.str, 10)}</div>`;
  $("#near-wiki").innerHTML = w || "";
  $$("#near-wiki .item").forEach(it => it.onclick = ev => {
    if (ev.target.closest("a")) return;
    it.classList.toggle("open");
    const e = near.find(x => x.id == it.dataset.w);
    focusLayer.eachLayer(l => l.options.wk && focusLayer.removeLayer(l));
    L.circleMarker([e.c[1], e.c[0]], { radius: 6, color: "#2c5d8a", weight: 3, fillOpacity: .6, wk: 1 }).addTo(focusLayer);
  });

  // weitere Daten: Gemeindebauten, Märkte, Historisches, Wahl
  await Promise.all([loadLazy("gemeindebauten")]);
  if (HERE.p !== p) return;
  let m = "";
  const gb = DATA.gemeindebauten.map(g => ({ ...g, d: dist(p, g.c) })).filter(g => g.d < 350).sort((a, b) => a.d - b.d).slice(0, 6);
  if (gb.length) m += `<div class="section"><h3>Gemeindebauten in der Nähe</h3>${gb.map(g => `<div class="item"><div class="dist">${fmtD(g.d)}</div><div class="body"><b>${esc(g.n)}</b> <span class="muted small">${g.y ? "erbaut " + g.y : ""}${g.w ? " · " + g.w + " Wohnungen" : ""}</span>${g.a && g.a !== g.n ? `<div class="ex">${esc(g.a)}</div>` : ""}${g.pdf ? `<div class="src"><a href="${esc(g.pdf)}" target="_blank" rel="noopener">Datenblatt Wiener Wohnen ↗</a></div>` : ""}</div></div>`).join("")}</div>`;
  const H = DATA.historisch || {};
  const hist = [...(H.burgen || []).map(x => ({ ...x, typ: "Burg/Schloss" })), ...(H.synagogen || []).map(x => ({ ...x, typ: "Historische Synagoge" })), ...(H.gaerten || []).map(x => ({ ...x, typ: x.kat || "Historischer Garten" }))]
    .map(x => ({ ...x, d: dist(p, x.c) })).filter(x => x.d < 600 && x.txt).sort((a, b) => a.d - b.d).slice(0, 5);
  if (hist.length) m += `<div class="section"><h3>Stadtarchäologie und historische Gärten</h3>${hist.map(x => `<div class="item"><div class="dist">${fmtD(x.d)}</div><div class="body"><b>${esc(x.n || x.adr)}</b> <span class="muted small">${esc(x.typ)}</span><div class="ex">${esc(x.txt)}</div><div class="src muted">Quelle: Stadt Wien OGD</div></div></div>`).join("")}</div>`;
  const mk = DATA.maerkte.map(x => ({ ...x, d: dist(p, x.c) })).filter(x => x.d < 1200).sort((a, b) => a.d - b.d).slice(0, 2);
  if (mk.length) m += `<div class="section"><h3>Märkte</h3>${mk.map(x => `<div class="item"><div class="dist">${fmtD(x.d)}</div><div class="body"><b>${esc(x.n)}</b>${x.url ? `<div class="src"><a href="${esc(x.url)}" target="_blank" rel="noopener">Marktamt ↗</a></div>` : ""}</div></div>`).join("")}</div>`;
  m += wahlBlock(bz.nr, true);
  $("#near-more").innerHTML = m;
  $$("#near-more .item").forEach(it => it.onclick = ev => { if (!ev.target.closest("a")) it.classList.toggle("open"); });
  wikipediaNear(p);
}
function wahlBlock(nr, compact) {
  const W = DATA.wahl2025; if (!W) return "";
  const rows = (w) => w.parteien.slice(0, compact ? 5 : 8).map(([n, v]) => `<span>${esc(n)}</span><div class="bar"><div class="p" style="width:${v * 1.6}%;background:${PARTY_COL[n] || "#999"}"></div></div><span>${String(v).replace(".", ",")} %</span>`).join("");
  return `<div class="section"><h3>Wahl 2025 im ${nr}. Bezirk <small>Gemeinderat: Stadt Wien OGD</small></h3>
    <p class="small muted">Gemeinderat, Beteiligung ${String(W.gr[nr].beteiligung).replace(".", ",")} %</p><div class="parties">${rows(W.gr[nr])}</div>
    ${compact ? "" : `<p class="small muted" style="margin-top:10px">Bezirksvertretung (vorläufig, inkl. Großteil der Wahlkarten, <a href="https://www.vienna.at/alle-bezirksergebnisse-zur-wien-wahl-2025-im-ueberblick/9363623" target="_blank" rel="noopener">vienna.at</a>)</p><div class="parties">${rows(W.bv[nr])}</div>`}</div>`;
}
async function wikipediaNear(p) {
  const el = $("#near-wp"); if (!el) return;
  try {
    const u = `https://de.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${p[1]}|${p[0]}&ggsradius=600&ggslimit=12&prop=extracts|coordinates&exintro=1&explaintext=1&exsentences=3&exlimit=12`;
    const d = await J(u);
    if (HERE.p !== p) return;
    const pages = Object.values(d.query?.pages || {}).map(x => ({ ...x, d: x.coordinates ? dist(p, [x.coordinates[0].lon, x.coordinates[0].lat]) : 9999 })).sort((a, b) => a.d - b.d);
    if (!pages.length) return;
    el.innerHTML = `<div class="section"><h3>Wikipedia in der Nähe <small>live</small></h3>${pages.map(x => `<div class="item"><div class="dist">${fmtD(x.d)}</div><div class="body"><b>${esc(x.title)}</b><div class="ex">${esc(x.extract || "")}</div><div class="src"><a href="https://de.wikipedia.org/?curid=${x.pageid}" target="_blank" rel="noopener">Wikipedia ↗</a></div></div></div>`).join("")}</div>`;
    $$("#near-wp .item").forEach(it => it.onclick = ev => { if (!ev.target.closest("a")) it.classList.toggle("open"); });
  } catch { }
}
function storyCard(o, withDist) {
  return `<div class="card story" data-story="${esc(o.id)}"><h4>${esc(o.n)}</h4>
    <div class="meta">${withDist && o.d != null ? `<span>${fmtD(o.d)}</span>` : ""}${o.jahr ? `<span>${esc(o.jahr)}</span>` : ""}${o.kat ? `<span>${esc(KAT[o.kat] || o.kat)}</span>` : ""}${o.adr ? `<span>${esc(o.adr)}</span>` : ""}</div>
    <p>${esc(o.text)}</p>${o.fakt ? `<div class="fact">${esc(o.fakt)}</div>` : ""}${srcLinks(o)}</div>`;
}
function bindStoryCards(root) {
  $$("[data-story]", root).forEach(c => c.onclick = ev => {
    if (ev.target.closest("a")) return;
    const o = allStories().find(x => x.id === c.dataset.story); if (!o?.c) return;
    if (VIEW !== "karte") location.hash = "#/";
    focusLayer.clearLayers();
    L.circleMarker([o.c[1], o.c[0]], { radius: 8, color: "#b3261e", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer);
    map.setView([o.c[1], o.c[0]], Math.max(map.getZoom(), 17));
  });
}
const KAT = { geschichte: "Geschichte", bauwerk: "Bauwerk", mythos: "Sage und Mythos", ereignis: "Ereignis", verschwunden: "Verschwunden", wasser: "Wasser", wohnen: "Wohnen", natur: "Natur", kultur: "Kultur", alltag: "Alltag", politik: "Politik", kurios: "Kurioses", erinnerung: "Erinnerung", industrie: "Industrie", teil: "Ortsteil" };
function showStory(o) {
  focusLayer.clearLayers();
  L.circleMarker([o.c[1], o.c[0]], { radius: 8, color: "#b3261e", weight: 3, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer);
  sheetHTML(storyCard(o) + `<button class="btn ghost" id="herebtn">Was ist hier noch?</button>`);
  $("#herebtn").onclick = () => showHere(o.c, { title: o.n });
}
function showWikiEntry(e) {
  sheetHTML(`<div class="card"><h4>${esc(e.n)}</h4><div class="meta">${e.art ? `<span>${esc(e.art)}</span>` : ""}${e.adr ? `<span>${esc(e.adr)}</span>` : ""}${e.von ? `<span>${esc(e.von)}${e.bis ? "–" + esc(e.bis) : ""}</span>` : ""}</div>
    <p style="white-space:pre-line">${esc(e.t || (e.benannt ? "Benannt nach " + e.benannt : ""))}</p>${e.frueher ? `<p class="small muted">Frühere Bezeichnung: ${esc(e.frueher)}</p>` : ""}
    <div class="src"><a href="${GW(e.id)}" target="_blank" rel="noopener">Weiterlesen im Wien Geschichte Wiki ↗</a></div></div><button class="btn ghost" id="herebtn">Was ist hier noch?</button>`);
  $("#herebtn").onclick = () => showHere(e.c, { title: e.n });
}
function showLine(id) {
  const l = DATA.lineById[id]; if (!l) return;
  if (VIEW !== "karte") location.hash = "#/";
  focusLayer.clearLayers();
  const g = L.geoJSON(l.geom, { style: { color: l.color || LINE_COL[l.t], weight: 7, opacity: .95 } }).addTo(focusLayer);
  map.fitBounds(g.getBounds(), { padding: [30, 30], paddingBottomRight: [0, 160] });
  const st = lineStops(l);
  st.forEach(s => L.circleMarker([s.c[1], s.c[0]], { radius: 4, color: "#1d1a17", weight: 1.5, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(s.n, { className: "lbl" }).addTo(focusLayer));
  const facts = (DATA.content.linien || {})[id];
  const typ = { U: "U-Bahn-Linie", S: "S-Bahn-Linie", T: "Straßenbahnlinie", B: "Autobuslinie", N: "NightLine" }[l.t];
  const bz = [...new Set(st.map(s => s.b).filter(Boolean))].sort((a, b) => a - b);
  sheetHTML(`<div class="where"><h2>${badge(id)} ${typ}</h2></div>
    <p class="small muted">${st.length} Haltestellen · Bezirke ${bz.join(", ")}</p>
    ${facts ? `<div class="card"><p>${esc(facts.text)}</p>${srcLinks(facts)}</div>` : ""}
    <p class="small muted">Haltestellen (alphabetisch): ${st.map(s => esc(s.n)).join(" · ")}</p>`);
}

// ---------------------------------------------------------------- Suche
function initSearch() {
  const q = $("#q"), res = $("#qres");
  let items = null;
  async function index() {
    if (items) return items;
    await loadLazy("strassen");
    items = [
      ...DATA.lines.map(l => ({ n: l.id, sub: { U: "U-Bahn", S: "S-Bahn", T: "Straßenbahn", B: "Bus", N: "NightLine" }[l.t], go: () => showLine(l.id), w: 3 })),
      ...DATA.ubahn_stationen.map(s => ({ n: s.n, sub: "U-Bahn-Station " + s.l.join("/"), go: () => fly(s.c, s.n), w: 2 })),
      ...DATA.bezirke.map(b => ({ n: `${b.nr}. ${b.name}`, sub: "Bezirk", go: () => location.hash = `#/bezirk/${b.nr}`, w: 3 })),
      ...DATA.kg.map(k => ({ n: k.name, sub: "Katastralgemeinde", go: () => fly(centroid(k.geom), k.name), w: 2 })),
      ...allStories().filter(o => o.c).map(o => ({ n: o.n, sub: "Geschichte", go: () => showStory(o), w: 2 })),
      ...DATA.stops.map(s => ({ n: s.n, sub: "Haltestelle " + s.l.slice(0, 6).join(" "), go: () => fly(s.c, s.n), w: 1 })),
      ...DATA.strassen.map(s => ({ n: s.n, sub: `${s.b || ""}. Bezirk`, go: () => fly(s.c, s.n), w: 0 })),
    ];
    items.forEach(i => i.k = norm(i.n));
    return items;
  }
  q.oninput = async () => {
    const t = norm(q.value); if (t.length < 1) { res.classList.remove("on"); return; }
    const all = await index();
    const hits = all.filter(i => i.k.startsWith(t) || (t.length > 2 && i.k.includes(t))).sort((a, b) => (b.k.startsWith(t) - a.k.startsWith(t)) || (b.w - a.w) || a.n.length - b.n.length).slice(0, 14);
    res.innerHTML = hits.map((h, i) => `<button data-i="${i}">${esc(h.n)}<small>${esc(h.sub)}</small></button>`).join("") || `<button disabled>Nichts gefunden</button>`;
    res.classList.add("on");
    $$("button[data-i]", res).forEach(b => b.onclick = () => { res.classList.remove("on"); q.value = ""; q.blur(); hits[+b.dataset.i].go(); });
  };
  q.onkeydown = e => { if (e.key === "Enter") $("#qres button[data-i]")?.click(); if (e.key === "Escape") res.classList.remove("on"); };
  document.addEventListener("click", e => { if (!e.target.closest(".search")) res.classList.remove("on"); });
}
function fly(c, title) {
  if (VIEW !== "karte") location.hash = "#/";
  map.setView([c[1], c[0]], 17);
  showHere(c, { title });
}

// ---------------------------------------------------------------- Seiten
let VIEW = "karte";
function page(h) { const p = $("#page"); p.innerHTML = `<div class="wrap">${h}</div>`; p.hidden = false; p.scrollTop = 0; }
function hidePage() { $("#page").hidden = true; }

function viewEntdecken() {
  const C = DATA.content;
  const themen = Object.entries(KAT).filter(([k]) => k !== "teil").map(([k, v]) => [k, v, (C.orte || []).filter(o => o.kat === k).length]).filter(x => x[2]);
  const rnd = pick((C.orte || []).filter(o => o.fakt), 1)[0];
  page(`<div class="hero"><div class="kicker">Entdecken</div><h1>23 Bezirke, 89 alte Gemeinden</h1>
    <p class="muted">Bezirksporträts, die Dörfer und Vorstädte, aus denen Wien zusammengewachsen ist, und Geschichten zu einzelnen Orten. Jede Angabe mit Quelle zum Weiterlesen.</p></div>
    ${rnd ? `<div class="fact">${esc(rnd.fakt)} <a href="#/ort/${esc(rnd.id)}">${esc(rnd.n)} →</a></div>` : ""}
    <div class="section"><h3>Bezirke</h3><div class="grid">${DATA.bezirke.map(b => {
      const n = (C.orte || []).filter(o => o.b === b.nr).length; const seen = (C.orte || []).filter(o => o.b === b.nr && S.seen[o.id]).length;
      return `<a class="tile" href="#/bezirk/${b.nr}"><span class="num">${b.nr}</span><b>${esc(b.name)}</b><span class="small muted">${n ? n + " Geschichten" : "Porträt folgt"}</span>${n ? `<span class="prog"><i style="width:${100 * seen / n}%"></i></span>` : ""}</a>`; }).join("")}</div></div>
    ${themen.length ? `<div class="section"><h3>Themen</h3><div class="row">${themen.map(([k, v, n]) => `<a class="chip" href="#/thema/${k}">${esc(v)} · ${n}</a>`).join("")}</div></div>` : ""}
    ${(C.stadt || []).length ? `<div class="section"><h3>Ganz Wien</h3>${C.stadt.map(t => `<a class="mode" href="#/stadt/${esc(t.id)}"><span class="ic">✦</span><span class="body"><b>${esc(t.n)}</b><br><span class="small muted">${esc(t.kurz || "")}</span></span></a>`).join("")}</div>` : ""}
    <div class="section"><h3>Daten und Quellen</h3><p class="small muted">Geodaten: Stadt Wien – data.wien.gv.at (CC BY 4.0), Katastralgemeinden: BEV Verwaltungsgrenzen 1:50 000, Kartengrundlage basemap.at. Ortsbeschreibungen: Wien Geschichte Wiki (gekürzt, mit Link) und Wikipedia (live). Bezirksporträts und Geschichten sind aus diesen Quellen zusammengefasst; die Links führen zu den Quellen.</p></div>`);
}
function viewBezirk(nr) {
  nr = +nr; const b = DATA.bezirke.find(x => x.nr === nr); if (!b) return viewEntdecken();
  const C = DATA.content, p = C.bezirke?.[nr] || {};
  const orte = (C.orte || []).filter(o => o.b === nr), teile = (C.teile || []).filter(t => t.b === nr);
  const kgs = DATA.kg.filter(k => k.bez === nr);
  const ust = DATA.ubahn_stationen.filter(s => s.b === nr);
  page(`<div class="hero"><div class="kicker">${nr}. Bezirk</div><h1>${esc(b.name)}</h1>${p.kurz ? `<p style="font-size:1.08rem">${esc(p.kurz)}</p>` : ""}
    <div class="row"><button class="btn" id="bzmap">Auf der Karte</button><a class="btn ghost" href="#/quiz/bezirk-${nr}">Quiz zum Bezirk</a></div></div>
    ${(p.profil || []).length ? `<div class="section prose"><h3>Porträt</h3>${p.profil.map(x => `<p>${esc(x)}</p>`).join("")}${srcLinks(p)}</div>` : `<p class="muted">Das ausführliche Porträt für diesen Bezirk ist noch in Arbeit.</p>`}
    ${p.politik ? `<div class="section"><h3>Politik</h3><p>${esc(p.politik)}</p>${p.bv_url ? `<div class="src"><a href="${esc(p.bv_url)}" target="_blank" rel="noopener">Aktuelle Bezirksvorstehung (Stadt Wien) ↗</a></div>` : ""}</div>` : ""}
    ${wahlBlock(nr, false)}
    <div class="section"><h3>Alte Gemeinden und Grätzel <small>${kgs.length} Katastralgemeinden</small></h3>
      <p class="small muted">Katastralgemeinden: ${kgs.map(k => esc(k.name)).join(", ")}</p>
      ${teile.map(t => `<div class="card"><h4>${esc(t.n)} <span class="muted small">${esc(t.art || "")}</span></h4><p>${esc(t.text)}</p>${srcLinks(t)}</div>`).join("")}</div>
    ${orte.length ? `<div class="section"><h3>Geschichten <small>${orte.length}</small></h3>${orte.map(o => storyCard(o)).join("")}</div>` : ""}
    <div class="section"><h3>U-Bahn im Bezirk</h3><p>${ust.map(s => `${esc(s.n)} ${badges(s.l)}${s.y ? `<span class="muted small"> seit ${s.y}</span>` : ""}`).join(" · ") || "<span class='muted'>keine U-Bahn-Station</span>"}</p></div>`);
  orte.forEach(o => S.seen[o.id] = 1); save();
  bindStoryCards($("#page"));
  $("#bzmap").onclick = () => { location.hash = "#/"; setTimeout(() => { focusLayer.clearLayers(); L.geoJSON(b.geom, { style: { color: "#b3261e", weight: 3, fillOpacity: .05 } }).addTo(focusLayer); map.fitBounds(bboxOf(b.geom)); showHere(centroid(b.geom), { title: `${nr}. ${b.name}` }); }, 50); };
}
function viewThema(k) {
  const orte = (DATA.content.orte || []).filter(o => o.kat === k).sort((a, b) => a.b - b.b);
  page(`<div class="hero"><div class="kicker">Thema</div><h1>${esc(KAT[k] || k)}</h1></div>${orte.map(o => `<p class="small muted" style="margin:14px 0 -4px">${o.b}. ${esc(DATA.bezirke.find(b => b.nr === o.b)?.name || "")}</p>` + storyCard(o)).join("")}`);
  bindStoryCards($("#page"));
}
function viewOrt(id) {
  const o = allStories().find(x => x.id === id); if (!o) return viewEntdecken();
  page(`<div class="hero"><div class="kicker">${o.b}. Bezirk</div></div>${storyCard(o)}`); bindStoryCards($("#page"));
}
function viewStadt(id) {
  const t = (DATA.content.stadt || []).find(x => x.id === id); if (!t) return viewEntdecken();
  page(`<div class="hero"><div class="kicker">Ganz Wien</div><h1>${esc(t.n)}</h1><p>${esc(t.kurz || "")}</p></div><div class="prose">${(t.text || []).map(x => `<p>${esc(x)}</p>`).join("")}</div>${srcLinks(t)}
    ${(t.orte || []).length ? `<div class="section"><h3>Orte dazu</h3>${t.orte.map(o => storyCard(o)).join("")}</div>` : ""}`);
}

// ---------------------------------------------------------------- Quiz
// Leitner-Boxen 0..5; fällig nach Box-Intervall (Tage)
const IVL = [0, 1, 3, 7, 16, 40];
let QZ = null;
const MODES = [
  { id: "ubahn-station", ic: "Ⓤ", n: "U-Bahn-Stationen", d: "Station auf der Karte: Wie heißt sie?", items: () => DATA.ubahn_stationen.map(s => ({ id: s.n, s })), ask: askStation },
  { id: "wo-station", ic: "⌖", n: "Wo liegt die Station?", d: "Tippe die U-Bahn-Station auf der Karte an.", items: () => DATA.ubahn_stationen.map(s => ({ id: s.n, s })), ask: askWoStation },
  { id: "tram", ic: "🚋", n: "Straßenbahnlinien", d: "Streckenverlauf erkennen und Linie benennen.", items: () => DATA.lines.filter(l => l.t === "T").map(l => ({ id: l.id, l })), ask: askLine },
  { id: "bus", ic: "🚌", n: "Autobuslinien", d: "Welche Buslinie fährt diese Strecke?", items: () => DATA.lines.filter(l => l.t === "B").map(l => ({ id: l.id, l })), ask: askLine },
  { id: "ubahn-linie", ic: "〰", n: "U- und S-Bahn-Linien", d: "Linie am Verlauf erkennen.", items: () => DATA.lines.filter(l => l.t === "U" || l.t === "S").map(l => ({ id: l.id, l })), ask: askLine },
  { id: "nacht", ic: "☾", n: "NightLines", d: "Nachtbusse am Verlauf erkennen.", items: () => DATA.lines.filter(l => l.t === "N").map(l => ({ id: l.id, l })), ask: askLine },
  { id: "bezirk", ic: "▦", n: "Bezirke", d: "Bezirk an der Form erkennen.", items: () => DATA.bezirke.map(b => ({ id: String(b.nr), b })), ask: askBezirk },
  { id: "kg", ic: "⌂", n: "Alte Gemeinden", d: "Katastralgemeinde auf der Karte: Welches Dorf, welche Vorstadt war das?", items: () => DATA.kg.map(k => ({ id: k.nr, k })), ask: askKG },
  { id: "gewaesser", ic: "≈", n: "Bäche und Flüsse", d: "Welches Gewässer ist das?", items: () => DATA.gewaesser.filter(g => !/\d|zubringer|graben|gerinne|kanal$|entlastung|hafen/i.test(g.n) || /donaukanal|wiener neustädter kanal/i.test(g.n)).map(g => ({ id: g.n, g })), ask: askGewaesser },
  { id: "strasse", ic: "✎", n: "Straßennamen", d: "Nach wem oder was ist die Straße benannt?", items: () => (DATA.strassen || []).filter(nonTrivialStreet).map(s => ({ id: String(s.id), s })), ask: askStrasse, need: "strassen" },
  { id: "gemeindebau", ic: "▣", n: "Gemeindebauten", d: "Benannte Höfe erkennen.", items: () => (DATA.gemeindebauten || []).filter(g => g.named && g.geom && (g.w || 0) >= 150).map(g => ({ id: g.n + g.b, g })), ask: askGemeindebau, need: "gemeindebauten" },
  { id: "markt", ic: "◍", n: "Märkte", d: "Welcher Markt ist das?", items: () => DATA.maerkte.map(m => ({ id: m.n, m })), ask: askMarkt },
  { id: "wahl", ic: "✓", n: "Wahl 2025", d: "Stärkste Partei im Bezirk bei Gemeinderats- und Bezirksvertretungswahl.", items: () => DATA.bezirke.flatMap(b => [{ id: "gr" + b.nr, b, w: "gr" }, { id: "bv" + b.nr, b, w: "bv" }]), ask: askWahl },
  { id: "fakten", ic: "★", n: "Wienwissen", d: "Fragen zu Geschichte, Bauten, Sagen und Grätzeln.", items: () => (DATA.content.fragen || []).map(f => ({ id: f.id, f })), ask: askFakt },
];
const modeById = id => MODES.find(m => m.id === id);
function scopeFilter(items, mode) {
  const sc = S.settings.scope || "wien";
  if (sc === "wien") return items;
  const center = sc === "nah" ? me : null, bz = sc.startsWith("b") ? +sc.slice(1) : null;
  const pos = it => it.s?.c || it.m?.c || it.g?.c || (it.l ? null : null);
  return items.filter(it => {
    if (it.f) return bz ? it.f.b === bz : true;
    if (it.b) return bz ? it.b.nr === bz : center ? distToGeom(center, it.b.geom) < 3000 : true;
    if (it.k) return bz ? it.k.bez === bz : center ? distToGeom(center, it.k.geom) < 2500 : true;
    if (it.l) { const st = DATA.stops.filter(s => s.l.includes(it.l.id)); return bz ? st.some(s => s.b === bz) : center ? st.some(s => dist(center, s.c) < 1500) : true; }
    if (it.g && it.g.geom && !it.g.c) return bz ? false : center ? distToGeom(center, it.g.geom) < 2500 : true;
    const c = pos(it); if (!c) return true;
    if (it.s && it.s.b !== undefined && bz) return it.s.b === bz;
    if (it.g && it.g.b !== undefined && bz) return it.g.b === bz;
    if (it.m && bz) return it.m.b === bz;
    return center ? dist(center, c) < 2500 : true;
  });
}
function qstate(mode, id) { return ((S.q[mode] ||= {})[id] ||= { box: 0, due: 0, n: 0, ok: 0 }); }
function dueItems(mode, items) {
  const now = Date.now();
  const seen = items.filter(it => S.q[mode]?.[it.id]?.n);
  const due = seen.filter(it => qstate(mode, it.id).due <= now).sort((a, b) => qstate(mode, a.id).box - qstate(mode, b.id).box);
  const fresh = shuffle(items.filter(it => !S.q[mode]?.[it.id]?.n));
  return { due, fresh };
}
function viewQuiz() {
  const sc = S.settings.scope || "wien";
  const myB = me ? bezirkAt(me)?.nr : null;
  page(`<div class="hero"><div class="kicker">Quiz</div><h1>Kennst du dich aus?</h1>
    <p class="muted">Jede Runde hat 10 Fragen. Was du falsch beantwortest, kommt bald wieder; was sitzt, kommt seltener (Lernkartei).</p></div>
    <div class="scope">${[["wien", "Ganz Wien"], ["nah", "In meiner Nähe"], ...(myB ? [["b" + myB, `Mein Bezirk (${myB}.)`]] : [])].map(([k, v]) => `<button class="chip ${sc === k ? "on" : ""}" data-sc="${k}">${v}</button>`).join("")}
      <select id="bzsel" class="chip"><option value="">Bezirk wählen …</option>${DATA.bezirke.map(b => `<option value="b${b.nr}" ${sc === "b" + b.nr ? "selected" : ""}>${b.nr}. ${esc(b.name)}</option>`).join("")}</select></div>
    ${MODES.map(m => { const st = modeStats(m); return `<button class="mode" data-m="${m.id}"><span class="ic">${m.ic}</span><span class="body"><b>${esc(m.n)}</b><br><span class="small muted">${esc(m.d)}</span>
      <div class="boxes">${st.boxes.map((n, i) => `<i style="background:${["#d9cfbd", "#e9a99f", "#e6c27a", "#b8d08a", "#7fb48e", "#2f6b4f"][i]};flex-grow:${n || 0.0001}"></i>`).join("")}</div></span>
      <span class="stat">${st.known}/${st.total}<br>sicher</span></button>`; }).join("")}`);
  $$("[data-sc]").forEach(b => b.onclick = () => { if (b.dataset.sc === "nah" && !me) { locate(false); toast("Standort wird ermittelt …"); } S.settings.scope = b.dataset.sc; save(); viewQuiz(); });
  $("#bzsel").onchange = e => { if (e.target.value) { S.settings.scope = e.target.value; save(); viewQuiz(); } };
  $$("[data-m]").forEach(b => b.onclick = () => location.hash = `#/quiz/${b.dataset.m}`);
}
function modeStats(m) {
  let items = []; try { items = m.items(); } catch { }
  const boxes = [0, 0, 0, 0, 0, 0];
  for (const it of items) boxes[S.q[m.id]?.[it.id]?.box || 0]++;
  return { total: items.length, known: boxes[3] + boxes[4] + boxes[5], boxes };
}
async function startQuiz(modeId) {
  let bzQuiz = null;
  if (modeId.startsWith("bezirk-")) { bzQuiz = +modeId.slice(7); modeId = "fakten"; S.settings.scope = "b" + bzQuiz; }
  const m = modeById(modeId); if (!m) return viewQuiz();
  if (m.need) await loadLazy(m.need);
  if (S.settings.scope === "nah" && !me) { locate(false); toast("Standort wird ermittelt …"); }
  const items = scopeFilter(m.items(), m);
  if (!items.length) { toast("Keine Fragen für diese Auswahl"); location.hash = "#/quiz"; return; }
  const { due, fresh } = dueItems(m.id, items);
  const n = Math.min(10, items.length);
  const queue = [...due.slice(0, 6), ...fresh].slice(0, n);
  while (queue.length < n) queue.push(...shuffle(items).filter(i => !queue.includes(i)).slice(0, n - queue.length));
  QZ = { m, items, queue, i: 0, right: 0, answered: false };
  hidePage(); sheet().hidden = true;
  map.removeLayer(baseExplore); baseQuiz.addTo(map);
  await applyLayers();
  nextQ();
}
function endQuizMap() {
  if (map.hasLayer(baseQuiz)) { map.removeLayer(baseQuiz); baseExplore.addTo(map); }
  focusLayer.clearLayers(); map.off("click", quizClick);
  $("#quizbar").hidden = true;
}
function nextQ() {
  focusLayer.clearLayers(); map.off("click", quizClick);
  if (QZ.i >= QZ.queue.length) return quizDone();
  QZ.answered = false; QZ.cur = QZ.queue[QZ.i];
  QZ.m.ask(QZ.cur);
}
function qbar(q, body) {
  const b = $("#quizbar"); b.hidden = false;
  b.innerHTML = `<div class="qprog"><i style="width:${100 * QZ.i / QZ.queue.length}%"></i></div><div class="qtop"><span>${esc(QZ.m.n)} · ${QZ.i + 1}/${QZ.queue.length}</span><button class="chip" id="qstop">Beenden</button></div>
    <div class="qq">${q}</div>${body}<div id="qfb"></div>`;
  $("#qstop").onclick = () => { QZ = null; endQuizMap(); location.hash = "#/quiz"; };
}
function mcBody(opts) { return `<div class="opts">${opts.map((o, i) => `<button data-o="${i}">${o.html || esc(o.t)}</button>`).join("")}</div>`; }
function bindMC(opts, correctIdx, explain) {
  $$("#quizbar [data-o]").forEach(b => b.onclick = () => {
    if (QZ.answered) return;
    const i = +b.dataset.o, ok = i === correctIdx;
    $$("#quizbar [data-o]").forEach(x => { if (+x.dataset.o === correctIdx) x.classList.add("ok"); else if (x === b) x.classList.add("bad"); });
    answer(ok, explain);
  });
}
function typeBody(ph) { return `<div class="typein"><input id="ti" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off"><button class="btn" id="tok">OK</button></div><button class="chip" id="tmc" style="margin-top:8px">Auswahl zeigen</button>`; }
function bindType(accept, explain, mcFallback) {
  const go = () => { if (QZ.answered) return; const v = norm($("#ti").value); if (!v) return; answer(accept.some(a => norm(a) === v), explain); };
  $("#tok").onclick = go; $("#ti").onkeydown = e => { if (e.key === "Enter") go(); };
  setTimeout(() => $("#ti")?.focus({ preventScroll: true }), 50);
  $("#tmc").onclick = () => { const body = mcFallback(); $(".typein").outerHTML = body.html; $("#tmc").remove(); bindMC(body.opts, body.correct, explain); };
}
function answer(ok, explain) {
  QZ.answered = true;
  const st = qstate(QZ.m.id, QZ.cur.id);
  st.n++; if (ok) { st.ok++; st.box = Math.min(5, st.box + 1); QZ.right++; } else st.box = Math.max(0, Math.min(st.box, 1) - 0);
  if (!ok) st.box = 0;
  st.due = Date.now() + IVL[st.box] * 864e5 - 36e5;
  const day = new Date().toISOString().slice(0, 10);
  S.stats.answers++; if (ok) S.stats.right++; S.stats.days[day] = (S.stats.days[day] || 0) + 1;
  save();
  $("#qfb").innerHTML = `<div class="fb ${ok ? "ok" : "bad"}"><div class="verdict">${ok ? "Richtig!" : "Leider falsch."}</div>${explain || ""}<div class="row" style="margin-top:8px"><button class="btn rot" id="qnext">${QZ.i + 1 < QZ.queue.length ? "Weiter" : "Auswertung"}</button></div></div>`;
  $("#qnext").onclick = () => { QZ.i++; nextQ(); };
  $("#qnext").focus({ preventScroll: true });
  $("#quizbar").scrollTop = 1e5;
}
function quizDone() {
  const r = QZ.right, n = QZ.queue.length, mid = QZ.m.id;
  focusLayer.clearLayers();
  $("#quizbar").innerHTML = `<div class="qq">${r} von ${n} richtig</div><p class="muted">${r === n ? "Perfekte Runde." : r >= n * .7 ? "Gut! Die Fehler kommen in den nächsten Runden wieder." : "Dranbleiben: Falsch beantwortete Fragen kommen bald wieder."}</p>
    <div class="row"><button class="btn rot" id="qagain">Noch eine Runde</button><a class="btn ghost" href="#/quiz">Andere Kategorie</a></div>`;
  $("#qagain").onclick = () => startQuiz(mid);
  QZ.done = true;
}
const distractors = (pool, correct, key, n = 3) => pick(pool.filter(x => key(x) !== key(correct)), n);
function nearestOthers(pool, c, getC, n, exclude) {
  return pool.filter(x => x !== exclude).map(x => [x, dist(c, getC(x))]).sort((a, b) => a[1] - b[1]).slice(0, n * 3).map(x => x[0]);
}
function mcFrom(correctT, wrongTs) { const opts = shuffle([correctT, ...wrongTs]).map(t => ({ t })); return { opts, correct: opts.findIndex(o => o.t === correctT) }; }
function drawContext(kind) {
  if (kind === "ubahn") DATA.lines.filter(l => l.t === "U").forEach(l => L.geoJSON(l.geom, { style: { color: l.color, weight: 4, opacity: .6 }, interactive: false }).addTo(focusLayer));
  if (kind === "bezirke") DATA.bezirke.forEach(b => L.geoJSON(b.geom, { style: { color: "#8a8073", weight: 1, fill: false }, interactive: false }).addTo(focusLayer));
}

function askStation(it) {
  const s = it.s; drawContext("ubahn");
  L.circleMarker([s.c[1], s.c[0]], { radius: 9, color: "#1d1a17", weight: 4, fillColor: "#ffd400", fillOpacity: 1 }).addTo(focusLayer);
  map.setView([s.c[1], s.c[0]], 14);
  const wrongs = nearestOthers(DATA.ubahn_stationen, s.c, x => x.c, 3, s).slice(0, 6);
  const mc = () => mcFrom(s.n, pick(wrongs, 3).map(x => x.n));
  qbar(`Wie heißt diese U-Bahn-Station? ${badges(s.l)}`, typeBody("Stationsname"));
  const exp = `<p><b>${esc(s.n)}</b> ${badges(s.l)}${s.y ? ` · eröffnet ${s.y}` : ""}</p>`;
  bindType([s.n, s.n.replace(/-/g, " ")], exp, () => { const m = mc(); return { html: mcBody(m.opts), ...m }; });
}
let quizClick = () => { };
function askWoStation(it) {
  const s = it.s; drawContext("ubahn"); drawContext("bezirke");
  map.setView([48.205, 16.37], 12);
  qbar(`Wo liegt <b>${esc(s.n)}</b>? Tippe auf die Karte.`, `<p class="small muted">Richtig, wenn du höchstens 500 m daneben liegst.</p>`);
  quizClick = e => {
    if (QZ.answered) return;
    const p = [e.latlng.lng, e.latlng.lat], d = dist(p, s.c);
    L.circleMarker([p[1], p[0]], { radius: 6, color: "#b3261e", weight: 3, fillOpacity: 1 }).addTo(focusLayer);
    L.circleMarker([s.c[1], s.c[0]], { radius: 9, color: "#1d1a17", weight: 4, fillColor: "#ffd400", fillOpacity: 1 }).bindTooltip(s.n, { permanent: true, className: "lbl" }).addTo(focusLayer);
    L.polyline([[p[1], p[0]], [s.c[1], s.c[0]]], { color: "#b3261e", dashArray: "4 4" }).addTo(focusLayer);
    answer(d <= 500, `<p>${fmtD(d)} daneben. ${badges(s.l)}</p>`);
  };
  map.on("click", quizClick);
}
function lineMC(l) {
  const sameType = DATA.lines.filter(x => x.t === l.t && x.id !== l.id);
  const st = DATA.stops.filter(s => s.l.includes(l.id));
  const c = st.length ? st[st.length >> 1].c : [16.37, 48.2];
  const near = sameType.map(x => [x, Math.min(...DATA.stops.filter(s => s.l.includes(x.id)).slice(0, 40).map(s => dist(c, s.c)), 1e9)]).sort((a, b) => a[1] - b[1]).slice(0, 7).map(x => x[0]);
  return mcFrom(l.id, pick(near, 3).map(x => x.id));
}
function askLine(it) {
  const l = it.l;
  const g = L.geoJSON(l.geom, { style: { color: l.color || "#b3261e", weight: 6, opacity: .95 } }).addTo(focusLayer);
  const st = lineStops(l);
  st.forEach(s => L.circleMarker([s.c[1], s.c[0]], { radius: 3, color: "#1d1a17", weight: 1, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer));
  drawContext("bezirke");
  map.fitBounds(g.getBounds(), { padding: [40, 40], paddingBottomRight: [0, 220] });
  const typ = { U: "U- oder S-Bahn-Linie", S: "U- oder S-Bahn-Linie", T: "Straßenbahnlinie", B: "Autobuslinie", N: "NightLine" }[l.t];
  qbar(`Welche ${typ} ist das?`, typeBody("z. B. " + (l.t === "T" ? "49" : l.t === "B" ? "13A" : l.t === "N" ? "N25" : "U6")));
  const ends = endStops(l);
  const lf = (DATA.content.linien || {})[l.id];
  const exp = `<p>${badge(l.id)} ${ends ? esc(ends) : ""}</p>${lf ? `<p class="small">${esc(lf.text)}</p>${srcLinks(lf)}` : ""}<p class="small muted">Haltestellen: ${st.slice(0, 40).map(s => esc(s.n)).join(" · ")}</p>`;
  bindType([l.id], exp, () => { const m = lineMC(l); return { html: mcBody(m.opts.map(o => ({ html: badge(o.t), t: o.t }))), ...m }; });
}
const _ls = {};
function lineStops(l) { return _ls[l.id] ||= DATA.stops.filter(s => s.l.includes(l.id) && distToGeom(s.c, l.geom) < 150); }
function endStops(l) {
  // Endpunkte der längsten Teilstrecke grob über die am weitesten entfernten Haltestellen
  const st = lineStops(l); if (st.length < 2) return "";
  let best = [st[0], st[1]], bd = 0;
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) { const d = dist(st[i].c, st[j].c); if (d > bd) { bd = d; best = [st[i], st[j]]; } }
  return `${best[0].n} ↔ ${best[1].n}`;
}
function askBezirk(it) {
  const b = it.b; drawContext("bezirke");
  L.geoJSON(b.geom, { style: { color: "#b3261e", weight: 3, fillColor: "#b3261e", fillOpacity: .3 } }).addTo(focusLayer);
  map.fitBounds([[48.12, 16.18], [48.33, 16.58]], { paddingBottomRight: [0, 220] });
  qbar("Welcher Bezirk ist das? (Name oder Nummer)", typeBody("z. B. Hernals oder 17"));
  const p = DATA.content.bezirke?.[b.nr];
  bindType([b.name, String(b.nr), `${b.nr}. ${b.name}`, b.name.replace(/-/g, " ")], `<p><b>${b.nr}. ${esc(b.name)}</b>${p?.kurz ? " – " + esc(p.kurz) : ""}</p>`,
    () => { const m = mcFrom(`${b.nr}. ${b.name}`, distractors(DATA.bezirke, b, x => x.nr).map(x => `${x.nr}. ${x.name}`)); return { html: mcBody(m.opts), ...m }; });
}
function askKG(it) {
  const k = it.k;
  DATA.kg.forEach(x => L.geoJSON(x.geom, { style: { color: "#a89a84", weight: 1, fill: false }, interactive: false }).addTo(focusLayer));
  L.geoJSON(k.geom, { style: { color: "#b3261e", weight: 3, fillColor: "#b3261e", fillOpacity: .3 } }).addTo(focusLayer);
  map.fitBounds(bboxOf(k.geom), { padding: [80, 80], paddingBottomRight: [0, 240], maxZoom: 14 });
  const c = centroid(k.geom);
  const near = DATA.kg.filter(x => x !== k).map(x => [x, dist(c, centroid(x.geom))]).sort((a, b) => a[1] - b[1]).slice(0, 6).map(x => x[0]);
  const m = mcFrom(k.name, pick(near, 3).map(x => x.name));
  const t = (DATA.content.teile || []).find(x => norm(x.n) === norm(k.name));
  qbar("Welche Katastralgemeinde (alte Gemeinde) ist das?", mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p><b>${esc(k.name)}</b> im ${k.bez}. Bezirk.${t ? " " + esc(t.text) : ""}</p>${t ? srcLinks(t) : `<div class="src"><a href="${GWT(k.name)}" target="_blank" rel="noopener">Wien Geschichte Wiki ↗</a></div>`}`);
}
function askGewaesser(it) {
  const g = it.g;
  const lay = L.geoJSON(g.geom, { style: { color: "#1f6fb2", weight: 6 } }).addTo(focusLayer);
  drawContext("bezirke");
  map.fitBounds(lay.getBounds(), { padding: [60, 60], paddingBottomRight: [0, 220], maxZoom: 15 });
  const pool = modeById("gewaesser").items().map(x => x.g);
  const c = geomPoints(g.geom)[0];
  const near = pool.filter(x => x !== g).map(x => [x, dist(c, geomPoints(x.geom)[0])]).sort((a, b) => a[1] - b[1]).slice(0, 6).map(x => x[0]);
  const m = mcFrom(g.n, pick(near, 3).map(x => x.n));
  qbar("Welches Gewässer ist das?", mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p><b>${esc(g.n)}</b></p><div class="src"><a href="${GWT(g.n)}" target="_blank" rel="noopener">Wien Geschichte Wiki ↗</a></div>`);
}
// Nur Straßen, bei denen der Name die Antwort nicht schon verrät (nicht „Herthergasse -> Paul Herther“)
function nonTrivialStreet(s) {
  const sn = norm(s.n).replace(/\b(gasse|str|strasse|weg|platz|ring|zeile|steig|allee|lande|kai|ufer|brucke|markt|hof|park|siedlung|bezirk|\d+)\b/g, " ").trim();
  const nn = norm(s.nach);
  if (nn.split(" ").some(t => t.length >= 4 && norm(s.n).replace(/ /g, "").includes(t))) return false;
  if (sn.split(" ").some(t => t.length >= 4 && nn.replace(/ /g, "").includes(t))) return false;
  return true;
}
function askStrasse(it) {
  const s = it.s;
  L.circleMarker([s.c[1], s.c[0]], { radius: 9, color: "#b3261e", weight: 4, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer);
  map.setView([s.c[1], s.c[0]], 15);
  // Falschantworten derselben Art: Person (Vor- und Nachname) oder Sache/Ort
  const isPerson = t => /^[A-ZÄÖÜ][a-zäöüß.]+(\s+(von|van|de|zu)?\s*[A-ZÄÖÜ][\wäöüß.-]+)+$/.test(t) && !/^(Gleichnamig|Ehemalig|Frühere?)/.test(t);
  const kind = isPerson(s.nach);
  const ok = x => x.nach !== s.nach && !/gasse|stra(ß|ss)e|weg\b|platz/i.test(x.nach) && isPerson(x.nach) === kind && x.nach.length < 60;
  let pool = DATA.strassen.filter(x => x.b === s.b && ok(x) && nonTrivialStreet(x));
  if (pool.length < 6) pool = DATA.strassen.filter(x => ok(x) && nonTrivialStreet(x));
  const m = mcFrom(s.nach, [...new Set(pick(pool, 6).map(x => x.nach))].slice(0, 3));
  qbar(`Nach wem oder was ist die <b>${esc(s.n)}</b> (${s.b}.) benannt?`, mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p style="white-space:pre-line">${esc(s.t || "")}</p><div class="src"><a href="${GW(s.id)}" target="_blank" rel="noopener">Wien Geschichte Wiki ↗</a></div>`);
}
function askGemeindebau(it) {
  const g = it.g;
  L.geoJSON(g.geom, { style: { color: "#b3261e", weight: 3, fillOpacity: .45 } }).addTo(focusLayer);
  map.setView([g.c[1], g.c[0]], 16);
  const pool = modeById("gemeindebau").items().map(x => x.g);
  const near = pool.filter(x => x !== g).map(x => [x, dist(g.c, x.c)]).sort((a, b) => a[1] - b[1]).slice(0, 6).map(x => x[0]);
  const m = mcFrom(g.n, pick(near, 3).map(x => x.n));
  qbar("Wie heißt dieser Gemeindebau?", mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p><b>${esc(g.n)}</b>, ${g.b}. Bezirk${g.y ? ", erbaut " + g.y : ""}${g.w ? ", " + g.w + " Wohnungen" : ""}.</p><div class="src"><a href="${GWT(g.n)}" target="_blank" rel="noopener">Wien Geschichte Wiki ↗</a>${g.pdf ? `<a href="${esc(g.pdf)}" target="_blank" rel="noopener">Datenblatt ↗</a>` : ""}</div>`);
}
function askMarkt(it) {
  const mk = it.m;
  L.circleMarker([mk.c[1], mk.c[0]], { radius: 10, color: "#b3261e", weight: 4, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer);
  drawContext("bezirke"); map.setView([mk.c[1], mk.c[0]], 14);
  const near = DATA.maerkte.filter(x => x !== mk).map(x => [x, dist(mk.c, x.c)]).sort((a, b) => a[1] - b[1]).slice(0, 5).map(x => x[0]);
  const m = mcFrom(mk.n, pick(near, 3).map(x => x.n));
  qbar("Welcher Markt liegt hier?", mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p><b>${esc(mk.n)}</b>, ${mk.b}. Bezirk</p>`);
}
function askWahl(it) {
  const b = it.b, w = DATA.wahl2025[it.w][b.nr];
  L.geoJSON(b.geom, { style: { color: "#b3261e", weight: 3, fillOpacity: .2 } }).addTo(focusLayer);
  drawContext("bezirke"); map.fitBounds([[48.12, 16.18], [48.33, 16.58]], { paddingBottomRight: [0, 220] });
  const parties = ["SPÖ", "ÖVP", "FPÖ", "GRÜNE", "NEOS"];
  const right = w.parteien[0][0];
  const opts = parties.map(t => ({ t })); const correct = parties.indexOf(right);
  qbar(`Welche Partei wurde bei der ${it.w === "gr" ? "Gemeinderatswahl" : "Bezirksvertretungswahl"} 2025 im <b>${b.nr}. Bezirk (${esc(b.name)})</b> stärkste Kraft?`, mcBody(opts));
  bindMC(opts, correct, `<p>${w.parteien.slice(0, 4).map(([n, v]) => `${esc(n)} ${String(v).replace(".", ",")} %`).join(" · ")}</p><p class="small muted">Quelle: Stadt Wien, Wahlergebnisse 2025 (OGD)</p>`);
}
function askFakt(it) {
  const f = it.f;
  if (f.c) { L.circleMarker([f.c[1], f.c[0]], { radius: 9, color: "#b3261e", weight: 4, fillColor: "#fff", fillOpacity: 1 }).addTo(focusLayer); map.setView([f.c[1], f.c[0]], 15); }
  else { const b = DATA.bezirke.find(x => x.nr === f.b); if (b) { L.geoJSON(b.geom, { style: { color: "#b3261e", weight: 2, fillOpacity: .08 } }).addTo(focusLayer); map.fitBounds(bboxOf(b.geom), { paddingBottomRight: [0, 220] }); } }
  const m = mcFrom(f.a, f.f.slice(0, 3));
  qbar(esc(f.q), mcBody(m.opts));
  bindMC(m.opts, m.correct, `<p>${esc(f.erkl || "")}</p>${srcLinks(f)}`);
}

// ---------------------------------------------------------------- Fortschritt
function viewIch() {
  const rows = MODES.map(m => ({ m, s: modeStats(m) }));
  const days = Object.entries(S.stats.days).sort().slice(-14);
  const storiesSeen = Object.keys(S.seen).length, storiesAll = (DATA.content.orte || []).length;
  page(`<div class="hero"><div class="kicker">Fortschritt</div><h1>Dein Wienwissen</h1></div>
    <div class="grid">
      <div class="tile"><span class="num">${S.stats.answers}</span><b>Antworten</b><span class="small muted">${S.stats.answers ? Math.round(100 * S.stats.right / S.stats.answers) : 0} % richtig</span></div>
      <div class="tile"><span class="num">${rows.reduce((a, r) => a + r.s.known, 0)}</span><b>sicher gewusst</b><span class="small muted">Box 3 und höher</span></div>
      <div class="tile"><span class="num">${storiesSeen}</span><b>Geschichten gelesen</b><span class="small muted">von ${storiesAll}</span></div>
    </div>
    <div class="section"><h3>Je Kategorie</h3>${rows.map(({ m, s }) => `<div class="item"><div class="body"><b>${esc(m.n)}</b><div class="boxes">${s.boxes.map((n, i) => `<i style="background:${["#d9cfbd", "#e9a99f", "#e6c27a", "#b8d08a", "#7fb48e", "#2f6b4f"][i]};flex-grow:${n || 0.0001}"></i>`).join("")}</div></div><div class="dist">${s.known}/${s.total}</div></div>`).join("")}</div>
    <div class="section"><h3>Letzte Tage</h3><p class="small">${days.map(([d, n]) => `${d.slice(8)}.${d.slice(5, 7)}.: ${n}`).join(" · ") || "<span class='muted'>Noch keine Antworten.</span>"}</p></div>
    <p class="small muted">Der Fortschritt wird am Server gespeichert und ist auf allen deinen Geräten gleich.</p>`);
}

// ---------------------------------------------------------------- Router
async function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [v, a] = h.split("/");
  $("#layers").hidden = true;
  if (QZ && !(v === "quiz" && a)) { QZ = null; endQuizMap(); }
  VIEW = v === "" || v === "karte" ? "karte" : v;
  $$("#nav a").forEach(x => x.classList.toggle("on", x.dataset.v === (["bezirk", "thema", "ort", "stadt"].includes(v) ? "entdecken" : VIEW)));
  if (VIEW === "karte") { hidePage(); $("#quizbar").hidden = true; sheet().hidden = false; await applyLayers(); setTimeout(() => map.invalidateSize(), 0); if (!HERE.p) showWelcome(); return; }
  sheet().hidden = true;
  if (v === "quiz" && a) { VIEW = "quiz"; return startQuiz(a); }
  await applyLayers();
  if (v === "entdecken") viewEntdecken();
  else if (v === "bezirk") viewBezirk(a);
  else if (v === "thema") viewThema(a);
  else if (v === "ort") viewOrt(decodeURIComponent(a));
  else if (v === "stadt") viewStadt(a);
  else if (v === "quiz") viewQuiz();
  else if (v === "ich") viewIch();
  else viewEntdecken();
}
function showWelcome() {
  sheetHTML(`<h2>Servus!</h2><p>Tippe auf ◎, um zu sehen, was rund um dich ist: Bezirk, alte Gemeinde, Geschichten, Wien-Geschichte-Wiki-Einträge, Öffis, Gemeindebauten. Oder tippe irgendwo auf die Karte.</p>
    <div class="row"><button class="btn rot" id="wloc">◎ Mein Standort</button><a class="btn ghost" href="#/quiz">Zum Quiz</a></div>`, "");
  $("#wloc").onclick = () => locate(true);
}
$(".grip").onclick = () => { const s = sheet(); if (s.classList.contains("min")) setSheet(""); else if (s.classList.contains("big")) setSheet("min"); else setSheet("big"); };

(async function init() {
  initMap();
  await Promise.all([loadBase(), loadState()]);
  initSearch();
  window.addEventListener("hashchange", route);
  map.on("moveend", refreshWikiLayer);
  route();
})();
