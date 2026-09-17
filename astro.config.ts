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
  site: "https://astro-erudite.vercel.app",
  compressHTML: true,
  prefetch: { prefetchAll: true },
  // PARCHE CSP sobre el tema. Por defecto ('auto') Astro escribe en un <style>
  // las hojas de menos de ~4 kB, y erudite tiene 19 bloques <style> repartidos
  // por sus componentes. style-src 'self' los bloquearia y las paginas saldrian
  // sin estilos.
  build: {
    inlineStylesheets: "never",
  },
  integrations: [
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !/\/authors\/[^/]+\/?$/.test(page) &&
        !page.includes("/tags/"),
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
