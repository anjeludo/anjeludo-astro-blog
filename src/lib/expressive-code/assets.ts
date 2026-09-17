import { createHash } from "node:crypto"
import { ecRenderer } from "./config"

// ecRenderer es una promesa creada al cargar el modulo; aqui se resuelve una
// sola vez para todo el build.
const { baseStyles, themeStyles, jsModules } = await ecRenderer

export const ecCss = baseStyles + themeStyles
export const ecJs = jsModules.join("\n")

const fingerprint = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 8)

export const ecCssHash = fingerprint(ecCss)
export const ecJsHash = fingerprint(ecJs)

// La huella va en la ruta para que la cache inmutable de nginx.conf sea
// correcta: al cambiar el contenido cambia la URL.
export const ecCssPath = `/ec/${ecCssHash}.css`
export const ecJsPath = `/ec/${ecJsHash}.js`
