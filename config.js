// === Supabase (base de datos compartida entre dispositivos) ===
// Pega aqui la URL del proyecto y la clave "anon public" (Settings -> API).
// NUNCA pegues la clave "service_role". Si estan vacias, la pagina usa modo local.
window.SUPABASE_URL = "https://ehkgmolygglysiegkxpx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVoa2dtb2x5Z2dseXNpZWdreHB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NDY4NzMsImV4cCI6MjExMDQyMjg3M30.Qt9Pl8jdCIyHWLoBQyvW-w3offXDacwWYqWbPjnfvkM";
// URL de la app web de Apps Script (termina en /exec) para "Proyectos de Ingeniería"
// (Kanban + Presentación de proyectos). Vacía = modo local (solo este navegador).
// Ver apps-script/LEEME.md.
window.INGENIERIA_API_URL = "";

// URL /exec del Apps Script de SOLO LECTURA con las hojas de la Matriz Comparativa
// (Compras → Comparativa). Si se define, todo el equipo la ve sin pegar nada.
// Vacía = cada persona sube un Excel o pega la URL en su navegador.
window.COMPARATIVA_SHEETS_URL = "";
