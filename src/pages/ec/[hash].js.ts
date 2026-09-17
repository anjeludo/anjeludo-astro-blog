import type { APIRoute, GetStaticPaths } from "astro"
import { ecJs, ecJsHash } from "@/lib/expressive-code/assets"

export const getStaticPaths: GetStaticPaths = () => [
  { params: { hash: ecJsHash } },
]

export const GET: APIRoute = () =>
  new Response(ecJs, {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  })
