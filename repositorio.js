/* Proyecto 3D · Repositorio open source.
 * Cuadrícula de piezas abiertas (foto, nombre, descripción breve y enlace al modelo).
 * Al pegar el enlace se intenta traer la foto/título/descripción que la página publica para
 * compartirse (Open Graph). Eso lo hace el Apps Script (el navegador no puede leer otras webs),
 * así que solo funciona con Google conectado y con sitios que lo permiten; si no, se sube la foto
 * o se pega la dirección de una imagen. */

(function () {
  "use strict";

  const S = window.IngShared;
  const panel = document.getElementById("panel-repo");
  if (!panel || !S) return;
  const { uid, esc } = S;
  const $ = (id) => document.getElementById(id);

  const store = S.createStore({
    localKey: "repoOpenSource.v1", listField: "repo",
    saveAction: "saveRepo", saveField: "repo", deleteAction: "deleteRepo",
  });
  const API = window.INGENIERIA_API_URL || "";

  const state = { items: [], loaded: false };

  // ------------------------------------------------------------- helpers ----

  function setStatus(msg, kind) {
    const el = $("rpStatus");
    el.textContent = msg;
    el.dataset.kind = kind || "";
  }
  const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || "").trim());
  const isHttps = (u) => /^https:\/\/[^\s/]+\.[^\s/]+/i.test(String(u || "").trim());

  const SOURCES = {
    "makerworld.com": "MakerWorld", "printables.com": "Printables", "thingiverse.com": "Thingiverse", "thangs.com": "Thangs",
    "cults3d.com": "Cults", "myminifactory.com": "MyMiniFactory", "github.com": "GitHub", "gitlab.com": "GitLab",
    "grabcad.com": "GrabCAD", "instructables.com": "Instructables", "cgtrader.com": "CGTrader", "yeggi.com": "Yeggi",
  };
  function sourceOf(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
      const k = Object.keys(SOURCES).find((d) => host === d || host.endsWith("." + d));
      return k ? SOURCES[k] : host;
    } catch (e) { return ""; }
  }
  const imgOf = (p) => (p.foto ? S.fileSrc(p.foto, 800) : (p.imagen || ""));

  function queueSave(p) {
    setStatus("Guardando…", "busy");
    p.actualizado = new Date().toISOString();
    return store.save(p).then(
      () => setStatus(store.remote ? "Guardado en Google" : "Guardado (modo local)", "ok"),
      (err) => { setStatus("Error al guardar: " + err.message, "err"); throw err; }
    );
  }

  // --------------------------------------------------------------- cuadrícula ----

  function cardHtml(p) {
    const img = imgOf(p);
    const src = sourceOf(p.enlace);
    const media = img
      ? '<img alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(img) + '" onerror="this.parentNode.classList.add(\'err\');this.remove()">'
      : "";
    const mediaWrap = (p.enlace
      ? '<a class="rp-img' + (img ? "" : " empty") + '" href="' + esc(p.enlace) + '" target="_blank" rel="noopener noreferrer" title="Abrir el modelo en ' + esc(src || "su página") + '">'
      : '<div class="rp-img' + (img ? "" : " empty") + '">') + media + '<span class="rp-ph" aria-hidden="true">🧩</span>' + (p.enlace ? "</a>" : "</div>");
    return '<article class="rp-card" data-id="' + p.id + '">' + mediaWrap +
      '<div class="rp-body"><h3>' + esc(p.titulo || "Sin título") + "</h3>" +
      (p.descripcion ? "<p>" + esc(p.descripcion) + "</p>" : '<p class="rp-nodesc">Sin descripción</p>') + "</div>" +
      '<div class="rp-foot">' +
      (src ? '<span class="rp-src">' + esc(src) + "</span>" : '<span class="rp-src none">Sin enlace</span>') +
      '<span class="cp-spacer"></span>' +
      (p.enlace ? '<a class="rp-link" href="' + esc(p.enlace) + '" target="_blank" rel="noopener noreferrer">Ver modelo ↗</a>' : "") +
      '<button type="button" class="eq-iconbtn" data-act="edit" title="Editar">✎</button>' +
      '<button type="button" class="eq-iconbtn" data-act="del" title="Eliminar">🗑</button></div></article>';
  }

  function render() {
    const q = $("rpQ").value.trim().toLowerCase();
    const items = [...state.items].sort((a, b) => (b.orden || 0) - (a.orden || 0))
      .filter((p) => !q || [p.titulo, p.descripcion, sourceOf(p.enlace)].join(" ").toLowerCase().includes(q));
    $("rpGrid").innerHTML = items.map(cardHtml).join("");
    $("rpEmpty").hidden = state.items.length > 0;
    if (state.items.length && !items.length) $("rpGrid").innerHTML = '<div class="pz-empty" style="grid-column:1/-1">Ninguna pieza coincide con la búsqueda.</div>';
  }
  $("rpQ").addEventListener("input", render);

  $("rpGrid").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const p = state.items.find((x) => x.id === btn.closest(".rp-card").dataset.id);
    if (!p) return;
    if (btn.dataset.act === "edit") openDialog(p);
    else if (btn.dataset.act === "del") {
      if (!(await askConfirm("¿Eliminar «" + (p.titulo || "Sin título") + "» del repositorio?", "Eliminar pieza"))) return;
      try {
        await store.remove(p.id);
        state.items = state.items.filter((x) => x.id !== p.id);
        render();
        setStatus("Pieza eliminada", "ok");
      } catch (err) { setStatus("Error al eliminar: " + err.message, "err"); }
    }
  });

  // -------------------------------------------------------- formulario (modal) ----

  let dlg = null;
  let draft = null;
  let fetchToken = 0;

  function buildDialog() {
    dlg = document.createElement("div");
    dlg.className = "dlg-overlay";
    dlg.hidden = true;
    dlg.innerHTML =
      '<form class="dlg rp-dlg" novalidate>' +
      '<h3 class="dlg-title" id="rpdTitle"></h3>' +
      '<label class="dlg-field"><span>Enlace del modelo (MakerWorld, Printables, Thingiverse, GitHub…)</span>' +
      '<input id="rpdUrl" type="url" placeholder="https://www.printables.com/model/…" autocomplete="off"></label>' +
      '<p class="rp-msg" id="rpdMsg"></p>' +
      '<label class="dlg-field"><span>Título *</span><input id="rpdTitulo" type="text" maxlength="120" autocomplete="off" placeholder="Nombre de la pieza"></label>' +
      '<label class="dlg-field"><span>Descripción breve</span><textarea id="rpdDesc" rows="3" maxlength="400" placeholder="Para qué sirve, licencia, observaciones…"></textarea></label>' +
      '<div class="rp-photo"><div class="rp-photo-box" id="rpdBox"></div>' +
      '<div class="rp-photo-side"><span class="rp-photo-label">Foto de la pieza</span>' +
      '<label class="kb-btn">Subir foto<input type="file" id="rpdFile" accept="image/*" hidden></label>' +
      '<input id="rpdImgUrl" type="url" placeholder="…o pega la dirección de una imagen" autocomplete="off">' +
      '<button type="button" class="kb-btn" id="rpdClear" hidden>Quitar foto</button></div></div>' +
      '<p class="dlg-err" id="rpdErr" hidden></p>' +
      '<div class="dlg-actions"><button type="button" class="kb-btn" id="rpdCancel">Cancelar</button>' +
      '<button type="submit" class="kb-btn kb-btn-primary" id="rpdSave">Guardar</button></div></form>';
    document.body.appendChild(dlg);

    const url = dlg.querySelector("#rpdUrl");
    url.addEventListener("change", () => autoFill());
    url.addEventListener("paste", () => setTimeout(() => autoFill(), 50));
    dlg.querySelector("#rpdTitulo").addEventListener("input", (e) => { draft.titulo = e.target.value; });
    dlg.querySelector("#rpdDesc").addEventListener("input", (e) => { draft.descripcion = e.target.value; });
    dlg.querySelector("#rpdImgUrl").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      if (isHttp(v) || !v) { draft.imagen = v; draft.foto = null; draft.auto = false; showPhoto(); }
    });
    dlg.querySelector("#rpdFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        msg("Subiendo foto…");
        draft.foto = await store.upload(await S.shrinkImage(file, 900, 0.82));
        draft.imagen = "";
        draft.auto = false;
        dlg.querySelector("#rpdImgUrl").value = "";
        showPhoto();
        msg("");
      } catch (err) { msg("No se pudo subir la foto: " + err.message, "err"); }
    });
    dlg.querySelector("#rpdClear").addEventListener("click", () => {
      draft.imagen = ""; draft.foto = null; draft.auto = false;
      dlg.querySelector("#rpdImgUrl").value = "";
      showPhoto();
    });
    dlg.querySelector("#rpdCancel").addEventListener("click", closeDialog);
    dlg.addEventListener("mousedown", (e) => { if (e.target === dlg) closeDialog(); });
    dlg.querySelector("form").addEventListener("submit", onSubmit);
  }

  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); closeDialog(); } };

  function msg(text, kind) {
    const el = dlg.querySelector("#rpdMsg");
    el.textContent = text || "";
    el.dataset.kind = kind || "";
  }

  function showPhoto() {
    const box = dlg.querySelector("#rpdBox");
    const src = imgOf(draft);
    box.innerHTML = src
      ? '<img alt="" referrerpolicy="no-referrer" src="' + esc(src) + '">'
      : '<span class="rp-ph">🧩</span><small>Sin foto</small>';
    const img = box.querySelector("img");
    if (img) img.addEventListener("error", () => { box.innerHTML = '<span class="rp-ph">⚠️</span><small>No se pudo cargar esa imagen</small>'; });
    dlg.querySelector("#rpdClear").hidden = !src;
  }

  // Intenta traer foto, título y descripción del enlace (solo con Google conectado)
  async function autoFill() {
    const url = dlg.querySelector("#rpdUrl").value.trim();
    draft.enlace = url;
    if (!url) { msg(""); return; }
    if (!isHttps(url)) { msg("El enlace debe empezar por https://", "err"); return; }
    if (!store.remote || !API) {
      msg("La foto automática se activa al conectar Google (Apps Script). Mientras tanto sube la foto o pega la dirección de una imagen.", "info");
      return;
    }
    const token = ++fetchToken;
    msg("Buscando la foto del enlace…", "busy");
    try {
      const r = await fetch(API + "?action=preview&url=" + encodeURIComponent(url));
      const j = await r.json();
      if (token !== fetchToken) return;
      if (!j.ok) throw new Error(j.error || "No se pudo leer el enlace");
      const pv = j.preview || {};
      const noManual = !draft.foto && (!draft.imagen || draft.auto);
      if (pv.image && noManual) {
        draft.imagen = pv.image;
        draft.auto = true;
        dlg.querySelector("#rpdImgUrl").value = "";
        showPhoto();
      }
      if (pv.title && !draft.titulo.trim()) { draft.titulo = pv.title.slice(0, 120); dlg.querySelector("#rpdTitulo").value = draft.titulo; }
      if (pv.description && !draft.descripcion.trim()) { draft.descripcion = pv.description.slice(0, 400); dlg.querySelector("#rpdDesc").value = draft.descripcion; }
      msg(pv.image ? "✓ Foto encontrada. Revisa el título y la descripción." : "No se encontró foto en ese enlace: sube una a mano o pega la dirección de una imagen.", pv.image ? "ok" : "info");
    } catch (err) {
      if (token === fetchToken) msg(err.message + (/foto|imagen/i.test(err.message) ? "" : " Puedes subir la foto o pegar la dirección de una imagen."), "err");
    }
  }

  function openDialog(existing) {
    if (!dlg) buildDialog();
    draft = existing
      ? { id: existing.id, titulo: existing.titulo || "", descripcion: existing.descripcion || "", enlace: existing.enlace || "", imagen: existing.imagen || "", foto: existing.foto || null, auto: false, orden: existing.orden }
      : { id: null, titulo: "", descripcion: "", enlace: "", imagen: "", foto: null, auto: false };
    dlg.querySelector("#rpdTitle").textContent = existing ? "Editar pieza" : "Agregar al repositorio";
    dlg.querySelector("#rpdSave").textContent = existing ? "Guardar cambios" : "Agregar";
    dlg.querySelector("#rpdUrl").value = draft.enlace;
    dlg.querySelector("#rpdTitulo").value = draft.titulo;
    dlg.querySelector("#rpdDesc").value = draft.descripcion;
    dlg.querySelector("#rpdImgUrl").value = draft.foto ? "" : draft.imagen;
    dlg.querySelector("#rpdErr").hidden = true;
    msg("");
    showPhoto();
    dlg.hidden = false;
    document.addEventListener("keydown", onKey, true);
    dlg.querySelector(existing ? "#rpdTitulo" : "#rpdUrl").focus();
  }

  function closeDialog() {
    fetchToken++;
    dlg.hidden = true;
    document.removeEventListener("keydown", onKey, true);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const err = dlg.querySelector("#rpdErr");
    const titulo = draft.titulo.trim();
    const enlace = dlg.querySelector("#rpdUrl").value.trim();
    if (!titulo) { err.textContent = "Falta el título."; err.hidden = false; dlg.querySelector("#rpdTitulo").focus(); return; }
    if (enlace && !isHttp(enlace)) { err.textContent = "El enlace no es válido (debe empezar por https://)."; err.hidden = false; return; }
    err.hidden = true;
    const item = Object.assign(
      { id: uid(), orden: Date.now() },
      draft.id ? state.items.find((x) => x.id === draft.id) : {},
      { titulo, descripcion: draft.descripcion.trim(), enlace, imagen: draft.imagen || "", foto: draft.foto || null }
    );
    try {
      await queueSave(item);
      const at = state.items.findIndex((x) => x.id === item.id);
      if (at >= 0) state.items[at] = item; else state.items.push(item);
      closeDialog();
      render();
    } catch (ex) { err.textContent = "No se pudo guardar: " + ex.message; err.hidden = false; }
  }

  $("rpNew").addEventListener("click", () => openDialog(null));

  // ------------------------------------------------------------------ init ----

  async function load() {
    try {
      setStatus("Cargando…", "busy");
      state.items = await store.list();
      state.loaded = true;
      render();
      setStatus(store.remote ? "Conectado a Google" : "Modo local (sin Apps Script configurado)", "ok");
    } catch (err) { setStatus("No se pudo cargar: " + err.message, "err"); }
  }

  new MutationObserver(() => { if (panel.classList.contains("active") && !state.loaded) load(); })
    .observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) load();
})();
