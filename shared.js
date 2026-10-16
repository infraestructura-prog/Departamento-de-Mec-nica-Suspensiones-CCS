/* Utilidades compartidas por los módulos de Compras (y reutilizables por otros).
 * createStore(): guarda en Google (Apps Script de config.js) o, si no hay URL, en este navegador. */
window.IngShared = (function () {
  "use strict";

  function uid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : "k" + Date.now() + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function readB64(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
  }
  // Reduce la imagen a ≤ max px (JPEG): carga rápido y cabe en la petición
  function shrinkImage(file, max, quality) {
    max = max || 1000; quality = quality || 0.82;
    return new Promise((res, rej) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => b ? res(new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })) : rej(new Error("No se pudo procesar la imagen")), "image/jpeg", quality);
      };
      img.onerror = () => rej(new Error("Imagen no válida"));
      img.src = url;
    });
  }
  function fileSrc(f, size) {
    if (!f) return "";
    return f.url || "https://drive.google.com/thumbnail?id=" + f.id + "&sz=w" + (size || 1000);
  }
  function download(filename, text, mime) {
    const blob = new Blob(["﻿" + text], { type: (mime || "text/csv") + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // o = { localKey, listField, saveAction, saveField, deleteAction }
  function createStore(o) {
    const API = window.INGENIERIA_API_URL || "";
    const remote = !!API;
    const localAll = () => JSON.parse(localStorage.getItem(o.localKey) || "[]");
    const localSet = (all) => {
      try { localStorage.setItem(o.localKey, JSON.stringify(all)); }
      catch (e) { throw new Error("Sin espacio en el navegador (modo local): usa fotos más pequeñas"); }
    };
    async function post(payload) {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Error del servidor");
      return j;
    }
    return {
      remote,
      async list() {
        if (!remote) return localAll();
        const j = await (await fetch(API)).json();
        if (!j.ok) throw new Error(j.error || "Error al leer");
        return j[o.listField] || [];
      },
      async save(x) {
        if (!remote) {
          const all = localAll();
          const i = all.findIndex((y) => y.id === x.id);
          if (i >= 0) all[i] = x; else all.push(x);
          localSet(all);
          return;
        }
        const payload = { action: o.saveAction }; payload[o.saveField] = x;
        await post(payload);
      },
      async remove(id) {
        if (!remote) { localSet(localAll().filter((y) => y.id !== id)); return; }
        await post({ action: o.deleteAction, id });
      },
      async upload(file) {
        if (file.size > 12 * 1024 * 1024) throw new Error("Máx. 12 MB por archivo");
        const b64 = await readB64(file);
        if (!remote) return { id: uid(), name: file.name, mime: file.type, url: "data:" + (file.type || "application/octet-stream") + ";base64," + b64 };
        return post({ action: "upload", name: file.name, mime: file.type, data: b64 }).then((j) => j.file);
      },
    };
  }

  return { uid, esc, readB64, shrinkImage, fileSrc, download, createStore };
})();
