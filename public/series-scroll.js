// Al entrar directamente en un subpost de una serie, salta al articulo
// correspondiente dentro del documento continuo. Solo en navegaciones nuevas
// y solo si la URL no trae ya un hash.
//
// Vive aqui y no inline en SeriesReader.astro por la CSP: script-src 'self'.
;(() => {
  const type = performance.getEntriesByType("navigation")[0]?.type
  if (type && type !== "navigate") return
  if (location.hash) return
  let pathname = location.pathname.replace(/\/+$/, "")
  try {
    pathname = decodeURIComponent(pathname)
  } catch {}
  document
    .querySelector(`article[data-embedded][data-url="${pathname}"]`)
    ?.scrollIntoView({ behavior: "instant" })
})()
