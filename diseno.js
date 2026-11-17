/* Proyecto 3D · Flujo de diseño.
 * Kanban Requerimiento → Diseño → Prototipo → Fabricación → Calidad con responsable por tarjeta,
 * panel de capacidad por diseñador y, en Calidad, una evaluación ponderada de 4 características
 * editables por diseño. Datos vía IngShared.createStore (Google o este navegador). */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-diseno");
  if (!panel || !S) return;
  const { uid, esc } = S;
  const $ = (id) => document.getElementById(id);

  const store = S.createStore({
    localKey: "disenoFlujo.v1", listField: "diseno",
    saveAction: "saveDiseno", saveField: "diseno", deleteAction: "deleteDiseno",
  });
  const pStore = S.createStore({
    localKey: "disenoDisenadores.v1", listField: "disenadores",
    saveAction: "saveDisenador", saveField: "disenador", deleteAction: "deleteDisenador",
  });

  const COLUMNS = [
    { key: "REQUERIMIENTO", label: "Requerimiento", color: "#8D87B8" },
    { key: "DISENO", label: "Diseño", color: "#2A78D6" },
    { key: "PROTOTIPO", label: "Prototipo", color: "#EDA100" },
    { key: "FABRICACION", label: "Fabricación", color: "#1BAF7A" },
    { key: "CALIDAD", label: "Calidad", color: "#B06BE0" },
  ];
  const DEFAULT_CRIT = ["Resistencia", "Ajuste dimensional", "Acabado superficial", "Funcionalidad"];
  const TEAM = ["Cristian", "Diego", "Fabrizio"];
  const DEFAULT_CAP = 40; // horas por semana
  const DEFAULT_UMBRAL = 7;

  const state = { cards: [], people: [], openId: null, dragId: null, loaded: false, timers: {}, filter: "" };
  const byId = (id) => state.cards.find((c) => c.id === id);
  const current = () => byId(state.openId);

  // ------------------------------------------------------------- helpers ----

  const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
  const norm = (s) => String(s || "").trim().toLowerCase();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return d + "/" + m + "/" + y; };
  const slug = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fmt1 = (n) => n.toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function setStatus(msg, kind) {
    const el = $("dsStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }

  const newQuality = () => ({
    umbral: DEFAULT_UMBRAL,
    criterios: DEFAULT_CRIT.map((n) => ({ id: uid(), nombre: n, peso: 25, nota: "" })),
  });
  // Garantiza 4 criterios válidos (por si llega un registro incompleto)
  function ensureQuality(c) {
    if (!c.calidad || !Array.isArray(c.calidad.criterios) || c.calidad.criterios.length !== 4) c.calidad = newQuality();
    if (c.calidad.umbral === undefined || c.calidad.umbral === "") c.calidad.umbral = DEFAULT_UMBRAL;
    return c.calidad;
  }
  // Nota ponderada 0–10 (null si falta calificar alguna característica)
  function score(c) {
    const q = c.calidad;
    if (!q || !q.criterios) return null;
    if (q.criterios.some((k) => k.nota === "" || k.nota === null || k.nota === undefined)) return null;
    const wTotal = q.criterios.reduce((s, k) => s + (parseFloat(k.peso) || 0), 0) || 100;
    return q.criterios.reduce((s, k) => s + (parseFloat(k.peso) || 0) * (parseFloat(k.nota) || 0), 0) / wTotal;
  }
  const scoreClass = (c, sc) => sc === null ? "" : (sc >= (parseFloat(c.calidad.umbral) || DEFAULT_UMBRAL) ? "ok" : "bad");

  // Reparte el 100% entre los demás en proporción a su peso actual
  function rebalance(crit, changedIdx, raw) {
    const val = Math.max(0, Math.min(100, raw));
    const others = crit.map((_, i) => i).filter((i) => i !== changedIdx);
    const sum = others.reduce((s, i) => s + (parseFloat(crit[i].peso) || 0), 0);
    const rest = 100 - val;
    if (sum <= 0) others.forEach((i) => { crit[i].peso = rest / others.length; });
    else others.forEach((i) => { crit[i].peso = (parseFloat(crit[i].peso) || 0) / sum * rest; });
    crit[changedIdx].peso = val;
    const total = crit.reduce((s, k) => s + (parseFloat(k.peso) || 0), 0);
    crit[changedIdx].peso += 100 - total;
  }

  function queueSave(c, immediate) {
    setStatus("Guardando…", "busy");
    clearTimeout(state.timers[c.id]);
    const run = async () => {
      delete state.timers[c.id];
      c.actualizado = new Date().toISOString();
      try {
        await store.save(c);
        setStatus(store.remote ? "Guardado en Google" : "Guardado (modo local)", "ok");
      } catch (err) { setStatus("Error al guardar: " + err.message, "err"); }
    };
    if (immediate) run(); else state.timers[c.id] = setTimeout(run, 600);
  }

  // ---------------------------------------------------------- responsables ----

  function allNames() {
    const seen = new Map();
    const add = (n) => { const t = String(n || "").trim(); if (t && !seen.has(norm(t))) seen.set(norm(t), t); };
    state.people.forEach((p) => add(p.nombre));
    state.cards.forEach((c) => add(c.responsable));
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }
  const capOf = (name) => { const p = state.people.find((x) => norm(x.nombre) === norm(name)); return p && num(p.capacidad) ? num(p.capacidad) : DEFAULT_CAP; };

  async function setCapacity(name, cap) {
    let p = state.people.find((x) => norm(x.nombre) === norm(name));
    if (!p) { p = { id: "dis-" + slug(name), nombre: name, capacidad: cap, orden: state.people.length + 1 }; state.people.push(p); }
    p.capacidad = cap;
    p.actualizado = new Date().toISOString();
    try { await pStore.save(p); setStatus(pStore.remote ? "Guardado en Google" : "Guardado (modo local)", "ok"); }
    catch (err) { setStatus("Error al guardar capacidad: " + err.message, "err"); }
  }

  function statsFor(name) {
    const mine = state.cards.filter((c) => norm(c.responsable) === norm(name));
    const active = mine.filter((c) => !c.cerrado);
    const done = mine.filter((c) => c.cerrado);
    const hours = active.reduce((s, c) => s + num(c.horas), 0);
    const cap = capOf(name);
    const withDue = done.filter((c) => c.fin);
    const onTime = withDue.filter((c) => c.cerrado <= c.fin).length;
    const scores = done.map(score).filter((x) => x !== null);
    return {
      total: mine.length, active: active.length, hours, cap, load: hours / cap,
      done: done.length, onTimePct: withDue.length ? onTime / withDue.length : null,
      quality: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      overdue: active.filter((c) => c.fin && c.fin < today()).length,
    };
  }

  function renderCapacity() {
    const names = allNames();
    const body = $("dsCapBody");
    $("dsCapHint").textContent = names.length ? names.length + (names.length === 1 ? " persona" : " personas") : "";
    if (!names.length) { body.innerHTML = '<tr><td colspan="9" class="ds-none">Asigna un responsable a una tarjeta para ver su capacidad.</td></tr>'; return; }
    body.innerHTML = names.map((n) => {
      const s = statsFor(n);
      const lvl = s.load > 1 ? "bad" : s.load >= 0.8 ? "warn" : "ok";
      return "<tr><td><b>" + esc(n) + "</b></td>" +
        '<td class="num">' + s.active + "</td>" +
        '<td class="num">' + (s.hours ? fmt1(s.hours) : "0") + "</td>" +
        '<td class="num"><input type="number" min="1" step="1" class="ds-capinput" data-name="' + esc(n) + '" value="' + s.cap + '" aria-label="Capacidad semanal de ' + esc(n) + '"></td>' +
        '<td><div class="ds-load ' + lvl + '"><div class="ds-load-bar"><i style="width:' + Math.min(s.load * 100, 100) + '%"></i></div>' +
        "<span>" + Math.round(s.load * 100) + "% · ≈ " + fmt1(s.load) + " sem</span></div></td>" +
        '<td class="num">' + s.done + " / " + s.total + "</td>" +
        '<td class="num">' + (s.onTimePct === null ? "—" : Math.round(s.onTimePct * 100) + "%") + "</td>" +
        '<td class="num">' + (s.quality === null ? "—" : fmt1(s.quality) + " / 10") + "</td>" +
        '<td class="num' + (s.overdue ? " ds-bad" : "") + '">' + s.overdue + "</td></tr>";
    }).join("");
  }
  $("dsCapBody").addEventListener("change", (e) => {
    const inp = e.target.closest(".ds-capinput");
    if (!inp) return;
    const cap = Math.max(1, parseFloat(inp.value) || DEFAULT_CAP);
    setCapacity(inp.dataset.name, cap).then(renderCapacity);
  });

  function renderFilter() {
    const sel = $("dsFilter"), cur = state.filter;
    const names = allNames();
    sel.innerHTML = '<option value="">Todos los responsables</option>' +
      names.map((n) => '<option value="' + esc(norm(n)) + '">' + esc(n) + "</option>").join("") +
      '<option value="__none">Sin responsable</option>';
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : "";
    state.filter = sel.value;
    $("dsRespList").innerHTML = [...new Set([...TEAM, ...names])].map((n) => '<option value="' + esc(n) + '">').join("");
  }
  $("dsFilter").addEventListener("change", (e) => { state.filter = e.target.value; render(); });

  // -------------------------------------------------------------- tablero ----

  const visible = (c) => !state.filter || (state.filter === "__none" ? !String(c.responsable || "").trim() : norm(c.responsable) === state.filter);

  function render() {
    const board = $("dsBoard");
    board.innerHTML = "";
    COLUMNS.forEach((col) => {
      const cards = state.cards.filter((c) => c.estado === col.key && visible(c)).sort((a, b) => a.orden - b.orden);
      const el = document.createElement("div");
      el.className = "kb-col";
      el.dataset.col = col.key;
      el.innerHTML = '<div class="kb-col-head" style="--kb-accent:' + col.color + '"><span class="kb-col-title">' + col.label +
        '</span><span class="kb-count">' + cards.length + '</span></div><div class="kb-list"></div>';
      const list = el.querySelector(".kb-list");
      cards.forEach((c) => list.appendChild(cardEl(c)));
      if (!cards.length) list.innerHTML = '<div class="kb-empty">Arrastra una tarjeta aquí</div>';
      wireDrop(el, col.key);
      board.appendChild(el);
    });
    renderCapacity();
  }

  function cardEl(c) {
    const el = document.createElement("div");
    const overdue = !c.cerrado && c.fin && c.fin < today();
    el.className = "kb-card" + (c.id === state.openId ? " is-open" : "") + (c.cerrado ? " ds-done" : "");
    el.draggable = true;
    el.dataset.id = c.id;
    const sc = c.estado === "CALIDAD" ? score(c) : null;
    el.innerHTML =
      '<div class="kb-card-title">' + (c.cerrado ? "✓ " : "") + esc(c.titulo || "Sin título") + "</div>" +
      (c.descripcion ? '<div class="kb-card-desc">' + esc(c.descripcion) + "</div>" : "") +
      '<div class="kb-card-meta">' +
      '<span class="kb-chip' + (c.responsable ? "" : " ds-nobody") + '">👤 ' + esc(c.responsable || "Sin responsable") + "</span>" +
      (num(c.horas) ? '<span class="kb-chip">⏱ ' + num(c.horas) + " h</span>" : "") +
      (c.fin ? '<span class="kb-chip' + (overdue ? " ds-overdue" : "") + '">📅 ' + fmtDate(c.fin) + (overdue ? " · vencida" : "") + "</span>" : "") +
      (c.estado === "CALIDAD" ? '<span class="kb-chip ds-score-chip ' + scoreClass(c, sc) + '">★ ' + (sc === null ? "sin evaluar" : fmt1(sc) + " / 10") + "</span>" : "") +
      "</div>";
    el.addEventListener("click", () => openDrawer(c.id));
    el.addEventListener("dragstart", (e) => {
      state.dragId = c.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", c.id);
      setTimeout(() => el.classList.add("is-dragging"), 0);
    });
    el.addEventListener("dragend", () => {
      state.dragId = null;
      el.classList.remove("is-dragging");
      document.querySelectorAll("#dsBoard .kb-col.drag-over").forEach((x) => x.classList.remove("drag-over"));
    });
    return el;
  }

  function moveCard(card, key, orden) {
    if (card.estado !== key && card.cerrado) card.cerrado = ""; // sale de Calidad → se reabre
    card.estado = key;
    card.orden = orden;
    if (key === "CALIDAD") ensureQuality(card);
  }

  function wireDrop(colEl, key) {
    colEl.addEventListener("dragover", (e) => { if (!state.dragId) return; e.preventDefault(); colEl.classList.add("drag-over"); });
    colEl.addEventListener("dragleave", (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drag-over"); });
    colEl.addEventListener("drop", (e) => {
      e.preventDefault();
      colEl.classList.remove("drag-over");
      const card = byId(state.dragId);
      if (!card) return;
      const target = e.target.closest(".kb-card");
      const sibs = state.cards.filter((c) => c.estado === key && c.id !== card.id).sort((a, b) => a.orden - b.orden);
      let orden;
      if (target && target.dataset.id !== card.id) {
        const i = sibs.findIndex((c) => c.id === target.dataset.id);
        const prev = i > 0 ? sibs[i - 1].orden : sibs[i].orden - 2;
        orden = (prev + sibs[i].orden) / 2;
      } else orden = (sibs.length ? sibs[sibs.length - 1].orden : 0) + 1;
      moveCard(card, key, orden);
      queueSave(card, true);
      render();
      if (state.openId === card.id) fillDrawer(card);
    });
  }

  // -------------------------------------------------------------- drawer ----

  const drawer = $("dsDrawer");
  document.body.appendChild($("dsOverlay")); // fuera de <main> para quedar sobre el encabezado
  document.body.appendChild(drawer);
  const F = {
    titulo: $("dsTitulo"), estado: $("dsEstado"), responsable: $("dsResp"), horas: $("dsHoras"),
    inicio: $("dsInicio"), fin: $("dsFin"), descripcion: $("dsDescripcion"),
  };
  COLUMNS.forEach((col) => { const o = document.createElement("option"); o.value = col.key; o.textContent = col.label; F.estado.appendChild(o); });

  function openDrawer(id) {
    state.openId = id;
    fillDrawer(byId(id));
    drawer.classList.add("open");
    $("dsOverlay").classList.add("open");
    document.querySelectorAll("#dsBoard .kb-card").forEach((el) => el.classList.toggle("is-open", el.dataset.id === id));
  }
  function closeDrawer() {
    state.openId = null;
    drawer.classList.remove("open");
    $("dsOverlay").classList.remove("open");
    document.querySelectorAll("#dsBoard .kb-card.is-open").forEach((el) => el.classList.remove("is-open"));
  }

  function fillDrawer(c) {
    if (!c) return;
    Object.keys(F).forEach((k) => { F[k].value = c[k] === undefined || c[k] === null ? "" : c[k]; });
    const inQ = c.estado === "CALIDAD";
    $("dsQuality").hidden = !inQ;
    $("dsQHint").hidden = inQ;
    if (inQ) buildQuality(c);
  }

  Object.keys(F).forEach((k) => {
    F[k].addEventListener(k === "estado" ? "change" : "input", () => {
      const c = current();
      if (!c) return;
      if (k === "estado") {
        moveCard(c, F.estado.value, Math.max(0, ...state.cards.filter((x) => x.estado === F.estado.value && x.id !== c.id).map((x) => x.orden)) + 1);
        fillDrawer(c);
      } else {
        c[k] = k === "horas" ? (F[k].value === "" ? "" : parseFloat(F[k].value)) : F[k].value;
      }
      if (k === "responsable") renderFilter();
      render();
      queueSave(c, k === "estado");
    });
  });

  // ---------------------------------------------- evaluación de calidad ----
  // Se construye una vez y se actualiza en el sitio (así los sliders no se
  // recrean mientras se arrastran).

  function buildQuality(c) {
    const q = ensureQuality(c);
    $("dsCrit").innerHTML = q.criterios.map((k, i) =>
      '<div class="ds-crit" data-i="' + i + '">' +
      '<input type="text" class="ds-crit-name" data-k="nombre" maxlength="40" value="' + esc(k.nombre) + '" aria-label="Nombre de la característica ' + (i + 1) + '" placeholder="Característica ' + (i + 1) + '">' +
      '<div class="ds-w"><input type="range" min="0" max="100" step="1" data-k="peso" value="' + Math.round(k.peso) + '" aria-label="Peso de ' + esc(k.nombre) + '"><b class="ds-wval">' + Math.round(k.peso) + "%</b></div>" +
      '<label class="ds-note"><span>Nota (0–10)</span><input type="number" min="0" max="10" step="0.5" data-k="nota" value="' + esc(k.nota) + '" placeholder="—"></label>' +
      '<span class="ds-pts" data-pts></span></div>').join("");
    $("dsUmbral").value = q.umbral;
    updateQuality(c);
  }

  function updateQuality(c) {
    const q = ensureQuality(c);
    q.criterios.forEach((k, i) => {
      const row = $("dsCrit").children[i];
      if (!row) return;
      const slider = row.querySelector('[data-k="peso"]');
      if (document.activeElement !== slider) slider.value = Math.round(k.peso);
      row.querySelector(".ds-wval").textContent = Math.round(k.peso) + "%";
      const nota = parseFloat(k.nota);
      row.querySelector("[data-pts]").textContent = isFinite(nota) ? "+" + fmt1((parseFloat(k.peso) || 0) / 100 * nota) + " pts" : "";
    });
    const sc = score(c);
    const umbral = parseFloat(q.umbral) || DEFAULT_UMBRAL;
    const box = $("dsScore");
    if (sc === null) {
      box.className = "ds-score";
      box.innerHTML = '<span class="ds-score-hint">Califica las 4 características para ver la nota final.</span>';
    } else {
      const cls = sc >= umbral ? "ok" : "bad";
      box.className = "ds-score " + cls;
      box.innerHTML = '<div class="ds-score-num">' + fmt1(sc) + "<small> / 10</small></div>" +
        '<div class="ds-score-bar"><i style="width:' + (sc * 10) + '%"></i><em style="left:' + (umbral * 10) + '%"></em></div>' +
        '<div class="ds-score-verdict">' + (sc >= umbral ? "✓ Cumple (mínimo " + fmt1(umbral) + ")" : "✕ No alcanza el mínimo de " + fmt1(umbral)) + "</div>";
    }
    const btn = $("dsCloseBtn");
    btn.textContent = c.cerrado ? "↩ Reabrir (quitar «completado»)" : "✓ Marcar como completado";
    btn.classList.toggle("kb-btn-primary", !c.cerrado);
  }

  $("dsCrit").addEventListener("input", (e) => {
    const c = current();
    const row = e.target.closest(".ds-crit");
    const k = e.target.dataset && e.target.dataset.k;
    if (!c || !row || !k) return;
    const q = ensureQuality(c);
    const crit = q.criterios[+row.dataset.i];
    if (k === "peso") rebalance(q.criterios, +row.dataset.i, parseFloat(e.target.value) || 0);
    else if (k === "nota") crit.nota = e.target.value === "" ? "" : Math.max(0, Math.min(10, parseFloat(e.target.value)));
    else crit.nombre = e.target.value;
    updateQuality(c);
    render();
    queueSave(c);
  });
  $("dsUmbral").addEventListener("input", (e) => {
    const c = current();
    if (!c) return;
    ensureQuality(c).umbral = e.target.value === "" ? DEFAULT_UMBRAL : Math.max(0, Math.min(10, parseFloat(e.target.value)));
    updateQuality(c);
    render();
    queueSave(c);
  });

  $("dsCloseBtn").addEventListener("click", async () => {
    const c = current();
    if (!c) return;
    if (c.cerrado) {
      c.cerrado = "";
    } else {
      const sc = score(c);
      const umbral = parseFloat(ensureQuality(c).umbral) || DEFAULT_UMBRAL;
      if (sc === null && !(await askConfirm("Aún no están calificadas las 4 características. ¿Marcar el diseño como completado sin nota final?", "Marcar completado"))) return;
      if (sc !== null && sc < umbral && !(await askConfirm("La nota (" + fmt1(sc) + ") no alcanza el mínimo de " + fmt1(umbral) + ". ¿Marcar como completado de todos modos?", "Marcar completado"))) return;
      c.cerrado = today();
    }
    updateQuality(c);
    render();
    queueSave(c, true);
  });

  $("dsDelete").addEventListener("click", async () => {
    const c = current();
    if (!c) return;
    if (!(await askConfirm("¿Eliminar «" + (c.titulo || "Sin título") + "»? No se puede deshacer.", "Eliminar tarjeta"))) return;
    try {
      await store.remove(c.id);
      state.cards = state.cards.filter((x) => x.id !== c.id);
      closeDrawer();
      renderFilter();
      render();
      setStatus("Tarjeta eliminada", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  });

  $("dsClose").addEventListener("click", closeDrawer);
  $("dsOverlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.openId) closeDrawer(); });

  $("dsNew").addEventListener("click", () => {
    const c = {
      id: uid(), titulo: "Nuevo requerimiento", estado: "REQUERIMIENTO", descripcion: "",
      responsable: state.filter && state.filter !== "__none" ? (allNames().find((n) => norm(n) === state.filter) || "") : "",
      horas: "", inicio: "", fin: "", calidad: newQuality(), cerrado: "",
      orden: Math.max(0, ...state.cards.filter((x) => x.estado === "REQUERIMIENTO").map((x) => x.orden)) + 1,
      actualizado: new Date().toISOString(),
    };
    state.cards.push(c);
    renderFilter();
    render();
    queueSave(c, true);
    openDrawer(c.id);
    F.titulo.focus();
    F.titulo.select();
  });

  // ------------------------------------------------------------------ init ----

  async function load(silent) {
    try {
      if (!silent) setStatus("Cargando…", "busy");
      const [cards, people] = await Promise.all([store.list(), pStore.list()]);
      state.people = people;
      state.cards = cards.map((c) => { ensureQuality(c); if (!c.cerrado) c.cerrado = ""; return c; });
      state.loaded = true;
      renderFilter();
      render();
      if (state.openId && byId(state.openId) && !drawer.contains(document.activeElement)) fillDrawer(byId(state.openId));
      setStatus(store.remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  const visibleNow = () => panel.classList.contains("active");
  new MutationObserver(() => { if (visibleNow() && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  setInterval(() => {
    if (store.remote && visibleNow() && !state.dragId && !Object.keys(state.timers).length &&
        !drawer.contains(document.activeElement) && !panel.contains(document.activeElement)) load(true);
  }, 60000);
  if (visibleNow()) load();
})();
