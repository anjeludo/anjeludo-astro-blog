import type { APIRoute, GetStaticPaths } from "astro"
import { ecCss, ecCssHash } from "@/lib/expressive-code/assets"

export const getStaticPaths: GetStaticPaths = () => [
  { params: { hash: ecCssHash } },
]

export const GET: APIRoute = () =>
  new Response(ecCss, {
    headers: { "content-type": "text/css; charset=utf-8" },
  })
