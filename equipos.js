/* Infraestructura y Mantenimiento · Equipos.
 * Inventario de equipos agrupados por categoría (con prefijo de código: EH, MV, MA, NE…),
 * con ficha por equipo (modelo, serial, descripción y manuales). Se pueden crear categorías
 * y equipos nuevos. Los equipos iniciales vienen de equipos-seed.js (informe de pasantía). */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-equipos");
  if (!panel || !S) return;
  const { uid, esc } = S;
  const $ = (id) => document.getElementById(id);

  const eqStore = S.createStore({
    localKey: "equiposMant.v1", listField: "equipos",
    saveAction: "saveEquipo", saveField: "equipo", deleteAction: "deleteEquipo",
  });
  const catStore = S.createStore({
    localKey: "equiposCat.v1", listField: "categoriasEquipos",
    saveAction: "saveCatEquipo", saveField: "categoria", deleteAction: "deleteCatEquipo",
  });

  const state = { cats: [], equipos: [], openId: null, loaded: false, closed: new Set(), timers: {} };
  const byId = (id) => state.equipos.find((e) => e.id === id);
  const catById = (id) => state.cats.find((c) => c.id === id);
  const current = () => byId(state.openId);

  // ------------------------------------------------------------- helpers ----

  function setStatus(msg, kind) {
    ["eqStatus", "eqStatus2"].forEach((id) => { const el = $(id); el.textContent = msg; el.dataset.kind = kind || ""; });
  }
  // Orden natural de códigos: EH2 < EH10
  function codeCmp(a, b) {
    const pa = /^([^\d]*)(\d+)?(.*)$/.exec(a || ""), pb = /^([^\d]*)(\d+)?(.*)$/.exec(b || "");
    if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
    const na = pa[2] === undefined ? -1 : parseInt(pa[2], 10), nb = pb[2] === undefined ? -1 : parseInt(pb[2], 10);
    return na !== nb ? na - nb : pa[3].localeCompare(pb[3]);
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function suggestCode(cat) {
    if (!cat || !cat.prefijo) return "";
    const re = new RegExp("^" + reEsc(cat.prefijo) + "(\\d+)$", "i");
    let max = 0, width = 2;
    state.equipos.forEach((e) => {
      const m = re.exec(e.codigo || "");
      if (m) { max = Math.max(max, parseInt(m[1], 10)); width = Math.max(width, m[1].length); }
    });
    return cat.prefijo.toUpperCase() + String(max + 1).padStart(width, "0");
  }
  const codeTaken = (code, exceptId) => state.equipos.some((e) => e.id !== exceptId && (e.codigo || "").toLowerCase() === code.toLowerCase());

  function queueSave(eq, immediate) {
    setStatus("Guardando…", "busy");
    clearTimeout(state.timers[eq.id]);
    const run = async () => {
      delete state.timers[eq.id];
      eq.actualizado = new Date().toISOString();
      try {
        await eqStore.save(eq);
        setStatus(eqStore.remote ? "Guardado en Google" : "Guardado (modo local)", "ok");
      } catch (err) { setStatus("Error al guardar: " + err.message, "err"); }
    };
    if (immediate) run(); else state.timers[eq.id] = setTimeout(run, 600);
  }
  async function saveCat(cat) {
    cat.actualizado = new Date().toISOString();
    await catStore.save(cat);
  }

  // --------------------------------------------------------------- lista ----

  function cardHtml(e) {
    const n = (e.manuales || []).length;
    return '<button type="button" class="eq-card" data-id="' + e.id + '">' +
      '<span class="eq-code">' + esc(e.codigo || "—") + "</span>" +
      '<b class="eq-name">' + esc(e.nombre || "Sin nombre") + "</b>" +
      '<span class="eq-meta"><i>Modelo</i> ' + (e.modelo ? esc(e.modelo) : '<em>no especificado</em>') + "</span>" +
      '<span class="eq-meta"><i>Serial</i> ' + (e.serial ? esc(e.serial) : '<em>sin asignar</em>') + "</span>" +
      '<span class="eq-doc' + (n ? " has" : "") + '">📄 ' + (n ? n + (n === 1 ? " manual" : " manuales") : "sin manual") + "</span></button>";
  }

  function fillCatFilter() {
    const sel = $("eqCatFilter"), cur = sel.value;
    sel.innerHTML = '<option value="">Todas las categorías</option>' +
      state.cats.map((c) => '<option value="' + c.id + '">' + esc(c.nombre) + (c.prefijo ? " (" + esc(c.prefijo) + ")" : "") + "</option>").join("");
    sel.value = state.cats.some((c) => c.id === cur) ? cur : "";
  }

  function renderList() {
    const q = $("eqQ").value.trim().toLowerCase();
    const catF = $("eqCatFilter").value;
    const host = $("eqGroups");
    const filtering = !!q || !!catF;
    const cats = [...state.cats].sort((a, b) => (a.orden || 0) - (b.orden || 0));
    let html = "";
    let shown = 0;
    cats.forEach((c) => {
      if (catF && c.id !== catF) return;
      let items = state.equipos.filter((e) => e.categoria === c.id);
      const total = items.length;
      if (q) items = items.filter((e) => [e.codigo, e.nombre, e.modelo, e.serial].join(" ").toLowerCase().includes(q));
      if (q && !items.length) return;
      items.sort((a, b) => codeCmp(a.codigo, b.codigo));
      shown += items.length;
      const open = filtering || !state.closed.has(c.id);
      html += '<details class="eq-cat" data-cat="' + c.id + '"' + (open ? " open" : "") + ">" +
        '<summary><span class="eq-cat-name">' + esc(c.nombre) + "</span>" +
        (c.prefijo ? '<span class="eq-prefix">' + esc(c.prefijo) + "</span>" : "") +
        '<span class="eq-count">' + total + (total === 1 ? " equipo" : " equipos") + "</span>" +
        '<span class="cp-spacer"></span>' +
        '<button type="button" class="eq-iconbtn" data-act="cat-edit" title="Editar categoría">✎</button>' +
        '<button type="button" class="eq-iconbtn" data-act="cat-del" title="Eliminar categoría">🗑</button></summary>' +
        '<div class="eq-grid">' + items.map(cardHtml).join("") +
        '<button type="button" class="cp-add-tile" data-act="eq-add"><b>+</b>Agregar a ' + esc(c.nombre) + "</button></div></details>";
    });
    if (!html) html = '<div class="pz-empty">' + (state.cats.length ? "Ningún equipo coincide con la búsqueda." : "Aún no hay categorías. Crea la primera con «+ Nueva categoría».") + "</div>";
    host.innerHTML = html;
    host.querySelectorAll(".eq-cat").forEach((d) => d.addEventListener("toggle", () => {
      if (filtering) return;
      if (d.open) state.closed.delete(d.dataset.cat); else state.closed.add(d.dataset.cat);
    }));
  }

  $("eqQ").addEventListener("input", renderList);
  $("eqCatFilter").addEventListener("change", renderList);

  $("eqGroups").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const catEl = btn.closest(".eq-cat");
    if (btn.classList.contains("eq-card")) { openDetail(btn.dataset.id); return; }
    if (btn.dataset.act === "eq-add") { newEquipo(catEl.dataset.cat); return; }
    if (btn.dataset.act === "cat-edit") { e.preventDefault(); e.stopPropagation(); editCat(catById(catEl.dataset.cat)); return; }
    if (btn.dataset.act === "cat-del") { e.preventDefault(); e.stopPropagation(); delCat(catById(catEl.dataset.cat)); }
  });

  // ----------------------------------------------------------- categorías ----

  $("eqNewCat").addEventListener("click", async () => {
    let err = "";
    let vals = { nombre: "", prefijo: "" };
    for (;;) {
      const r = await askForm("Nueva categoría" + (err ? " — " + err : ""), [
        { key: "nombre", label: "Nombre", value: vals.nombre, placeholder: "Ej. Herramientas de banco", required: true },
        { key: "prefijo", label: "Prefijo de código (2–4 letras)", value: vals.prefijo, placeholder: "Ej. HB", required: true },
      ], "Crear categoría");
      if (!r) return;
      vals = r;
      const pref = r.prefijo.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!pref) { err = "el prefijo no es válido"; continue; }
      if (state.cats.some((c) => (c.prefijo || "").toUpperCase() === pref)) { err = "ya existe una categoría con el prefijo " + pref; continue; }
      const cat = { id: uid(), nombre: r.nombre, prefijo: pref, orden: Math.max(0, ...state.cats.map((c) => c.orden || 0)) + 1 };
      try {
        await saveCat(cat);
        state.cats.push(cat);
        fillCatFilter();
        renderList();
        setStatus("Categoría creada", "ok");
      } catch (e) { setStatus("Error al crear la categoría: " + e.message, "err"); }
      return;
    }
  });

  async function editCat(cat) {
    if (!cat) return;
    const r = await askForm("Editar categoría", [
      { key: "nombre", label: "Nombre", value: cat.nombre, required: true },
      { key: "prefijo", label: "Prefijo de código", value: cat.prefijo || "", required: true },
    ], "Guardar");
    if (!r) return;
    const pref = r.prefijo.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!pref || state.cats.some((c) => c.id !== cat.id && (c.prefijo || "").toUpperCase() === pref)) { setStatus("Prefijo inválido o repetido", "err"); return; }
    cat.nombre = r.nombre;
    cat.prefijo = pref;
    try { await saveCat(cat); setStatus("Categoría actualizada", "ok"); } catch (e) { setStatus("Error: " + e.message, "err"); }
    fillCatFilter();
    renderList();
  }

  async function delCat(cat) {
    if (!cat) return;
    const n = state.equipos.filter((e) => e.categoria === cat.id).length;
    if (n) { setStatus("No se puede eliminar «" + cat.nombre + "»: tiene " + n + " equipo(s). Muévelos o elimínalos primero.", "err"); return; }
    if (!(await askConfirm("¿Eliminar la categoría «" + cat.nombre + "»? Está vacía.", "Eliminar categoría"))) return;
    try {
      await catStore.remove(cat.id);
      state.cats = state.cats.filter((c) => c.id !== cat.id);
      fillCatFilter();
      renderList();
      setStatus("Categoría eliminada", "ok");
    } catch (e) { setStatus("Error al eliminar: " + e.message, "err"); }
  }

  // -------------------------------------------------------------- equipos ----

  async function newEquipo(catId) {
    if (!state.cats.length) { setStatus("Primero crea una categoría", "err"); return; }
    catId = catId || $("eqCatFilter").value || state.cats[0].id;
    let err = "";
    let vals = { categoria: catId, nombre: "", codigo: suggestCode(catById(catId)), modelo: "", serial: "" };
    for (;;) {
      const r = await askForm("Nuevo equipo" + (err ? " — " + err : ""), [
        { key: "categoria", label: "Categoría", value: vals.categoria, options: [...state.cats].sort((a, b) => (a.orden || 0) - (b.orden || 0)).map((c) => ({ value: c.id, label: c.nombre + (c.prefijo ? " (" + c.prefijo + ")" : "") })) },
        { key: "nombre", label: "Nombre del equipo", value: vals.nombre, placeholder: "Ej. Elevador de dos torres 3", required: true },
        { key: "codigo", label: "Código", value: vals.codigo, placeholder: "Ej. EH06", required: true },
        { key: "modelo", label: "Modelo (opcional)", value: vals.modelo },
        { key: "serial", label: "Serial (opcional)", value: vals.serial },
      ], "Crear equipo");
      if (!r) return;
      // si cambió de categoría y dejó el código sugerido anterior, sugiere el de la nueva
      if (r.categoria !== vals.categoria && r.codigo === vals.codigo) r.codigo = suggestCode(catById(r.categoria));
      vals = r;
      if (codeTaken(r.codigo, null)) { err = "el código " + r.codigo + " ya existe"; continue; }
      const eq = {
        id: uid(), codigo: r.codigo.toUpperCase(), nombre: r.nombre, categoria: r.categoria, modelo: r.modelo, serial: r.serial,
        descripcion: "", manuales: [], orden: Date.now(), actualizado: new Date().toISOString(),
      };
      state.equipos.push(eq);
      queueSave(eq, true);
      state.closed.delete(eq.categoria);
      renderList();
      openDetail(eq.id);
      return;
    }
  }
  $("eqNew").addEventListener("click", () => newEquipo());

  // ---------------------------------------------------------------- ficha ----

  const F = { nombre: $("eqNombre"), codigo: $("eqCodigo"), categoria: $("eqCategoria"), modelo: $("eqModelo"), serial: $("eqSerial"), descripcion: $("eqDescripcion") };

  function openDetail(id) {
    const e = byId(id);
    if (!e) return;
    state.openId = id;
    $("eqList").hidden = true;
    $("eqDetail").hidden = false;
    F.categoria.innerHTML = [...state.cats].sort((a, b) => (a.orden || 0) - (b.orden || 0))
      .map((c) => '<option value="' + c.id + '">' + esc(c.nombre) + (c.prefijo ? " (" + esc(c.prefijo) + ")" : "") + "</option>").join("");
    F.nombre.value = e.nombre || "";
    F.codigo.value = e.codigo || "";
    F.categoria.value = e.categoria;
    F.modelo.value = e.modelo || "";
    F.serial.value = e.serial || "";
    F.descripcion.value = e.descripcion || "";
    $("eqBadge").textContent = e.codigo || "—";
    renderManuales();
    window.scrollTo(0, 0);
  }

  function closeDetail() {
    clearTimeout(state.timers[state.openId]);
    const e = current();
    if (e && state.timers[e.id] !== undefined) queueSave(e, true);
    state.openId = null;
    $("eqDetail").hidden = true;
    $("eqList").hidden = false;
    renderList();
  }
  $("eqBack").addEventListener("click", closeDetail);

  Object.keys(F).forEach((k) => {
    F[k].addEventListener(k === "categoria" ? "change" : "input", () => {
      const e = current();
      if (!e) return;
      e[k] = F[k].value;
      if (k === "codigo") {
        $("eqBadge").textContent = e.codigo || "—";
        const dup = e.codigo && codeTaken(e.codigo, e.id);
        setStatus(dup ? "Aviso: el código " + e.codigo + " ya lo usa otro equipo" : "", dup ? "err" : "");
      }
      queueSave(e, k === "categoria");
    });
  });

  // manuales
  async function openFile(f) {
    try {
      if (f.url) { // modo local: data URL → blob (el navegador bloquea abrir data: directo)
        const blob = await (await fetch(f.url)).blob();
        window.open(URL.createObjectURL(blob), "_blank");
      } else {
        window.open("https://drive.google.com/file/d/" + f.id + "/view", "_blank", "noopener");
      }
    } catch (err) { setStatus("No se pudo abrir el archivo: " + err.message, "err"); }
  }

  function renderManuales() {
    const e = current();
    const ul = $("eqManuales");
    ul.innerHTML = "";
    if (!e) return;
    if (!(e.manuales || []).length) { ul.innerHTML = '<li class="kb-none">Sin manuales cargados</li>'; return; }
    e.manuales.forEach((m) => {
      const li = document.createElement("li");
      li.innerHTML = '<a href="#" title="Abrir">📄 ' + esc(m.name) + '</a><button type="button" class="kb-x" title="Quitar">×</button>';
      li.querySelector("a").addEventListener("click", (ev) => { ev.preventDefault(); openFile(m); });
      li.querySelector("button").addEventListener("click", async () => {
        if (!(await askConfirm("¿Quitar «" + m.name + "» de este equipo?", "Quitar"))) return;
        e.manuales = e.manuales.filter((x) => x.id !== m.id);
        renderManuales();
        queueSave(e, true);
      });
      ul.appendChild(li);
    });
  }

  $("eqManualInput").addEventListener("change", async (ev) => {
    const e = current();
    const files = Array.from(ev.target.files);
    ev.target.value = "";
    if (!e || !files.length) return;
    try {
      for (const f of files) {
        setStatus("Subiendo " + f.name + "…", "busy");
        e.manuales = (e.manuales || []).concat([await eqStore.upload(f)]);
      }
      renderManuales();
      queueSave(e, true);
    } catch (err) { setStatus("Error con el manual: " + err.message, "err"); }
  });

  $("eqDelete").addEventListener("click", async () => {
    const e = current();
    if (!e) return;
    if (!(await askConfirm("¿Eliminar el equipo " + (e.codigo || "") + " «" + (e.nombre || "Sin nombre") + "»? Se borran su ficha y sus manuales. No se puede deshacer.", "Eliminar equipo"))) return;
    try {
      await eqStore.remove(e.id);
      state.equipos = state.equipos.filter((x) => x.id !== e.id);
      state.openId = null;
      $("eqDetail").hidden = true;
      $("eqList").hidden = false;
      renderList();
      setStatus("Equipo eliminado", "ok");
    } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
  });

  // ------------------------------------------------------------------ init ----

  // Primera vez (sin categorías ni equipos): carga los del informe. Ids fijos → nunca duplica.
  async function seedIfEmpty() {
    const seed = window.EQUIPOS_SEED;
    if (!seed || state.cats.length || state.equipos.length) return;
    const total = seed.categorias.length + seed.equipos.length;
    let n = 0;
    let order = 0;
    for (const c of seed.categorias) {
      setStatus("Cargando equipos iniciales (" + (++n) + "/" + total + ")…", "busy");
      const cat = { id: c.id, nombre: c.nombre, prefijo: c.prefijo, orden: ++order };
      await saveCat(cat);
      state.cats.push(cat);
    }
    order = 0;
    for (const s of seed.equipos) {
      setStatus("Cargando equipos iniciales (" + (++n) + "/" + total + ")…", "busy");
      const eq = {
        id: "eq-" + s.codigo, codigo: s.codigo, nombre: s.nombre, categoria: "cat-" + s.cat, modelo: s.modelo || "", serial: s.serial || "",
        descripcion: "Criticidad según el informe de pasantía (Tabla 4.2): " + s.crit + ".", manuales: [], orden: ++order,
        actualizado: new Date().toISOString(),
      };
      await eqStore.save(eq);
      state.equipos.push(eq);
    }
  }

  async function load() {
    try {
      setStatus("Cargando…", "busy");
      const [cats, equipos] = await Promise.all([catStore.list(), eqStore.list()]);
      state.cats = cats;
      state.equipos = equipos.map((e) => Object.assign({ manuales: [] }, e));
      await seedIfEmpty();
      state.loaded = true;
      fillCatFilter();
      renderList();
      setStatus(eqStore.remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  new MutationObserver(() => { if (panel.classList.contains("active") && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) load();
})();
