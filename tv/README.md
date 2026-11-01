# Panel Draguz TV

Código del Panel que corre en la tele LG (app `com.paulo.tablerotv`).

- La app instalada en la tele baja `app.js` y `app.css` de esta carpeta (GitHub Pages) cada vez que abre.
- Cada 20 minutos revisa `version.json`. **Para mandar una actualización:** cambia lo que quieras y sube el número
  en `version.json` y en `VERSION` dentro de `app.js` (deben coincidir). La tele se recarga sola cuando nadie está usando el control.
- Si no hay internet, la tele usa la copia que viene dentro de la app.
- Vista previa en el navegador: abre `tv/index.html` (agrega `?demo` para datos de ejemplo, `?dia` o `?noche` para forzar el modo).

La app del cel está en `../cel/` (se instala desde Chrome: menú ⋮ → Instalar app / Agregar a pantalla principal).
