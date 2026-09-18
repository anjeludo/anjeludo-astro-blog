import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import { satteri } from "@astrojs/markdown-satteri"
import {
  blockExpressiveCode,
  inlineExpressiveCode,
} from "./src/lib/expressive-code"
import { temmlMath } from "./src/lib/math"
import { calloutDirective } from "./src/lib/callout"
import { externalLinks } from "./src/lib/external-links"
import { headingNamespace } from "./src/lib/heading-namespace"
import { headingAnchors } from "./src/lib/heading-anchors"

export default defineConfig({
  // El dominio nunca se escribe en un fichero versionado: en local esto es
  // localhost, y docker-compose.prod.yml inyecta SITE_URL desde .env.
  site: process.env.SITE_URL ?? "https://localhost",
  compressHTML: true,
  prefetch: { prefetchAll: true },
  // PARCHE CSP sobre el tema. Por defecto ('auto') Astro escribe en un <style>
  // las hojas de menos de ~4 kB, y erudite tiene 19 bloques <style> repartidos
  // por sus componentes. style-src 'self' los bloquearia y las paginas saldrian
  // sin estilos.
  build: {
    inlineStylesheets: "never",
  },
  // PARCHE CSP sobre el tema. Astro inlinea en un <script type="module"> los
  // scripts de componente que no tienen imports y caben bajo el umbral de
  // assets de Vite (build/plugins/plugin-scripts.js), para ahorrarse una
  // peticion. script-src 'self' los bloquea en silencio: el sintoma serian
  // el conmutador de tema, el boton de subir y otros scripts de componente
  // sin responder, sin que salte ningun error de compilacion. Con el umbral
  // a 0 no se inlinea ningun script de componente.
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !/\/authors\/[^/]+\/?$/.test(page) &&
        !page.includes("/tags/") &&
        !page.includes("/ec/"),
    }),
  ],
  markdown: {
    syntaxHighlight: false,
    processor: satteri({
      features: { directive: true, math: true },
      mdastPlugins: [calloutDirective, inlineExpressiveCode, temmlMath],
      hastPlugins: [
        externalLinks,
        blockExpressiveCode,
        headingNamespace,
        headingAnchors,
      ],
    }),
  },
})
