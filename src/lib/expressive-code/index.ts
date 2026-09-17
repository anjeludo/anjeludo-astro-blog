import expressiveCode from "satteri-expressive-code"
import { ecRenderer } from "./config"
import { inlineExpressiveCode } from "./inline"

// PARCHE CSP sobre el tema.
//
// Tal como viene, el plugin inserta un <style> con baseStyles + themeStyles y
// un <script type="module"> por cada jsModule DENTRO del HTML de cada pagina
// que tenga bloques de codigo (satteri-expressive-code/dist/index.js:107-124;
// firstBlockClaimed es una variable del closure por documento, no global).
// script-src 'self' y style-src 'self' bloquean las dos cosas.
//
// customCreateRenderer es el punto de extension documentado del paquete para
// "processing the base styles and JS modules added to every page": se vacian
// aqui y se sirven como ficheros propios desde src/pages/ec/ (ver assets.ts).
export const blockExpressiveCode = expressiveCode({
  customCreateRenderer: async () => ({
    ...(await ecRenderer),
    baseStyles: "",
    themeStyles: "",
    jsModules: [],
  }),
})

export { inlineExpressiveCode }
