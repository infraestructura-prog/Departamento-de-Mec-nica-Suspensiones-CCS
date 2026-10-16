/* Equipos iniciales de SuspensionesCCS.
 * Fuente: Informe de pasantía "Implementación de un sistema y metodología de gestión de
 * mantenimiento centrado en confiabilidad…" (F. Parra, USB, 2026):
 *   Tabla 4.1 Inventario técnico (código, nombre, modelo, serial) y
 *   Tabla 4.2 Matriz de criticidad (se deja como descripción inicial, editable).
 * Las categorías conservan los códigos del informe: EH, MV, MA, NE.
 * Los ids son fijos para que cargar el inicial varias veces nunca duplique nada.
 * Serial/modelo vacío = "Sin asignar" / "No especifica" en el informe. */
window.EQUIPOS_SEED = {
  categorias: [
    { id: "cat-EH", nombre: "Elevadores Hidráulicos", prefijo: "EH" },
    { id: "cat-MV", nombre: "Máquinas Vibratorias", prefijo: "MV" },
    { id: "cat-MA", nombre: "Máquina de Alineación", prefijo: "MA" },
    { id: "cat-NE", nombre: "Compresores / Neumático", prefijo: "NE" },
  ],
  equipos: [
    { codigo: "EH01", nombre: "Elevador de dos torres 1", cat: "EH", modelo: "OP LUXF45", serial: "", crit: "Muy alta (seguridad alta · operación alta · frecuencia alta)" },
    { codigo: "EH02", nombre: "Elevador de dos torres 2", cat: "EH", modelo: "OP LUXF45", serial: "", crit: "Muy alta (seguridad alta · operación alta · frecuencia alta)" },
    { codigo: "EH03", nombre: "Elevador de cuatro torres", cat: "EH", modelo: "", serial: "2023080521", crit: "Muy alta (seguridad alta · operación alta · frecuencia alta)" },
    { codigo: "EH04", nombre: "Elevador de tijeras 1", cat: "EH", modelo: "PLH45", serial: "QLS22052324", crit: "Alta (seguridad media · operación media · frecuencia alta)" },
    { codigo: "EH05", nombre: "Elevador de tijeras 2", cat: "EH", modelo: "PLH45", serial: "QLS22052325", crit: "Alta (seguridad media · operación media · frecuencia alta)" },
    { codigo: "MV01", nombre: "Máquina de simulación 1", cat: "MV", modelo: "DL-4.5YYJ", serial: "YYJ20250201009-1", crit: "Media (seguridad media · operación alta · frecuencia baja)" },
    { codigo: "MV02", nombre: "Máquina de simulación 2", cat: "MV", modelo: "DL-4.5YYJ", serial: "YYJ20250201009-2", crit: "Media (seguridad media · operación alta · frecuencia baja)" },
    { codigo: "MA01", nombre: "Máquina de alineación", cat: "MA", modelo: "V2100", serial: "", crit: "Media (seguridad baja · operación alta · frecuencia baja)" },
    { codigo: "NE01", nombre: "Compresor", cat: "NE", modelo: "Euro 5.5 HP", serial: "", crit: "Media (seguridad media · operación alta · frecuencia baja)" },
    { codigo: "NE02", nombre: "Balanceadora", cat: "NE", modelo: "", serial: "", crit: "Media (seguridad baja · operación alta · frecuencia media)" },
    { codigo: "NE03", nombre: "Desmontadora de cauchos", cat: "NE", modelo: "", serial: "", crit: "Media (seguridad baja · operación baja · frecuencia alta)" },
    { codigo: "NE04", nombre: "Generador de nitrógeno", cat: "NE", modelo: "", serial: "", crit: "Baja (seguridad baja · operación baja · frecuencia baja)" },
  ],
};
