/* Compras · Comparativa: matriz de ponderación y ranking por sección.
 * Los datos se llenan directamente en la página (sin Excel):
 *   categoría → campos (criterios / características / detalles / partes del full set) → productos.
 * Al agregar un producto con enlace se intenta traer foto, nombre y marca (Apps Script; solo con Google
 * conectado y sitios que lo permiten). Excel / Google Sheets queda como opción de IMPORTAR.
 * Basado en la "Matriz Comparativa" de Fabrizio. */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-comparativa");
  if (!panel || !S) return;
  const { uid, esc } = S;
  const $ = (id) => document.getElementById(id);

  const cStore = S.createStore({
    localKey: "cmCategorias.v1", listField: "comparativaCats",
    saveAction: "saveCmCat", saveField: "categoria", deleteAction: "deleteCmCat",
  });
  const pStore = S.createStore({
    localKey: "cmProductos.v1", listField: "comparativaProds",
    saveAction: "saveCmProd", saveField: "producto", deleteAction: "deleteCmProd",
  });
  const API = window.INGENIERIA_API_URL || "";
  const LS_URL = "comparativa.sheetsUrl";
  const CONFIG_URL = (window.COMPARATIVA_SHEETS_URL || "").trim();

  const MAX_CRIT = 5, MAX_QUICK = 6;
  const ROLES = [
    { v: "criterio", l: "Criterio (se pondera)" },
    { v: "caracteristica", l: "Característica (ficha rápida)" },
    { v: "detalle", l: "Detalle (ver más)" },
    { v: "set", l: "Parte del full set ($)" },
  ];

  const state = { cats: [], prods: [], activeCat: null, view: "cards", loaded: false, timers: {} };
  const openSections = new Set();
  const catById = (id) => state.cats.find((c) => c.id === id);
  const prodById = (id) => state.prods.find((p) => p.id === id);

  // ------------------------------------------------------------- helpers ----

  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const parseLeadingNum = (v) => { if (v === null || v === undefined) return null; const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  function money(v) {
    const n = num(v);
    if (n === null) return "Cotizar";
    return "$" + n.toLocaleString("es-VE", Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const formatNumberSmart = (n) => (n === null || n === undefined || !isFinite(n)) ? "—" : (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const looksLikePriceField = (name) => /^precio|price$/i.test(name);
  const parseUnitFromHeader = (h) => { const m = String(h).match(/\(([^)]+)\)/); return m ? m[1].trim() : null; };
  const displayLabel = (h) => String(h).replace(/\s*\([^)]+\)\s*/g, " ").trim();
  const unitSuffix = (u) => !u ? "" : (u === "%" ? "%" : " " + u);
  const SET_RE = /^(?:full\s*set|set\s*completo|set)\s*[:\-]\s*(.+)$/i;
  const genericExtract = (id) => (r) => { const n = num(r[id]); return n !== null ? n : parseLeadingNum(r[id]); };
  const newFieldId = () => "f" + uid().replace(/-/g, "").slice(0, 8);

  function isNumericColumn(rows, id) {
    const sample = rows.slice(0, 10).map((r) => r[id]).filter((v) => v !== null && v !== undefined && v !== "");
    if (!sample.length) return false;
    return sample.filter((v) => num(v) !== null || parseLeadingNum(v) !== null).length >= Math.ceil(sample.length * 0.6);
  }

  function driveCandidates(url) {
    if (!url) return [];
    const s = String(url).trim();
    if (!/drive\.google\.com/.test(s)) return [s];
    const m = s.match(/[-\w]{20,}/);
    if (!m) return [s];
    const id = m[0];
    return ["https://drive.google.com/thumbnail?id=" + id + "&sz=w1000", "https://lh3.googleusercontent.com/d/" + id + "=w1000", "https://drive.google.com/uc?export=view&id=" + id];
  }
  window.cmImgFallback = function (img) {
    const cands = JSON.parse(img.dataset.cands || "[]");
    const next = (parseInt(img.dataset.idx || "0", 10)) + 1;
    if (next < cands.length) { img.dataset.idx = String(next); img.src = cands[next]; }
    else { const box = img.closest(".cm-img"); if (box) box.classList.add("err"); }
  };
  const imgOf = (p) => (p.foto ? S.fileSrc(p.foto, 900) : (p.imagen || ""));
  const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || "").trim());
  const isHttps = (u) => /^https:\/\/[^\s/]+\.[^\s/]+/i.test(String(u || "").trim());

  function setStatus(msg, kind) {
    const el = $("cmStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }
  function saveCatSoon(cat, immediate) {
    setStatus("Guardando…", "busy");
    clearTimeout(state.timers[cat.id]);
    const run = async () => {
      delete state.timers[cat.id];
      cat.actualizado = new Date().toISOString();
      try { await cStore.save(cat); setStatus(cStore.remote ? "Guardado en la nube" : "Guardado (modo local)", "ok"); }
      catch (err) { setStatus("Error al guardar: " + err.message, "err"); }
    };
    if (immediate) run(); else state.timers[cat.id] = setTimeout(run, 700);
  }
  async function saveProd(p) {
    p.actualizado = new Date().toISOString();
    await pStore.save(p);
  }

  // ------------------------------------------ modelo → estructura de render ----

  // Convierte una categoría nativa (+ sus productos) en la estructura que usan los render
  function buildModel(cat) {
    const prods = state.prods.filter((p) => p.categoria === cat.id).sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const rows = prods.map((p) => Object.assign({}, p.valores || {}, { _p: p, _sec: (p.seccion || "").trim() || "Sin sección", _marca: p.marca, _titulo: p.titulo, _img: imgOf(p) }));
    const fields = cat.campos || [];
    const critF = fields.filter((f) => f.rol === "criterio").slice(0, MAX_CRIT);
    const criteria = critF.map((f) => {
      const scored = isNumericColumn(rows, f.id);
      const isPrice = !!f.precio && scored;
      return {
        key: f.id, field: f, short: String(f.nombre || "").toUpperCase(),
        invert: f.direccion ? f.direccion === "menor" : isPrice,
        weight: 0, isCost: isPrice, unit: isPrice ? "" : unitSuffix(f.unidad), scored,
        extract: scored ? genericExtract(f.id) : ((r) => (r[f.id] ?? null)),
      };
    });
    // pesos guardados; si faltan o no suman 100, se reparten parejo
    const sc = criteria.filter((c) => c.scored);
    const saved = sc.map((c) => c.field.peso);
    const sum = saved.reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (sc.length && saved.every((v) => v !== undefined && v !== null) && Math.abs(sum - 100) < 0.5) sc.forEach((c) => { c.weight = parseFloat(c.field.peso); });
    else sc.forEach((c) => { c.weight = 100 / sc.length; });

    const quick = fields.filter((f) => f.rol === "caracteristica").slice(0, MAX_QUICK).map((f) => ({ f, label: String(f.nombre || "").toUpperCase() }));
    const details = fields.filter((f) => f.rol === "detalle");
    const sets = fields.filter((f) => f.rol === "set");
    const priceF = fields.find((f) => f.precio && (f.rol === "criterio" || f.rol === "caracteristica"));
    const numeric = {};
    fields.forEach((f) => { numeric[f.id] = isNumericColumn(rows, f.id); });
    return {
      id: cat.id, name: cat.nombre, native: cat, rows, criteria, quick, details, sets, priceKey: priceF ? priceF.id : null, numeric,
    };
  }

  function fmtField(m, f, v) {
    if (v === null || v === undefined || v === "") return "";
    if (f.precio) return money(v);
    if (m.numeric[f.id] && f.unidad) {
      const n = num(v) ?? parseLeadingNum(v);
      return n !== null ? formatNumberSmart(n) + unitSuffix(f.unidad) : v;
    }
    return v;
  }
  function fullSetOf(m, r) {
    if (!m.sets.length) return null;
    const items = m.sets.map((f) => ({ label: f.nombre, value: num(r[f.id]) })).filter((x) => x.value !== null);
    return items.length ? { total: items.reduce((s, it) => s + it.value, 0), items } : null;
  }

  // -------------------------------------------------------------- puntuación ----

  function rebalance(criteria, changedIdx, raw) {
    const newVal = Math.max(0, Math.min(100, raw));
    const others = criteria.map((_, i) => i).filter((i) => i !== changedIdx);
    const othersSum = others.reduce((s, i) => s + criteria[i].weight, 0);
    const remaining = 100 - newVal;
    if (!others.length) { criteria[changedIdx].weight = 100; return; }
    if (othersSum <= 0) others.forEach((i) => { criteria[i].weight = remaining / others.length; });
    else others.forEach((i) => { criteria[i].weight = criteria[i].weight / othersSum * remaining; });
    criteria[changedIdx].weight = newVal;
    const total = criteria.reduce((s, c) => s + c.weight, 0);
    criteria[changedIdx].weight += 100 - total;
  }

  // Un producto solo puntúa si tiene dato en TODOS los criterios ponderados de su sección
  function computeScores(criteria, products) {
    const extracted = criteria.map((c) => products.map((p) => c.extract(p)));
    const minmax = extracted.map((vals) => {
      const ns = vals.filter((v) => v !== null && v !== undefined && isFinite(v));
      return ns.length ? { min: Math.min(...ns), max: Math.max(...ns) } : null;
    });
    products.forEach((p, pi) => {
      let sum = 0, wTotal = 0;
      const missing = [];
      criteria.forEach((c, ci) => {
        const v = extracted[ci][pi], mm = minmax[ci];
        if (v === null || v === undefined || !isFinite(v) || !mm) { missing.push(c.short); return; }
        const s = mm.max === mm.min ? 100 : (c.invert ? 100 * (mm.max - v) / (mm.max - mm.min) : 100 * (v - mm.min) / (mm.max - mm.min));
        sum += s * c.weight; wTotal += c.weight;
      });
      p._score = (!missing.length && wTotal > 0) ? sum / wTotal : null;
      p._missing = missing;
    });
  }

  function groupSections(m) {
    const map = new Map();
    m.rows.forEach((r) => { if (!map.has(r._sec)) map.set(r._sec, []); map.get(r._sec).push(r); });
    return Array.from(map.entries()).map(([id, products]) => ({ id, name: id, products }));
  }

  // ------------------------------------------------------------------ render ----

  let model = null; // estructura de la categoría activa (se reconstruye al cambiar datos)
  const rebuild = () => { const c = catById(state.activeCat); model = c ? buildModel(c) : null; };

  function renderAll() {
    const has = state.cats.length > 0;
    $("cmEmpty").hidden = has;
    $("cmApp").hidden = !has;
    if (!has) return;
    if (!catById(state.activeCat)) state.activeCat = [...state.cats].sort((a, b) => (a.orden || 0) - (b.orden || 0))[0].id;
    rebuild();
    renderCats();
    renderBody();
  }

  function renderCats() {
    const host = $("cmCats");
    host.innerHTML = "";
    [...state.cats].sort((a, b) => (a.orden || 0) - (b.orden || 0)).forEach((c) => {
      const n = state.prods.filter((p) => p.categoria === c.id).length;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pz-chip" + (c.id === state.activeCat ? " active" : "");
      b.innerHTML = esc(c.nombre) + ' <span class="cm-cnt">' + n + "</span>";
      b.addEventListener("click", () => { state.activeCat = c.id; openSections.clear(); renderAll(); });
      host.appendChild(b);
    });
  }

  function renderBody() {
    const m = model;
    const body = $("cmBody");
    if (!m) { body.innerHTML = ""; return; }
    const scoredCount = m.criteria.filter((c) => c.scored).length;
    body.innerHTML =
      '<div class="cm-catbar"><span class="pz-hint">' + m.native.campos.filter((f) => f.rol === "criterio").length + " criterio(s) · " +
      m.rows.length + " producto(s)</span>" +
      '<span class="cp-spacer"></span><button type="button" class="kb-btn" data-act="cols">⚙ Configurar columnas</button>' +
      '<button type="button" class="kb-btn kb-btn-primary" data-act="add">+ Agregar producto</button></div>' +
      '<div class="pz-card"><div class="pz-card-head"><h3>Criterios y ponderación — ' + esc(m.name) + '</h3>' +
      '<span class="pz-hint">Los pesos siempre suman 100%. Sube uno y los demás bajan proporcionalmente.</span></div>' +
      '<div class="cm-crit" id="cmCrit"></div><div class="cm-critsum" id="cmCritSum"></div>' +
      '<p class="pz-hint">Si un producto no tiene dato para un criterio, no se calcula su score (queda «No aplica») y se anota en su tarjeta.</p></div>' +
      '<div class="cm-toolbar">' +
      '<input type="text" id="cmQ" placeholder="Buscar por marca o modelo (dentro de cada sección)…">' +
      '<select id="cmBrand"></select><select id="cmSort"></select>' +
      '<div class="cm-viewtoggle"><button type="button" id="cmVCards" aria-pressed="' + (state.view === "cards") + '">Tarjetas</button>' +
      '<button type="button" id="cmVTable" aria-pressed="' + (state.view === "table") + '">Tabla</button></div></div>' +
      '<div id="cmSecs"></div>';
    if (!m.native.campos.some((f) => f.rol === "criterio")) {
      $("cmCrit").innerHTML = '<p class="pz-none">Esta categoría aún no tiene criterios. Usa «⚙ Configurar columnas» para definir con qué se compara (precio, calidad, etc.).</p>';
    } else renderCriteria();
    populateFilters();
    renderSections();
    $("cmQ").addEventListener("input", renderSections);
    $("cmBrand").addEventListener("change", renderSections);
    $("cmSort").addEventListener("change", renderSections);
    $("cmVCards").addEventListener("click", () => { state.view = "cards"; renderBody(); });
    $("cmVTable").addEventListener("click", () => { state.view = "table"; renderBody(); });
    void scoredCount;
  }

  function renderCriteria() {
    const m = model;
    const scored = m.criteria.filter((c) => c.scored);
    if (!scored.length) {
      $("cmCrit").innerHTML = "";
      $("cmCritSum").textContent = "Aún no hay datos numéricos en los criterios: agrega productos con valores para poder ponderar (mientras tanto se muestran sin score).";
      return;
    }
    $("cmCrit").innerHTML = scored.map((c, i) =>
      '<div class="cm-critrow"><div class="cm-critlabel"><span>' + esc(c.short) + '</span>' +
      '<button type="button" class="cm-dir" data-idx="' + i + '" title="Cambiar qué valor es mejor">' + (c.invert ? "↓ menor = mejor" : "↑ mayor = mejor") + '</button>' +
      '<b class="cm-critval">' + Math.round(c.weight) + "%</b></div>" +
      '<input type="range" min="0" max="100" value="' + Math.round(c.weight) + '" data-idx="' + i + '" aria-label="Peso de ' + esc(c.short) + '"></div>').join("");
    // Se actualiza en el sitio (sin recrear los deslizadores) para no cortar un arrastre en curso
    $("cmCrit").querySelectorAll('input[type="range"]').forEach((inp) => inp.addEventListener("input", (e) => {
      rebalance(scored, +e.target.dataset.idx, +e.target.value);
      const rows = $("cmCrit").querySelectorAll(".cm-critrow");
      scored.forEach((c, i) => {
        const slider = rows[i].querySelector('input[type="range"]');
        if (slider !== e.target) slider.value = Math.round(c.weight);
        rows[i].querySelector(".cm-critval").textContent = Math.round(c.weight) + "%";
        c.field.peso = c.weight;
      });
      $("cmCritSum").innerHTML = "Suma actual: <b>" + Math.round(scored.reduce((s, c) => s + c.weight, 0)) + "%</b>";
      renderSections();
      saveCatSoon(model.native);
    }));
    $("cmCrit").querySelectorAll(".cm-dir").forEach((b) => b.addEventListener("click", () => {
      const c = scored[+b.dataset.idx];
      c.invert = !c.invert;
      c.field.direccion = c.invert ? "menor" : "mayor";
      saveCatSoon(model.native, true);
      renderCriteria();
      populateFilters();
      renderSections();
    }));
    $("cmCritSum").innerHTML = "Suma actual: <b>" + Math.round(scored.reduce((s, c) => s + c.weight, 0)) + "%</b>";
  }

  function populateFilters() {
    const m = model;
    const selB = $("cmBrand"), curB = selB.value;
    const brands = Array.from(new Set(m.rows.map((r) => r._marca || "Sin marca"))).sort();
    selB.innerHTML = '<option value="">Todas las marcas</option>' + brands.map((b) => '<option value="' + esc(b) + '">' + esc(b) + "</option>").join("");
    selB.value = brands.includes(curB) ? curB : "";
    const selS = $("cmSort"), curS = selS.value;
    const opts = [["score", "Mejor puntuación"], ...m.criteria.filter((c) => c.scored).map((c) => [c.key, "Priorizar: " + c.short])];
    selS.innerHTML = opts.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + "</option>").join("");
    selS.value = opts.some(([v]) => v === curS) ? curS : "score";
  }

  function filteredSorted(products) {
    const m = model;
    const q = $("cmQ").value.trim().toLowerCase(), brand = $("cmBrand").value, sort = $("cmSort").value;
    let rows = [...products];
    if (q) rows = rows.filter((p) => ((p._marca || "") + " " + (p._titulo || "")).toLowerCase().includes(q));
    if (brand) rows = rows.filter((p) => (p._marca || "Sin marca") === brand);
    if (sort === "score") rows.sort((a, b) => (b._score ?? -1) - (a._score ?? -1));
    else {
      const c = m.criteria.find((cc) => cc.key === sort);
      if (c) rows.sort((a, b) => {
        const va = c.extract(a), vb = c.extract(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return c.invert ? va - vb : vb - va;
      });
    }
    return rows;
  }

  let lastSecs = [];

  function renderSections() {
    const m = model;
    const host = $("cmSecs");
    if (!m.rows.length) {
      host.innerHTML = '<div class="pz-empty">Esta categoría aún no tiene productos. Agrega el primero con «+ Agregar producto» (puedes pegar el enlace para traer la foto, el nombre y la marca).</div>';
      lastSecs = [];
      renderValidation();
      return;
    }
    const secs = groupSections(m);
    lastSecs = secs;
    const scoreCrit = m.criteria.filter((c) => c.scored);
    host.innerHTML = secs.map((sec) => {
      computeScores(scoreCrit, sec.products);
      const ranked = [...sec.products].sort((a, b) => (b._score ?? -1) - (a._score ?? -1));
      const winner = ranked.find((p) => p._score !== null);
      const shown = filteredSorted(sec.products);
      const inner = !shown.length
        ? '<div class="pz-none">No hay productos que coincidan con el filtro en esta sección.</div>'
        : (state.view === "table" ? tableHtml(shown, ranked) : '<div class="cm-cards">' + shown.map((p) => cardHtml(p, ranked)).join("") + "</div>");
      return '<details class="cm-sec" data-sec="' + esc(sec.id) + '"' + (openSections.has(sec.id) ? " open" : "") + ">" +
        '<summary><span class="cm-secname">' + esc(sec.name) + '</span><span class="cm-secmeta"><span><b>' + sec.products.length + "</b> producto" + (sec.products.length === 1 ? "" : "s") + "</span>" +
        (winner ? '<span class="cm-win">Mejor: <b>' + esc(winner._marca || winner._titulo || "—") + "</b> (" + winner._score.toFixed(1) + ")</span>" : "<span>Sin puntuación calculable</span>") +
        '</span></summary><div class="cm-secbody">' + inner +
        '<div class="cm-sec-add"><button type="button" class="kb-btn" data-act="add" data-sec="' + esc(sec.id) + '">+ Agregar a «' + esc(sec.name) + "»</button></div></div></details>";
    }).join("");
    host.querySelectorAll(".cm-sec").forEach((d) => d.addEventListener("toggle", () => {
      if (d.open) openSections.add(d.dataset.sec); else openSections.delete(d.dataset.sec);
    }));
    renderValidation();
  }

  function fmtCrit(c, v) {
    if (v === null || v === undefined || v === "") return "—";
    if (!c.scored) return String(v);
    return (c.isCost ? "$" : "") + formatNumberSmart(v) + (c.unit || "");
  }

  function imageHtml(url, alt) {
    if (!url) return "";
    const cands = driveCandidates(url);
    return '<a class="cm-img" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" title="Ver imagen completa"><img src="' + esc(cands[0] || "") +
      '" data-cands="' + esc(JSON.stringify(cands)) + '" data-idx="0" alt="' + esc(alt) + '" loading="lazy" referrerpolicy="no-referrer" onerror="cmImgFallback(this)"></a>';
  }

  function cardHtml(p, ranked) {
    const m = model;
    const rank = ranked.indexOf(p) + 1;
    const hasScore = p._score !== null;
    const isWin = rank === 1 && hasScore;
    const quick = m.quick.map((q) => { const v = fmtField(m, q.f, p[q.f.id]); return { label: q.label, value: v === "" ? "—" : v }; });
    const details = m.details.map((f) => [f.nombre, fmtField(m, f, p[f.id])]).filter(([, v]) => v !== "" && v !== null && v !== undefined);
    const fs = fullSetOf(m, p);
    const enlace = p._p.enlace;
    return '<article class="cm-card' + (isWin ? " win" : "") + '" data-pid="' + p._p.id + '">' +
      '<div class="cm-row1"><div class="cm-bmark"><span class="cm-brand">' + esc(p._marca || "Sin marca") + "</span>" + esc(p._titulo || "Sin modelo") + "</div>" +
      '<div class="cm-row1-r">' + (isWin ? '<span class="cm-badge win">★ Mejor puntuación</span>' : (hasScore ? '<span class="cm-badge">#' + rank + "</span>" : '<span class="cm-badge nodata">No aplica</span>')) +
      '<div class="cm-score"><small>SCORE</small><b>' + (hasScore ? p._score.toFixed(1) : "—") + "</b></div></div></div>" +
      imageHtml(p._img, p._titulo) +
      (m.criteria.length ? '<div class="cm-stats">' +
        m.criteria.map((c) => '<div class="cm-stat' + (c.isCost ? " accent" : "") + '"><small>' + esc(c.short) + "</small><b>" + esc(fmtCrit(c, c.extract(p))) + "</b></div>").join("") + "</div>" : "") +
      (hasScore ? '<div class="cm-scorebar"><i style="width:' + p._score.toFixed(1) + '%"></i></div>' : "") +
      (p._missing && p._missing.length ? '<div class="cm-missing">No aplica — falta el dato de: ' + esc(p._missing.join(", ")) + ". Se recalcula al completar ese dato.</div>" : "") +
      (quick.length ? '<div class="cm-quick">' + quick.map((q) => "<div><small>" + esc(q.label) + "</small><b>" + esc(q.value) + "</b></div>").join("") + "</div>" : "") +
      (fs ? '<details class="cm-set"><summary><span>Precio total del full set</span><b>' + money(fs.total) + '</b></summary><div class="cm-setlist">' +
        fs.items.map((it) => "<div><span>" + esc(it.label) + "</span><b>" + money(it.value) + "</b></div>").join("") + "</div></details>" : "") +
      (details.length ? '<details class="cm-more"><summary>Ver más detalles</summary><div class="cm-specs">' +
        details.map(([k, v]) => "<span>" + esc(k) + "</span><b>" + esc(v) + "</b>").join("") + "</div></details>" : "") +
      '<div class="cm-cardfoot">' + (enlace ? '<a class="rp-link" href="' + esc(enlace) + '" target="_blank" rel="noopener noreferrer">Ver producto ↗</a>' : "") +
      '<span class="cp-spacer"></span><button type="button" class="eq-iconbtn" data-act="edit" title="Editar">✎</button>' +
      '<button type="button" class="eq-iconbtn" data-act="del" title="Eliminar">🗑</button></div></article>';
  }

  function tableHtml(rows, ranked) {
    const m = model;
    const c0 = m.criteria[0];
    return '<div class="pz-table-wrap"><table class="pz-table cm-table"><thead><tr><th>#</th><th>Marca</th><th>Modelo</th>' +
      (m.priceKey ? '<th class="num">Precio</th>' : "") + (c0 ? '<th class="num">' + esc(c0.short) + "</th>" : "") + '<th class="num">Score</th><th></th></tr></thead><tbody>' +
      rows.map((p) => {
        const rank = ranked.indexOf(p) + 1, isWin = rank === 1 && p._score !== null;
        return '<tr class="' + (isWin ? "win" : "") + '" data-pid="' + p._p.id + '"><td>' + (p._score !== null ? rank : "—") + "</td><td>" + esc(p._marca || "Sin marca") + "</td><td>" + esc(p._titulo || "Sin modelo") + "</td>" +
          (m.priceKey ? '<td class="num">' + money(p[m.priceKey]) + "</td>" : "") +
          (c0 ? '<td class="num">' + esc(fmtCrit(c0, c0.extract(p))) + "</td>" : "") +
          '<td class="num">' + (p._score !== null ? p._score.toFixed(1) : "—") + (isWin ? ' <span class="cm-pill">mejor</span>' : "") + "</td>" +
          '<td class="num"><button type="button" class="eq-iconbtn" data-act="edit" title="Editar">✎</button><button type="button" class="eq-iconbtn" data-act="del" title="Eliminar">🗑</button></td></tr>';
      }).join("") + "</tbody></table></div>";
  }

  function renderValidation() {
    const m = model;
    const all = lastSecs.flatMap((s) => s.products);
    const withMissing = all.filter((p) => p._missing && p._missing.length).length;
    $("cmVal").innerHTML = '<div class="pz-card-head"><h3>Validaciones y advertencias — ' + esc(m.name) + "</h3></div>" +
      '<ul class="cm-vallist"><li>Cada sección agrupa productos comparables entre sí. El ranking nunca mezcla secciones distintas.</li>' +
      "<li>" + lastSecs.length + " sección" + (lastSecs.length === 1 ? "" : "es") + " en " + esc(m.name) + ", cerradas por defecto.</li>" +
      (withMissing ? '<li class="warn">' + withMissing + " producto" + (withMissing === 1 ? "" : "s") + " no tiene" + (withMissing === 1 ? "" : "n") + " dato en algún criterio ponderado: no se calculó su score (marcado «No aplica»).</li>" : "") +
      "</ul>";
  }

  // acciones sobre productos y categoría (delegación)
  $("cmBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn || !model) return;
    const act = btn.dataset.act;
    if (act === "add") { openProductDialog(null, btn.dataset.sec || ""); return; }
    if (act === "cols") { openFieldsDialog(model.native); return; }
    const pid = btn.closest("[data-pid]") && btn.closest("[data-pid]").dataset.pid;
    const p = pid && prodById(pid);
    if (!p) return;
    if (act === "edit") openProductDialog(p);
    else if (act === "del") {
      if (!(await askConfirm("¿Eliminar «" + (p.titulo || "Sin título") + "» de la comparativa?", "Eliminar producto"))) return;
      try {
        await pStore.remove(p.id);
        state.prods = state.prods.filter((x) => x.id !== p.id);
        renderAll();
        setStatus("Producto eliminado", "ok");
      } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
    }
  });

  // -------------------------------------------------------------- categorías ----

  $("cmNewCat").addEventListener("click", async () => {
    const r = await askForm("Nueva categoría", [
      { key: "nombre", label: "Nombre", placeholder: "Ej. Escáneres 3D, Filamentos, Impresoras…", required: true },
    ], "Crear categoría");
    if (!r) return;
    const cat = {
      id: uid(), nombre: r.nombre, orden: Math.max(0, ...state.cats.map((c) => c.orden || 0)) + 1,
      campos: [{ id: newFieldId(), nombre: "Precio", rol: "criterio", unidad: "$", precio: true, direccion: "menor" }],
    };
    try {
      await cStore.save(cat);
      state.cats.push(cat);
      state.activeCat = cat.id;
      openSections.clear();
      renderAll();
      setStatus("Categoría creada: define ahora sus columnas", "ok");
      openFieldsDialog(cat);
    } catch (err) { setStatus("Error al crear la categoría: " + err.message, "err"); }
  });

  // ------------------------------------------- diálogo: columnas de la categoría ----

  let fdlg = null;
  let fdraft = null; // {cat, nombre, campos:[...]}

  function buildFieldsDialog() {
    fdlg = document.createElement("div");
    fdlg.className = "dlg-overlay";
    fdlg.hidden = true;
    fdlg.innerHTML =
      '<form class="dlg rp-dlg cm-fdlg" novalidate><h3 class="dlg-title">Configurar columnas</h3>' +
      '<label class="dlg-field"><span>Nombre de la categoría</span><input id="fdName" type="text" maxlength="60"></label>' +
      '<p class="pz-hint">Define con qué se compara cada producto. <b>Criterios</b> (hasta ' + MAX_CRIT + ') se ponderan y dan el score; <b>características</b> (hasta ' + MAX_QUICK +
      ') salen en la ficha rápida; <b>detalles</b> en «Ver más»; las <b>partes del full set</b> suman el precio total del conjunto.</p>' +
      '<div id="fdRows" class="cm-frows"></div>' +
      '<button type="button" class="kb-btn" id="fdAdd">+ Agregar campo</button>' +
      '<p class="dlg-err" id="fdErr" hidden></p>' +
      '<div class="dlg-actions cm-fdlg-actions"><button type="button" class="kb-btn kb-btn-danger" id="fdDelete">Eliminar categoría</button><span class="cp-spacer"></span>' +
      '<button type="button" class="kb-btn" id="fdCancel">Cancelar</button><button type="submit" class="kb-btn kb-btn-primary">Guardar columnas</button></div></form>';
    document.body.appendChild(fdlg);
    fdlg.querySelector("#fdName").addEventListener("input", (e) => { fdraft.nombre = e.target.value; });
    fdlg.querySelector("#fdAdd").addEventListener("click", () => {
      fdraft.campos.push({ id: newFieldId(), nombre: "", rol: "criterio", unidad: "", precio: false, direccion: "mayor" });
      renderFieldRows();
      const last = fdlg.querySelector("#fdRows .cm-frow:last-child input[data-k=nombre]");
      if (last) last.focus();
    });
    fdlg.querySelector("#fdCancel").addEventListener("click", closeFieldsDialog);
    fdlg.addEventListener("mousedown", (e) => { if (e.target === fdlg) closeFieldsDialog(); });
    fdlg.querySelector("#fdDelete").addEventListener("click", deleteCategory);
    fdlg.querySelector("form").addEventListener("submit", saveFields);
    fdlg.querySelector("#fdRows").addEventListener("input", (e) => {
      const row = e.target.closest(".cm-frow");
      const k = e.target.dataset && e.target.dataset.k;
      if (!row || !k) return;
      const f = fdraft.campos[+row.dataset.i];
      f[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    });
    fdlg.querySelector("#fdRows").addEventListener("change", (e) => {
      const row = e.target.closest(".cm-frow");
      if (row && e.target.dataset.k === "rol") {
        fdraft.campos[+row.dataset.i].rol = e.target.value; // por si el navegador no emitió "input"
        renderFieldRows();
      }
    });
    fdlg.querySelector("#fdRows").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-mv]");
      if (!btn) return;
      const i = +btn.closest(".cm-frow").dataset.i, j = btn.dataset.mv === "up" ? i - 1 : btn.dataset.mv === "down" ? i + 1 : null;
      if (j === null) fdraft.campos.splice(i, 1);
      else if (j >= 0 && j < fdraft.campos.length) { const t = fdraft.campos[i]; fdraft.campos[i] = fdraft.campos[j]; fdraft.campos[j] = t; }
      renderFieldRows();
    });
  }
  const fKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeFieldsDialog(); } };

  function renderFieldRows() {
    fdlg.querySelector("#fdRows").innerHTML = fdraft.campos.map((f, i) =>
      '<div class="cm-frow" data-i="' + i + '">' +
      '<input type="text" data-k="nombre" value="' + esc(f.nombre) + '" placeholder="Nombre del campo" maxlength="40" aria-label="Nombre">' +
      '<select data-k="rol" aria-label="Tipo">' + ROLES.map((r) => '<option value="' + r.v + '"' + (r.v === f.rol ? " selected" : "") + ">" + r.l + "</option>").join("") + "</select>" +
      (f.rol === "set" ? '<span class="cm-fhint">en $</span>' : '<input type="text" data-k="unidad" value="' + esc(f.unidad || "") + '" placeholder="Unidad (kg, mm, $…)" maxlength="12" aria-label="Unidad">') +
      (f.rol === "criterio" ? '<select data-k="direccion" aria-label="Qué es mejor"><option value="mayor"' + (f.direccion !== "menor" ? " selected" : "") + '>↑ Mayor = mejor</option><option value="menor"' + (f.direccion === "menor" ? " selected" : "") + ">↓ Menor = mejor</option></select>" : "") +
      (f.rol === "criterio" || f.rol === "caracteristica" ? '<label class="cm-fprice" title="Se muestra como precio ($)"><input type="checkbox" data-k="precio"' + (f.precio ? " checked" : "") + "> Es precio</label>" : "") +
      '<span class="cm-fbtns"><button type="button" class="eq-iconbtn" data-mv="up" title="Subir">↑</button><button type="button" class="eq-iconbtn" data-mv="down" title="Bajar">↓</button><button type="button" class="eq-iconbtn" data-mv="del" title="Quitar">×</button></span></div>').join("");
  }

  function openFieldsDialog(cat) {
    if (!fdlg) buildFieldsDialog();
    fdraft = { cat, nombre: cat.nombre, campos: (cat.campos || []).map((f) => Object.assign({}, f)) };
    fdlg.querySelector("#fdName").value = fdraft.nombre;
    fdlg.querySelector("#fdErr").hidden = true;
    renderFieldRows();
    fdlg.hidden = false;
    document.addEventListener("keydown", fKey, true);
  }
  function closeFieldsDialog() { fdlg.hidden = true; document.removeEventListener("keydown", fKey, true); }

  async function saveFields(e) {
    e.preventDefault();
    const err = fdlg.querySelector("#fdErr");
    const fail = (t) => { err.textContent = t; err.hidden = false; };
    const nombre = fdraft.nombre.trim();
    if (!nombre) return fail("Falta el nombre de la categoría.");
    const campos = fdraft.campos.map((f) => Object.assign({}, f, { nombre: String(f.nombre || "").trim() }));
    if (campos.some((f) => !f.nombre)) return fail("Todos los campos necesitan un nombre (o quítalos con ×).");
    if (campos.filter((f) => f.rol === "criterio").length > MAX_CRIT) return fail("Máximo " + MAX_CRIT + " criterios.");
    if (campos.filter((f) => f.rol === "caracteristica").length > MAX_QUICK) return fail("Máximo " + MAX_QUICK + " características (el resto pásalo a «Detalle»).");
    const cat = fdraft.cat;
    // si cambia la estructura de criterios, los pesos se reparten de nuevo
    const sig = (cs) => cs.filter((f) => f.rol === "criterio").map((f) => f.id + ":" + f.rol).join("|");
    const changed = sig(cat.campos || []) !== sig(campos);
    campos.forEach((f) => { if (f.rol !== "criterio") { delete f.direccion; delete f.peso; } if (f.rol === "set" || f.rol === "detalle") delete f.precio; if (changed) delete f.peso; });
    cat.nombre = nombre;
    cat.campos = campos;
    try {
      await cStore.save(cat);
      closeFieldsDialog();
      renderAll();
      setStatus("Columnas guardadas", "ok");
    } catch (ex) { fail("No se pudo guardar: " + ex.message); }
  }

  async function deleteCategory() {
    const cat = fdraft.cat;
    const n = state.prods.filter((p) => p.categoria === cat.id).length;
    if (!(await askConfirm("¿Eliminar la categoría «" + cat.nombre + "»" + (n ? " y sus " + n + " producto(s)" : "") + "? No se puede deshacer.", "Eliminar categoría"))) return;
    try {
      for (const p of state.prods.filter((x) => x.categoria === cat.id)) await pStore.remove(p.id);
      await cStore.remove(cat.id);
      state.prods = state.prods.filter((p) => p.categoria !== cat.id);
      state.cats = state.cats.filter((c) => c.id !== cat.id);
      closeFieldsDialog();
      renderAll();
      setStatus("Categoría eliminada", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  }

  // ------------------------------------------------ diálogo: producto + enlace ----

  let pdlg = null;
  let pd = null;
  let fetchToken = 0;
  const pKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeProductDialog(); } };

  function pmsg(text, kind) {
    const el = pdlg.querySelector("#pdMsg");
    el.textContent = text || "";
    el.dataset.kind = kind || "";
  }
  function pdShowPhoto() {
    const box = pdlg.querySelector("#pdBox");
    const src = imgOf(pd);
    box.innerHTML = src ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(src) + '">' : '<span class="rp-ph">🧩</span><small>Sin foto</small>';
    const img = box.querySelector("img");
    if (img) img.addEventListener("error", () => { box.innerHTML = '<span class="rp-ph">⚠️</span><small>No se pudo cargar esa imagen</small>'; });
    pdlg.querySelector("#pdClear").hidden = !src;
  }

  function buildProductDialog() {
    pdlg = document.createElement("div");
    pdlg.className = "dlg-overlay";
    pdlg.hidden = true;
    pdlg.innerHTML =
      '<form class="dlg rp-dlg cm-pdlg" novalidate><h3 class="dlg-title" id="pdTitle"></h3>' +
      '<label class="dlg-field"><span>Enlace del producto (opcional)</span><input id="pdUrl" type="url" placeholder="https://… (se intenta traer foto, nombre y marca)" autocomplete="off"></label>' +
      '<p class="rp-msg" id="pdMsg"></p>' +
      '<div class="cm-pgrid"><label class="dlg-field"><span>Marca</span><input id="pdMarca" type="text" maxlength="60" autocomplete="off"></label>' +
      '<label class="dlg-field"><span>Sección (agrupa productos comparables)</span><input id="pdSec" type="text" list="pdSecList" maxlength="60" autocomplete="off" placeholder="Ej. Gama media"><datalist id="pdSecList"></datalist></label></div>' +
      '<label class="dlg-field"><span>Título / modelo *</span><input id="pdTitulo" type="text" maxlength="140" autocomplete="off"></label>' +
      '<div class="rp-photo"><div class="rp-photo-box" id="pdBox"></div>' +
      '<div class="rp-photo-side"><span class="rp-photo-label">Foto</span><label class="kb-btn">Subir foto<input type="file" id="pdFile" accept="image/*" hidden></label>' +
      '<input id="pdImgUrl" type="url" placeholder="…o pega la dirección de una imagen" autocomplete="off"><button type="button" class="kb-btn" id="pdClear" hidden>Quitar foto</button></div></div>' +
      '<div id="pdFields"></div>' +
      '<p class="dlg-err" id="pdErr" hidden></p>' +
      '<div class="dlg-actions"><button type="button" class="kb-btn" id="pdCancel">Cancelar</button><button type="submit" class="kb-btn kb-btn-primary" id="pdSave">Guardar</button></div></form>';
    document.body.appendChild(pdlg);

    const url = pdlg.querySelector("#pdUrl");
    url.addEventListener("change", () => autoFill());
    url.addEventListener("paste", () => setTimeout(() => autoFill(), 50));
    pdlg.querySelector("#pdMarca").addEventListener("input", (e) => { pd.marca = e.target.value; });
    pdlg.querySelector("#pdSec").addEventListener("input", (e) => { pd.seccion = e.target.value; });
    pdlg.querySelector("#pdTitulo").addEventListener("input", (e) => { pd.titulo = e.target.value; });
    pdlg.querySelector("#pdFields").addEventListener("input", (e) => { const id = e.target.dataset && e.target.dataset.fid; if (id) pd.valores[id] = e.target.value; });
    pdlg.querySelector("#pdImgUrl").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      if (!v || isHttp(v)) { pd.imagen = v; pd.foto = null; pd.auto = false; pdShowPhoto(); }
    });
    pdlg.querySelector("#pdFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        pmsg("Subiendo foto…", "busy");
        pd.foto = await pStore.upload(await S.shrinkImage(file, 900, 0.82));
        pd.imagen = ""; pd.auto = false;
        pdlg.querySelector("#pdImgUrl").value = "";
        pdShowPhoto();
        pmsg("");
      } catch (err) { pmsg("No se pudo subir la foto: " + err.message, "err"); }
    });
    pdlg.querySelector("#pdClear").addEventListener("click", () => { pd.imagen = ""; pd.foto = null; pd.auto = false; pdlg.querySelector("#pdImgUrl").value = ""; pdShowPhoto(); });
    pdlg.querySelector("#pdCancel").addEventListener("click", closeProductDialog);
    pdlg.addEventListener("mousedown", (e) => { if (e.target === pdlg) closeProductDialog(); });
    pdlg.querySelector("form").addEventListener("submit", saveProduct);
  }

  // Quita sufijos de sitio ("… | Tienda", "… - Marca") y la marca repetida al inicio
  function cleanTitle(title, brand) {
    let t = String(title || "").trim();
    const seg = t.split(/\s[|–—-]\s/);
    if (seg.length > 1 && seg[0].length >= 4) t = seg[0].trim();
    if (brand && t.toLowerCase().startsWith(brand.toLowerCase() + " ") && t.length > brand.length + 3) t = t.slice(brand.length).trim();
    return t;
  }

  // Trae foto, nombre y marca del enlace (solo con Google conectado)
  async function autoFill() {
    const url = pdlg.querySelector("#pdUrl").value.trim();
    pd.enlace = url;
    if (!url) { pmsg(""); return; }
    if (!isHttps(url)) { pmsg("El enlace debe empezar por https://", "err"); return; }
    if (!pStore.remote || !API) {
      pmsg("Foto, nombre y marca automáticos se activan al conectar Google (Apps Script). Mientras tanto llénalos a mano.", "info");
      return;
    }
    const token = ++fetchToken;
    pmsg("Buscando foto, nombre y marca…", "busy");
    try {
      const j = await (await fetch(API + "?action=preview&url=" + encodeURIComponent(url))).json();
      if (token !== fetchToken) return;
      if (!j.ok) throw new Error(j.error || "No se pudo leer el enlace");
      const pv = j.preview || {};
      const got = [];
      if (pv.image && !pd.foto && (!pd.imagen || pd.auto)) { pd.imagen = pv.image; pd.auto = true; pdlg.querySelector("#pdImgUrl").value = ""; pdShowPhoto(); got.push("foto"); }
      let brand = (pv.brand || "").trim();
      let brandGuess = false;
      if (!brand && pv.title) { const w = cleanTitle(pv.title, "").split(/\s+/)[0]; if (w && /^[A-ZÁÉÍÓÚÑ0-9]/.test(w) && w.length > 1) { brand = w; brandGuess = true; } }
      if (brand && !pd.marca.trim()) { pd.marca = brand; pdlg.querySelector("#pdMarca").value = brand; got.push(brandGuess ? "marca (sugerida)" : "marca"); }
      if (pv.title && !pd.titulo.trim()) { pd.titulo = cleanTitle(pv.title, pd.marca).slice(0, 140); pdlg.querySelector("#pdTitulo").value = pd.titulo; got.push("nombre"); }
      pmsg(got.length ? "✓ Se completó: " + got.join(", ") + ". Revísalo antes de guardar." : "El enlace no trajo datos útiles: llénalos a mano.", got.length ? "ok" : "info");
    } catch (err) {
      if (token === fetchToken) pmsg(err.message + (/foto|imagen/i.test(err.message) ? "" : " Llena los datos a mano."), "err");
    }
  }

  function openProductDialog(existing, section) {
    if (!pdlg) buildProductDialog();
    const cat = model.native;
    pd = existing
      ? { id: existing.id, categoria: existing.categoria, seccion: existing.seccion || "", marca: existing.marca || "", titulo: existing.titulo || "", imagen: existing.imagen || "", foto: existing.foto || null, enlace: existing.enlace || "", valores: Object.assign({}, existing.valores || {}), auto: false, orden: existing.orden }
      : { id: null, categoria: cat.id, seccion: section && section !== "Sin sección" ? section : "", marca: "", titulo: "", imagen: "", foto: null, enlace: "", valores: {}, auto: false };
    pdlg.querySelector("#pdTitle").textContent = (existing ? "Editar producto" : "Agregar producto") + " — " + cat.nombre;
    pdlg.querySelector("#pdSave").textContent = existing ? "Guardar cambios" : "Agregar";
    pdlg.querySelector("#pdUrl").value = pd.enlace;
    pdlg.querySelector("#pdMarca").value = pd.marca;
    pdlg.querySelector("#pdSec").value = pd.seccion;
    pdlg.querySelector("#pdTitulo").value = pd.titulo;
    pdlg.querySelector("#pdImgUrl").value = pd.foto ? "" : pd.imagen;
    const secs = [...new Set(state.prods.filter((p) => p.categoria === cat.id).map((p) => (p.seccion || "").trim()).filter(Boolean))];
    pdlg.querySelector("#pdSecList").innerHTML = secs.map((s) => '<option value="' + esc(s) + '">').join("");
    // campos de la categoría, agrupados por tipo
    const groups = [
      ["criterio", "Criterios (se ponderan)"], ["caracteristica", "Características"], ["detalle", "Detalles"], ["set", "Partes del full set (precio en $)"],
    ];
    pdlg.querySelector("#pdFields").innerHTML = groups.map(([rol, title]) => {
      const fs = (cat.campos || []).filter((f) => f.rol === rol);
      if (!fs.length) return "";
      return '<fieldset class="cm-pfs"><legend>' + title + "</legend>" + fs.map((f) =>
        '<label class="dlg-field"><span>' + esc(f.nombre) + (f.unidad && rol !== "set" ? " (" + esc(f.unidad) + ")" : "") + "</span>" +
        '<input type="text" data-fid="' + f.id + '" value="' + esc(pd.valores[f.id] == null ? "" : pd.valores[f.id]) + '" autocomplete="off"' +
        (rol === "criterio" ? ' inputmode="decimal"' : "") + "></label>").join("") + "</fieldset>";
    }).join("");
    pdlg.querySelector("#pdErr").hidden = true;
    pmsg("");
    pdShowPhoto();
    pdlg.hidden = false;
    document.addEventListener("keydown", pKey, true);
    pdlg.querySelector(existing ? "#pdTitulo" : "#pdUrl").focus();
  }
  function closeProductDialog() { fetchToken++; pdlg.hidden = true; document.removeEventListener("keydown", pKey, true); }

  async function saveProduct(e) {
    e.preventDefault();
    const err = pdlg.querySelector("#pdErr");
    const titulo = pd.titulo.trim();
    const enlace = pdlg.querySelector("#pdUrl").value.trim();
    if (!titulo) { err.textContent = "Falta el título o modelo."; err.hidden = false; pdlg.querySelector("#pdTitulo").focus(); return; }
    if (enlace && !isHttp(enlace)) { err.textContent = "El enlace no es válido (debe empezar por https://)."; err.hidden = false; return; }
    err.hidden = true;
    const prev = pd.id ? prodById(pd.id) : null;
    const p = Object.assign({ id: uid(), orden: Math.max(0, ...state.prods.filter((x) => x.categoria === pd.categoria).map((x) => x.orden || 0)) + 1 }, prev || {}, {
      categoria: pd.categoria, seccion: pd.seccion.trim(), marca: pd.marca.trim(), titulo, enlace,
      imagen: pd.imagen || "", foto: pd.foto || null, valores: pd.valores,
    });
    try {
      await saveProd(p);
      const at = state.prods.findIndex((x) => x.id === p.id);
      if (at >= 0) state.prods[at] = p; else state.prods.push(p);
      closeProductDialog();
      renderAll();
      setStatus(store_label(), "ok");
    } catch (ex) { err.textContent = "No se pudo guardar: " + ex.message; err.hidden = false; }
  }
  const store_label = () => (pStore.remote ? "Guardado en la nube" : "Guardado (modo local)");

  // -------------------------------------------------- importar Excel / Sheets ----

  function showImport(show) { $("cmSource").hidden = !show; if (show) { $("cmErr").textContent = ""; selectSrcTab("excel"); } }
  $("cmImportBtn").addEventListener("click", () => showImport($("cmSource").hidden));
  $("cmImportClose").addEventListener("click", () => showImport(false));
  function selectSrcTab(t) {
    panel.querySelectorAll(".cm-srctab").forEach((b) => b.classList.toggle("active", b.dataset.src === t));
    $("cmSrcExcel").hidden = t !== "excel";
    $("cmSrcSheets").hidden = t !== "sheets";
  }
  panel.querySelectorAll(".cm-srctab").forEach((b) => b.addEventListener("click", () => { selectSrcTab(b.dataset.src); $("cmErr").textContent = ""; }));

  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = res;
      s.onerror = () => rej(new Error("No se pudo cargar el lector de Excel (¿sin conexión?)"));
      document.head.appendChild(s);
    });
  }
  const normKey = (name) => String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, "_");

  // Libro de Excel → [{name, headers, rows:[{c0,c1,…}]}]
  function workbookToSheets(wb) {
    const out = [];
    wb.SheetNames.forEach((name) => {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      if (!aoa.length) return;
      const headers = (aoa[0] || []).map((h) => (h === null || h === undefined) ? "" : String(h).trim());
      if (headers.every((h) => h === "")) return;
      const dataRows = aoa.slice(1).filter((row) => row.some((c) => c !== null && c !== undefined && c !== ""));
      if (!dataRows.length) return;
      out.push({ name, headers, rows: dataRows.map((row) => { const o = {}; headers.forEach((h, i) => { let v = row[i]; if (v === undefined) v = null; if (v instanceof Date) v = v.toISOString(); o["c" + i] = v; }); return o; }) });
    });
    return out;
  }

  // Hoja con la convención por posición (A Sección, B Marca, C Título, D Imagen, E:I criterios, J:O características…) → categoría + productos nativos
  function sheetToNative(sh) {
    const { headers, rows } = sh;
    const N = headers.length;
    const col = (i) => "c" + i;
    let rest = [];
    for (let i = 4; i < N; i++) rest.push(i);
    const setIdx = [];
    rest = rest.filter((i) => { const m = String(headers[i]).match(SET_RE); if (m) { setIdx.push([i, m[1].trim()]); return false; } return true; });
    const critIdx = rest.slice(0, MAX_CRIT);
    rest = rest.slice(MAX_CRIT);
    const quickIdx = rest.slice(0, MAX_QUICK);
    const detIdx = rest.slice(MAX_QUICK);

    const idOf = {};
    const campos = [];
    const add = (i, rol, extra) => {
      const id = newFieldId();
      idOf[i] = id;
      const h = headers[i];
      campos.push(Object.assign({ id, nombre: displayLabel(h) || "Campo " + (i + 1), rol, unidad: parseUnitFromHeader(h) || "" }, extra || {}));
    };
    critIdx.forEach((i) => { const price = looksLikePriceField(headers[i]); add(i, "criterio", { precio: price, direccion: price ? "menor" : "mayor" }); });
    quickIdx.forEach((i) => { const price = looksLikePriceField(headers[i]); add(i, "caracteristica", price ? { precio: true } : {}); });
    detIdx.forEach((i) => add(i, "detalle"));
    setIdx.forEach(([i, label]) => { const id = newFieldId(); idOf[i] = id; campos.push({ id, nombre: label, rol: "set" }); });

    const catId = uid();
    const prods = rows.map((r, k) => {
      const valores = {};
      Object.keys(idOf).forEach((i) => {
        let v = r[col(i)];
        if (v === null || v === undefined || v === "") return;
        const f = campos.find((x) => x.id === idOf[i]);
        if (f.rol === "set") { // "Mobile kit $110" → 110
          const n = num(v);
          if (n !== null) v = n; else { const m = String(v).trim().match(/([\d]+(?:[.,]\d+)?)\s*$/); v = m ? parseFloat(m[1].replace(",", ".")) : ""; }
          if (v === "") return;
        }
        valores[idOf[i]] = v;
      });
      return {
        id: uid(), categoria: catId, seccion: r.c0 == null ? "" : String(r.c0), marca: r.c1 == null ? "" : String(r.c1),
        titulo: r.c2 == null ? "" : String(r.c2), imagen: r.c3 == null ? "" : String(r.c3), foto: null, enlace: "", valores, orden: k + 1,
      };
    });
    return { cat: { id: catId, nombre: sh.name, campos, orden: 0 }, prods };
  }

  async function importSheets(sheets) {
    const natives = sheets.map(sheetToNative);
    const nCats = natives.length, nProds = natives.reduce((s, n) => s + n.prods.length, 0);
    if (!(await askConfirm("Se importarán " + nCats + " categoría(s) con " + nProds + " producto(s). Quedan guardados en la página y se pueden editar aquí. ¿Continuar?", "Importar"))) return;
    let order = Math.max(0, ...state.cats.map((c) => c.orden || 0));
    let done = 0;
    try {
      for (const n of natives) {
        if (state.cats.some((c) => norm(c.nombre) === norm(n.cat.nombre))) n.cat.nombre += " (importada)";
        n.cat.orden = ++order;
        setStatus("Importando «" + n.cat.nombre + "»… (" + (++done) + "/" + nCats + ")", "busy");
        await cStore.save(n.cat);
        state.cats.push(n.cat);
        for (const p of n.prods) { await saveProd(p); state.prods.push(p); }
      }
      state.activeCat = natives[0].cat.id;
      openSections.clear();
      showImport(false);
      renderAll();
      setStatus("Importación lista: " + nCats + " categoría(s), " + nProds + " producto(s)", "ok");
    } catch (err) {
      renderAll();
      setStatus("La importación se detuvo: " + err.message, "err");
    }
  }
  const norm = (s) => String(s || "").trim().toLowerCase();

  async function handleFile(file) {
    $("cmErr").textContent = "";
    if (!file) return;
    try {
      setStatus("Leyendo archivo…", "busy");
      await loadXLSX();
      const sheets = workbookToSheets(XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }));
      if (!sheets.length) throw new Error("El archivo no tiene ninguna hoja con encabezados y al menos una fila de datos.");
      await importSheets(sheets);
    } catch (err) {
      console.error(err);
      $("cmErr").textContent = "No se pudo leer el archivo: " + err.message;
      setStatus("", "");
    }
  }
  const drop = $("cmDrop"), fileInput = $("cmFile");
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); fileInput.value = ""; });

  async function connectSheets(raw) {
    const url = String(raw || "").trim();
    $("cmErr").textContent = "";
    if (!url) { $("cmErr").textContent = "Pega la URL /exec de tu Apps Script."; return; }
    if (!/^https:\/\/script\.google(?:usercontent)?\.com\/.*\/exec(\?.*)?$/.test(url)) { $("cmErr").textContent = "Esa URL no parece un despliegue de Apps Script (debe terminar en /exec)."; return; }
    $("cmConnect").textContent = "Leyendo…";
    setStatus("Leyendo Google Sheets…", "busy");
    try {
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=getAll", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "El Apps Script respondió con un error.");
      const keys = Object.keys(json.sheets || {});
      if (!keys.length) throw new Error("El Apps Script no devolvió ninguna hoja con datos.");
      try { localStorage.setItem(LS_URL, url); } catch (e) { /* sin almacenamiento */ }
      const sheets = keys.filter((k) => Array.isArray(json.data[k]) && json.data[k].length).map((k) => ({ name: json.sheets[k], headers: (json.headers && json.headers[k]) || [], rows: json.data[k] })).filter((s) => s.headers.length);
      if (!sheets.length) throw new Error("Las hojas no traen datos.");
      await importSheets(sheets);
    } catch (err) {
      console.error(err);
      $("cmErr").textContent = "No se pudo importar: " + (err instanceof SyntaxError ? "la respuesta no fue JSON válido (publica la implementación con acceso «Cualquier usuario»)" : err.message);
      setStatus("", "");
    } finally { $("cmConnect").textContent = "Importar"; }
  }
  $("cmConnect").addEventListener("click", () => connectSheets($("cmUrl").value));
  $("cmUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); connectSheets($("cmUrl").value); } });

  // ------------------------------------------------------------------ init ----

  async function load() {
    try {
      setStatus("Cargando…", "busy");
      const [cats, prods] = await Promise.all([cStore.list(), pStore.list()]);
      state.cats = cats.map((c) => Object.assign({ campos: [] }, c));
      state.prods = prods.map((p) => Object.assign({ valores: {} }, p));
      state.loaded = true;
      let saved = "";
      try { saved = localStorage.getItem(LS_URL) || ""; } catch (e) { /* sin almacenamiento */ }
      $("cmUrl").value = CONFIG_URL || saved;
      renderAll();
      setStatus(cStore.remote ? "Conectado a la nube" : "Modo local (sin Supabase configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  new MutationObserver(() => { if (panel.classList.contains("active") && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) load();
})();
