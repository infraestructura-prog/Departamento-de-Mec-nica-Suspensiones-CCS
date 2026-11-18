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

  return { enabled, list, save, remove, upload };
})();
