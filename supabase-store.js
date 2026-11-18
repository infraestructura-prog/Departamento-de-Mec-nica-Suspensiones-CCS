/* Cliente mínimo de Supabase (API REST con fetch, sin librerías).
 * Se activa si config.js define SUPABASE_URL y SUPABASE_ANON_KEY; si no, los módulos
 * siguen en modo local. Tabla `registros` y bucket `archivos`: ver supabase.sql. */
window.SB = (function () {
  "use strict";
  const URL_ = String(window.SUPABASE_URL || "").replace(/\/+$/, "");
  const KEY = window.SUPABASE_ANON_KEY || "";
  const enabled = !!(URL_ && KEY);
  const BUCKET = "archivos";
  const MAX_BYTES = 12 * 1024 * 1024;

  const headers = (extra) => Object.assign({ apikey: KEY, Authorization: "Bearer " + KEY }, extra || {});

  async function check(r) {
    if (r.ok) return r;
    let msg = "";
    try { const j = await r.json(); msg = j.message || j.error || ""; } catch (e) { /* sin cuerpo */ }
    throw new Error("Supabase " + r.status + (msg ? ": " + msg : ""));
  }

  async function list(kind) {
    const r = await check(await fetch(
      URL_ + "/rest/v1/registros?kind=eq." + encodeURIComponent(kind) + "&select=data&limit=5000",
      { headers: headers(), cache: "no-store" }));
    return (await r.json()).map((row) => row.data);
  }

  async function save(kind, obj) {
    if (!obj || !obj.id) throw new Error("Registro sin id");
    obj.actualizado = new Date().toISOString();
    await check(await fetch(URL_ + "/rest/v1/registros?on_conflict=kind,id", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ kind, id: String(obj.id), data: obj, actualizado: obj.actualizado }),
    }));
    return obj;
  }

  async function remove(kind, id) {
    await check(await fetch(
      URL_ + "/rest/v1/registros?kind=eq." + encodeURIComponent(kind) + "&id=eq." + encodeURIComponent(id),
      { method: "DELETE", headers: headers({ Prefer: "return=minimal" }) }));
  }

  function uid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "f" + Date.now() + Math.random().toString(36).slice(2, 8);
  }

  // Sube un archivo y devuelve { id, name, mime, url } (url pública, la que usan los módulos)
  async function upload(file) {
    if (file.size > MAX_BYTES) throw new Error("Máx. 12 MB por archivo");
    const id = uid();
    const safe = String(file.name || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
    const path = id + "/" + safe;
    await check(await fetch(URL_ + "/storage/v1/object/" + BUCKET + "/" + path, {
      method: "POST",
      headers: headers({ "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }),
      body: file,
    }));
    return {
      id, name: file.name, mime: file.type || "application/octet-stream", path,
      url: URL_ + "/storage/v1/object/public/" + BUCKET + "/" + path,
    };
  }

  // ---------------------------------------------- rescate de datos locales ----
  // Datos que se guardaron "solo en este navegador" (antes de conectar Supabase).
  const LOCAL_MAP = {
    cards: "kanbanIngenieria.v1", propuestas: "propuestasIngenieria.v1", compras: "comprasPresupuesto.v1",
    equipos: "equiposMant.v1", categoriasEquipos: "equiposCat.v1", comparativaCats: "cmCategorias.v1",
    comparativaProds: "cmProductos.v1", repo: "repoOpenSource.v1", diseno: "disenoFlujo.v1",
    disenadores: "disenoDisenadores.v1",
  };
  const FLAG = "sb.migrado.v1";

  function readLocal() {
    const data = {}; let count = 0;
    Object.keys(LOCAL_MAP).forEach((kind) => {
      try {
        const a = JSON.parse(localStorage.getItem(LOCAL_MAP[kind]) || "[]");
        if (Array.isArray(a) && a.length) { data[kind] = a; count += a.length; }
      } catch (e) { /* clave corrupta: se ignora */ }
    });
    return { data, count };
  }

  // Los archivos del modo local viven como data:URL dentro del JSON; se pasan al bucket.
  async function liftFiles(node) {
    if (Array.isArray(node)) return Promise.all(node.map(liftFiles));
    if (typeof node === "string") {
      if (node.indexOf("data:") === 0 && node.length > 2000) {
        const b = await (await fetch(node)).blob();
        return (await upload(new File([b], "imagen", { type: b.type }))).url;
      }
      return node;
    }
    if (node && typeof node === "object") {
      if (typeof node.url === "string" && node.url.indexOf("data:") === 0) {
        const b = await (await fetch(node.url)).blob();
        const up = await upload(new File([b], node.name || "archivo", { type: node.mime || b.type }));
        return Object.assign({}, node, up);
      }
      const o = {};
      for (const k of Object.keys(node)) o[k] = await liftFiles(node[k]);
      return o;
    }
    return node;
  }

  // Sube solo lo que aún no existe en la nube (no pisa cambios hechos desde otro dispositivo).
  async function migrateLocal(onProgress) {
    const { data } = readLocal();
    let subidos = 0, omitidos = 0;
    for (const kind of Object.keys(data)) {
      const enNube = new Set((await list(kind)).map((x) => String(x.id)));
      for (const item of data[kind]) {
        if (!item || !item.id || enNube.has(String(item.id))) { omitidos++; continue; }
        await save(kind, await liftFiles(item));
        subidos++;
        if (onProgress) onProgress(subidos);
      }
    }
    try { localStorage.setItem(FLAG, new Date().toISOString()); } catch (e) { /* sin almacenamiento */ }
    return { subidos, omitidos };
  }

  function showBanner() {
    let done = false;
    try { done = !!localStorage.getItem(FLAG) || !!sessionStorage.getItem("sb.banner.off"); } catch (e) { /* ignorar */ }
    if (!enabled || done) return;
    const { count } = readLocal();
    if (!count) return;
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#0b3d6b;color:#fff;" +
      "padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;" +
      "font:14px/1.4 system-ui,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.4)";
    const msg = document.createElement("span");
    msg.textContent = "Hay " + count + " registro(s) guardado(s) solo en este navegador (no los ven los otros dispositivos).";
    const go = document.createElement("button");
    go.textContent = "Subir a la nube";
    const no = document.createElement("button");
    no.textContent = "Ahora no";
    [go, no].forEach((b) => { b.style.cssText = "padding:6px 14px;border-radius:6px;border:0;cursor:pointer;font-weight:600"; });
    go.style.background = "#1BAF7A"; go.style.color = "#fff";
    bar.append(msg, go, no);
    document.body.appendChild(bar);
    no.onclick = () => { try { sessionStorage.setItem("sb.banner.off", "1"); } catch (e) { /* ignorar */ } bar.remove(); };
    go.onclick = async () => {
      go.disabled = no.disabled = true;
      msg.textContent = "Subiendo…";
      try {
        const r = await migrateLocal((n) => { msg.textContent = "Subiendo… " + n; });
        msg.textContent = "Listo: " + r.subidos + " subido(s)" + (r.omitidos ? ", " + r.omitidos + " ya estaban en la nube" : "") + ". Recargando…";
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        msg.textContent = "Error al subir: " + e.message + " (tus datos locales siguen intactos)";
        go.disabled = no.disabled = false;
      }
    };
  }
  if (enabled) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner);
    else showBanner();
  }

  return { enabled, list, save, remove, upload, migrateLocal, readLocal };
})();
