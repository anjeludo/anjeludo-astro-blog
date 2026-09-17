// Aplica el tema guardado antes del primer pintado, para que no haya un
// fogonazo del tema claro al recargar con el oscuro activo.
//
// Vive aqui y no inline en MetaHead.astro por la CSP: script-src 'self' no
// permite codigo dentro del HTML. Al invocarse con <script src> sin async ni
// defer sigue siendo sincrono y bloqueante, asi que corre igual de pronto.
const theme = localStorage.theme
if (theme === "light" || theme === "dark")
  document.documentElement.dataset.theme = theme
