/* Compras · Comparativa: matriz de ponderación y ranking por sección.
 * Port de la "Matriz Comparativa" (Fabrizio) al estilo del sitio.
 * Fuentes: Excel subido (solo en este navegador) o Google Sheets vía Apps Script de solo lectura.
 * Estructura de cada hoja (por POSICIÓN de columna):
 *   A Sección · B Marca · C Título · D Imagen · E:I hasta 5 criterios · J:O hasta 6 características
 *   · el resto "Ver más detalles" (aquí también las columnas "Set: <parte>" del full set). */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-comparativa");
  if (!panel || !S) return;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);

  const LS_URL = "comparativa.sheetsUrl";
  // Si se define en config.js, el equipo ve la matriz sin pegar nada
  const CONFIG_URL = (window.COMPARATIVA_SHEETS_URL || "").trim();

  let DATA = { __sheets: {}, __headers: {} };
  let cats = [];
  let activeCat = null;
  let viewMode = "cards";
  let source = null; // {type:'file', name} | {type:'sheets', url}
  let started = false;
  const openSections = new Set();

  // ------------------------------------------------------------- helpers ----

  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const parseLeadingNum = (v) => { if (v === null || v === undefined) return null; const m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
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
  const genericExtract = (campo) => (r) => { const n = num(r[campo]); return n !== null ? n : parseLeadingNum(r[campo]); };

  function isNumericColumn(rows, campo) {
    const sample = rows.slice(0, 10).map((r) => r[campo]).filter((v) => v !== null && v !== undefined && v !== "");
    if (!sample.length) return false;
    return sample.filter((v) => num(v) !== null || parseLeadingNum(v) !== null).length >= Math.ceil(sample.length * 0.6);
  }
  function formatGenericValue(header, v, numeric) {
    if (!numeric) return v;
    const u = parseUnitFromHeader(header);
    if (!u) return v;
    const n = num(v) ?? parseLeadingNum(v);
    return n !== null ? formatNumberSmart(n) + unitSuffix(u) : v;
  }

  // Link de Drive → varias URLs candidatas de imagen
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

  function setStatus(msg, kind) {
    const el = $("cmStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }

  // ------------------------------------------------------------ categorías ----

  function parseSetComponent(raw, fallbackLabel) {
    if (raw === null || raw === undefined || raw === "") return null;
    const direct = num(raw);
    if (direct !== null) return { label: fallbackLabel, value: direct };
    const m = String(raw).trim().match(/^(.*?)\s*\$?\s*([\d]+(?:[.,]\d+)?)\s*$/);
    if (!m) return null;
    const amount = parseFloat(m[2].replace(",", "."));
    if (!isFinite(amount)) return null;
    return { label: m[1].replace(/\$\s*$/, "").trim() || fallbackLabel, value: amount };
  }

  function buildCategory(id, name, rows, headers) {
    if (!headers.length) return null;
    const N = headers.length;
    const col = (i) => "c" + i;
    const sectionField = col(0), brandField = col(1), titleField = col(2);
    const imageField = N > 3 ? col(3) : null;
    let rest = [];
    for (let i = 4; i < N; i++) rest.push(i);

    const setFields = [];
    rest = rest.filter((i) => {
      const m = String(headers[i]).match(SET_RE);
      if (m) { setFields.push({ key: col(i), label: m[1].trim() }); return false; }
      return true;
    });
    const critIdx = rest.slice(0, 5);
    rest = rest.slice(5);
    const pPos = rest.findIndex((i) => looksLikePriceField(headers[i]));
    const priceIdx = pPos !== -1 ? rest.splice(pPos, 1)[0] : null;
    const priceField = priceIdx !== null ? col(priceIdx) : null;
    const quickIdx = rest.slice(0, 6);

    const criteria = critIdx.map((i) => {
      const campo = col(i);
      const header = headers[i];
      const scored = isNumericColumn(rows, campo);
      const isPrice = scored && looksLikePriceField(header);
      return {
        key: campo, short: displayLabel(header).toUpperCase(), invert: isPrice, weight: 0, isCost: isPrice,
        unit: isPrice ? "" : unitSuffix(parseUnitFromHeader(header)), scored,
        extract: scored ? genericExtract(campo) : ((r) => (r[campo] ?? null)),
      };
    });
    const scoredCount = criteria.filter((c) => c.scored).length || 1;
    criteria.forEach((c) => { if (c.scored) c.weight = 100 / scoredCount; });

    const quick = [];
    if (priceField) quick.push({ campo: priceField, label: "PRECIO", price: true });
    quickIdx.forEach((i) => quick.push({ campo: col(i), label: displayLabel(headers[i]).toUpperCase() }));

    const used = new Set([0, 1, 2, ...(imageField ? [3] : []), ...critIdx, ...quickIdx]);
    if (priceIdx !== null) used.add(priceIdx);
    setFields.forEach((f) => used.add(parseInt(f.key.slice(1), 10)));

    return {
      id, name, rows, headers, sectionField, brandField, titleField, imageField, priceField, criteria, quick,
      numericCols: headers.map((_, i) => isNumericColumn(rows, col(i))),
      detailSpecs: (r) => headers.map((h, i) => [i, h]).filter(([i]) => !used.has(i))
        .map(([i, h]) => [displayLabel(h), formatGenericValue(h, r[col(i)], isNumericColumn(rows, col(i)))]),
      fullSet: setFields.length ? (r) => {
        const items = setFields.map((f) => parseSetComponent(r[f.key], f.label)).filter(Boolean);
        return items.length ? { total: items.reduce((s, it) => s + it.value, 0), items } : null;
      } : null,
    };
  }

  function buildCats() {
    cats = Object.keys(DATA)
      .filter((k) => !k.startsWith("__") && Array.isArray(DATA[k]) && DATA[k].length > 0)
      .map((k) => buildCategory(k, (DATA.__sheets && DATA.__sheets[k]) || k, DATA[k], (DATA.__headers && DATA.__headers[k]) || []))
      .filter(Boolean);
  }
  const getCat = () => cats.find((c) => c.id === activeCat);

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

  function groupSections(cat) {
    const map = new Map();
    cat.rows.forEach((r) => {
      const v = r[cat.sectionField];
      const k = (v === null || v === undefined || v === "") ? "Sin sección" : String(v);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return Array.from(map.entries()).map(([id, products]) => ({ id, name: id, products }));
  }

  const brandOf = (cat, r) => (r[cat.brandField] || "Sin marca");
  const titleOf = (cat, r) => (r[cat.titleField] || "Sin modelo");

  // ---------------------------------------------------------------- render ----

  function renderCats() {
    const host = $("cmCats");
    host.innerHTML = "";
    cats.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pz-chip" + (c.id === activeCat ? " active" : "");
      b.innerHTML = esc(c.name) + ' <span class="cm-cnt">' + c.rows.length + "</span>";
      b.addEventListener("click", () => { activeCat = c.id; openSections.clear(); renderAll(); });
      host.appendChild(b);
    });
  }

  function renderBody() {
    const cat = getCat();
    const body = $("cmBody");
    if (!cat) { body.innerHTML = ""; return; }
    body.innerHTML =
      '<div class="pz-card"><div class="pz-card-head"><h3>Criterios y ponderación — ' + esc(cat.name) + '</h3>' +
      '<span class="pz-hint">Los pesos siempre suman 100%. Sube uno y los demás bajan proporcionalmente.</span></div>' +
      '<div class="cm-crit" id="cmCrit"></div><div class="cm-critsum" id="cmCritSum"></div>' +
      '<p class="pz-hint">Si un producto no tiene dato para un criterio, no se calcula su score (queda «No aplica») y se anota en su tarjeta.</p></div>' +
      '<div class="cm-toolbar">' +
      '<input type="text" id="cmQ" placeholder="Buscar por marca o modelo (dentro de cada sección)…">' +
      '<select id="cmBrand"></select><select id="cmSort"></select>' +
      '<div class="cm-viewtoggle"><button type="button" id="cmVCards" aria-pressed="' + (viewMode === "cards") + '">Tarjetas</button>' +
      '<button type="button" id="cmVTable" aria-pressed="' + (viewMode === "table") + '">Tabla</button></div></div>' +
      '<div id="cmSecs"></div>';
    renderCriteria();
    populateFilters();
    renderSections();
    $("cmQ").addEventListener("input", renderSections);
    $("cmBrand").addEventListener("change", renderSections);
    $("cmSort").addEventListener("change", renderSections);
    $("cmVCards").addEventListener("click", () => { viewMode = "cards"; renderBody(); });
    $("cmVTable").addEventListener("click", () => { viewMode = "table"; renderBody(); });
  }

  function renderCriteria() {
    const cat = getCat();
    const scored = cat.criteria.filter((c) => c.scored);
    if (!scored.length) {
      $("cmCrit").innerHTML = "";
      $("cmCritSum").textContent = "Ninguno de los criterios de esta categoría es numérico: no hay nada que ponderar (se muestran en cada tarjeta, sin score).";
      return;
    }
    $("cmCrit").innerHTML = scored.map((c, i) =>
      '<div class="cm-critrow"><div class="cm-critlabel"><span>' + esc(c.short) + '</span>' +
      '<button type="button" class="cm-dir" data-idx="' + i + '" title="Cambiar qué valor es mejor">' + (c.invert ? "↓ menor = mejor" : "↑ mayor = mejor") + '</button>' +
      '<b class="cm-critval">' + Math.round(c.weight) + "%</b></div>" +
      '<input type="range" min="0" max="100" value="' + Math.round(c.weight) + '" data-idx="' + i + '" aria-label="Peso de ' + esc(c.short) + '"></div>').join("");
    $("cmCrit").querySelectorAll('input[type="range"]').forEach((inp) => inp.addEventListener("input", (e) => {
      rebalance(scored, +e.target.dataset.idx, +e.target.value);
      renderCriteria();
      renderSections();
    }));
    $("cmCrit").querySelectorAll(".cm-dir").forEach((b) => b.addEventListener("click", () => {
      const c = scored[+b.dataset.idx];
      c.invert = !c.invert;
      renderCriteria();
      populateFilters();
      renderSections();
    }));
    $("cmCritSum").innerHTML = "Suma actual: <b>" + Math.round(scored.reduce((s, c) => s + c.weight, 0)) + "%</b>";
  }

  function populateFilters() {
    const cat = getCat();
    const selB = $("cmBrand"), curB = selB.value;
    const brands = Array.from(new Set(cat.rows.map((r) => brandOf(cat, r)))).sort();
    selB.innerHTML = '<option value="">Todas las marcas</option>' + brands.map((b) => '<option value="' + esc(b) + '">' + esc(b) + "</option>").join("");
    selB.value = brands.includes(curB) ? curB : "";
    const selS = $("cmSort"), curS = selS.value;
    const opts = [["score", "Mejor puntuación"], ...cat.criteria.filter((c) => c.scored).map((c) => [c.key, "Priorizar: " + c.short])];
    selS.innerHTML = opts.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + "</option>").join("");
    selS.value = opts.some(([v]) => v === curS) ? curS : "score";
  }

  function filteredSorted(products, cat) {
    const q = $("cmQ").value.trim().toLowerCase(), brand = $("cmBrand").value, sort = $("cmSort").value;
    let rows = [...products];
    if (q) rows = rows.filter((p) => (brandOf(cat, p) + " " + titleOf(cat, p)).toLowerCase().includes(q));
    if (brand) rows = rows.filter((p) => brandOf(cat, p) === brand);
    if (sort === "score") rows.sort((a, b) => (b._score ?? -1) - (a._score ?? -1));
    else {
      const c = cat.criteria.find((cc) => cc.key === sort);
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
    const cat = getCat();
    const host = $("cmSecs");
    const secs = groupSections(cat);
    lastSecs = secs;
    const scoreCrit = cat.criteria.filter((c) => c.scored);
    host.innerHTML = secs.map((sec) => {
      computeScores(scoreCrit, sec.products);
      const ranked = [...sec.products].sort((a, b) => (b._score ?? -1) - (a._score ?? -1));
      const winner = ranked.find((p) => p._score !== null);
      const shown = filteredSorted(sec.products, cat);
      const inner = !shown.length
        ? '<div class="pz-none">No hay productos que coincidan con el filtro en esta sección.</div>'
        : (viewMode === "table" ? tableHtml(shown, ranked, cat) : '<div class="cm-cards">' + shown.map((p) => cardHtml(p, ranked, cat)).join("") + "</div>");
      return '<details class="cm-sec" data-sec="' + esc(sec.id) + '"' + (openSections.has(sec.id) ? " open" : "") + ">" +
        '<summary><span class="cm-secname">' + esc(sec.name) + '</span><span class="cm-secmeta"><span><b>' + sec.products.length + "</b> producto" + (sec.products.length === 1 ? "" : "s") + "</span>" +
        (winner ? '<span class="cm-win">Mejor: <b>' + esc(brandOf(cat, winner)) + "</b> (" + winner._score.toFixed(1) + ")</span>" : "<span>Sin puntuación calculable</span>") +
        '</span></summary><div class="cm-secbody">' + inner + "</div></details>";
    }).join("");
    host.querySelectorAll(".cm-sec").forEach((d) => d.addEventListener("toggle", () => {
      if (d.open) openSections.add(d.dataset.sec); else openSections.delete(d.dataset.sec);
    }));
    renderValidation(cat);
  }

  function fmtCrit(c, v) {
    if (v === null || v === undefined || v === "") return "—";
    if (!c.scored) return String(v);
    return (c.isCost ? "$" : "") + formatNumberSmart(v) + (c.unit || "");
  }

  function imageHtml(url, alt) {
    if (!url) return "";
    const cands = driveCandidates(url);
    return '<a class="cm-img" href="' + esc(url) + '" target="_blank" rel="noopener" title="Ver imagen completa"><img src="' + esc(cands[0] || "") +
      '" data-cands="' + esc(JSON.stringify(cands)) + '" data-idx="0" alt="' + esc(alt) + '" loading="lazy" onerror="cmImgFallback(this)"></a>';
  }

  function cardHtml(p, ranked, cat) {
    const rank = ranked.indexOf(p) + 1;
    const hasScore = p._score !== null;
    const isWin = rank === 1 && hasScore;
    const quick = cat.quick.map((q) => {
      let v = q.price ? money(p[q.campo]) : formatGenericValue(cat.headers[parseInt(q.campo.slice(1), 10)], p[q.campo], cat.numericCols[parseInt(q.campo.slice(1), 10)]);
      if (v === null || v === undefined || v === "") v = "—";
      return { label: q.label, value: v };
    });
    const details = cat.detailSpecs(p).filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
    const fs = cat.fullSet ? cat.fullSet(p) : null;
    return '<article class="cm-card' + (isWin ? " win" : "") + '">' +
      '<div class="cm-row1"><div class="cm-bmark"><span class="cm-brand">' + esc(brandOf(cat, p)) + "</span>" + esc(titleOf(cat, p)) + "</div>" +
      '<div class="cm-row1-r">' + (isWin ? '<span class="cm-badge win">★ Mejor puntuación</span>' : (hasScore ? '<span class="cm-badge">#' + rank + "</span>" : '<span class="cm-badge nodata">No aplica</span>')) +
      '<div class="cm-score"><small>SCORE</small><b>' + (hasScore ? p._score.toFixed(1) : "—") + "</b></div></div></div>" +
      (cat.imageField ? imageHtml(p[cat.imageField], titleOf(cat, p)) : "") +
      '<div class="cm-stats">' +
      cat.criteria.map((c) => '<div class="cm-stat' + (c.isCost ? " accent" : "") + '"><small>' + esc(c.short) + "</small><b>" + esc(fmtCrit(c, c.extract(p))) + "</b></div>").join("") + "</div>" +
      (hasScore ? '<div class="cm-scorebar"><i style="width:' + p._score.toFixed(1) + '%"></i></div>' : "") +
      (p._missing && p._missing.length ? '<div class="cm-missing">No aplica — falta el dato de: ' + esc(p._missing.join(", ")) + ". Se recalcula si actualizas el archivo con ese dato.</div>" : "") +
      (quick.length ? '<div class="cm-quick">' + quick.map((q) => '<div><small>' + esc(q.label) + "</small><b>" + esc(q.value) + "</b></div>").join("") + "</div>" : "") +
      (fs ? '<details class="cm-set"><summary><span>Precio total del full set</span><b>' + money(fs.total) + '</b></summary><div class="cm-setlist">' +
        fs.items.map((it) => '<div><span>' + esc(it.label) + "</span><b>" + money(it.value) + "</b></div>").join("") + "</div></details>" : "") +
      (details.length ? '<details class="cm-more"><summary>Ver más detalles</summary><div class="cm-specs">' +
        details.map(([k, v]) => "<span>" + esc(k) + "</span><b>" + esc(v) + "</b>").join("") + "</div></details>" : "") +
      "</article>";
  }

  function tableHtml(rows, ranked, cat) {
    const c0 = cat.criteria[0];
    return '<div class="pz-table-wrap"><table class="pz-table cm-table"><thead><tr><th>#</th><th>Marca</th><th>Modelo</th>' +
      (cat.priceField ? '<th class="num">Precio</th>' : "") + (c0 ? "<th class=\"num\">" + esc(c0.short) + "</th>" : "") + '<th class="num">Score</th></tr></thead><tbody>' +
      rows.map((p) => {
        const rank = ranked.indexOf(p) + 1, isWin = rank === 1 && p._score !== null;
        return '<tr class="' + (isWin ? "win" : "") + '"><td>' + (p._score !== null ? rank : "—") + "</td><td>" + esc(brandOf(cat, p)) + "</td><td>" + esc(titleOf(cat, p)) + "</td>" +
          (cat.priceField ? '<td class="num">' + money(p[cat.priceField]) + "</td>" : "") +
          (c0 ? '<td class="num">' + esc(fmtCrit(c0, c0.extract(p))) + "</td>" : "") +
          '<td class="num">' + (p._score !== null ? p._score.toFixed(1) : "—") + (isWin ? ' <span class="cm-pill">mejor</span>' : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderValidation(cat) {
    const all = lastSecs.flatMap((s) => s.products);
    const withMissing = all.filter((p) => p._missing && p._missing.length).length;
    $("cmVal").innerHTML = '<div class="pz-card-head"><h3>Validaciones y advertencias — ' + esc(cat.name) + "</h3></div>" +
      '<ul class="cm-vallist"><li>Cada sección agrupa productos comparables entre sí. El ranking nunca mezcla secciones distintas.</li>' +
      "<li>" + lastSecs.length + " sección" + (lastSecs.length === 1 ? "" : "es") + " detectada" + (lastSecs.length === 1 ? "" : "s") + " en " + esc(cat.name) + ", en el orden del archivo y cerradas por defecto.</li>" +
      (withMissing ? '<li class="warn">' + withMissing + " producto" + (withMissing === 1 ? "" : "s") + " no tiene" + (withMissing === 1 ? "" : "n") + " dato en algún criterio ponderado: no se calculó su score (marcado «No aplica»).</li>" : "") +
      "<li>Precios y especificaciones vienen de la fuente de datos cargada; si algo cambió, actualiza la fuente.</li></ul>";
  }

  function renderAll() { renderCats(); renderBody(); }

  // --------------------------------------------------------- fuentes de datos ----

  function showSource() {
    $("cmSource").hidden = false;
    $("cmApp").hidden = true;
    $("cmRefresh").hidden = true;
    $("cmChange").hidden = true;
    selectSrcTab(source ? source.type === "sheets" ? "sheets" : "excel" : "excel");
  }
  function selectSrcTab(t) {
    panel.querySelectorAll(".cm-srctab").forEach((b) => b.classList.toggle("active", b.dataset.src === t));
    $("cmSrcExcel").hidden = t !== "excel";
    $("cmSrcSheets").hidden = t !== "sheets";
  }
  panel.querySelectorAll(".cm-srctab").forEach((b) => b.addEventListener("click", () => { selectSrcTab(b.dataset.src); $("cmErr").textContent = ""; }));

  function afterLoaded() {
    buildCats();
    if (!cats.length) throw new Error("No se encontró ninguna hoja con encabezados y al menos una fila de datos.");
    activeCat = cats[0].id;
    openSections.clear();
    $("cmSource").hidden = true;
    $("cmApp").hidden = false;
    $("cmChange").hidden = false;
    $("cmRefresh").hidden = source.type !== "sheets";
    $("cmSrcLabel").textContent = source.type === "sheets" ? "Conectado a Google Sheets: " : "Archivo cargado: ";
    $("cmSrcName").textContent = source.type === "sheets" ? source.url : source.name;
    $("cmSrcMeta").textContent = " · " + cats.length + (cats.length === 1 ? " categoría" : " categorías");
    setStatus(source.type === "sheets" ? "Datos al día" : "Archivo local (no se comparte)", "ok");
    renderAll();
  }

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

  function workbookToData(wb) {
    const data = { __sheets: {}, __headers: {} };
    let n = 0;
    wb.SheetNames.forEach((name) => {
      // header:1 → filas como arreglos: columnas con el mismo encabezado no se pisan (se identifican por posición)
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
      if (!aoa.length) return;
      const headerRow = (aoa[0] || []).map((h) => (h === null || h === undefined) ? "" : String(h).trim());
      if (headerRow.every((h) => h === "")) return;
      const dataRows = aoa.slice(1).filter((row) => row.some((c) => c !== null && c !== undefined && c !== ""));
      if (!dataRows.length) return;
      const key = normKey(name);
      data[key] = dataRows.map((row) => {
        const o = {};
        headerRow.forEach((h, i) => { let v = row[i]; if (v === undefined) v = null; if (v instanceof Date) v = v.toISOString(); o["c" + i] = v; });
        return o;
      });
      data.__sheets[key] = name;
      data.__headers[key] = headerRow;
      n++;
    });
    if (!n) throw new Error("El archivo no tiene ninguna hoja con datos (fila de encabezados + al menos una fila).");
    return data;
  }

  async function handleFile(file) {
    $("cmErr").textContent = "";
    if (!file) return;
    try {
      setStatus("Leyendo archivo…", "busy");
      await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      DATA = workbookToData(wb);
      source = { type: "file", name: file.name };
      afterLoaded();
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
    $("cmConnect").textContent = "Conectando…";
    setStatus("Conectando…", "busy");
    try {
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=getAll", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "El Apps Script respondió con un error.");
      if (!Object.keys(json.sheets || {}).length) throw new Error("El Apps Script no devolvió ninguna hoja con datos.");
      DATA = Object.assign({}, json.data || {}, { __sheets: json.sheets, __headers: json.headers || {} });
      source = { type: "sheets", url };
      try { localStorage.setItem(LS_URL, url); } catch (e) { /* sin almacenamiento */ }
      afterLoaded();
    } catch (err) {
      console.error(err);
      $("cmErr").textContent = "No se pudo conectar: " + (err instanceof SyntaxError ? "la respuesta no fue JSON válido (publica la implementación con acceso «Cualquier usuario»)" : err.message);
      setStatus("", "");
    } finally { $("cmConnect").textContent = "Conectar"; }
  }
  $("cmConnect").addEventListener("click", () => connectSheets($("cmUrl").value));
  $("cmUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); connectSheets($("cmUrl").value); } });
  $("cmRefresh").addEventListener("click", () => { if (source && source.type === "sheets") connectSheets(source.url); });
  $("cmChange").addEventListener("click", showSource);

  // ------------------------------------------------------------------ init ----

  function start() {
    started = true;
    let saved = "";
    try { saved = localStorage.getItem(LS_URL) || ""; } catch (e) { /* sin almacenamiento */ }
    $("cmUrl").value = CONFIG_URL || saved;
    showSource();
    if (CONFIG_URL) connectSheets(CONFIG_URL);
  }
  new MutationObserver(() => { if (panel.classList.contains("active") && !started) start(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) start();
})();
