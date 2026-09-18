# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this
repository.

Static blog: Astro + the astro-erudite template, built and served entirely in Docker. Nothing
(Node, Bun, Astro) is installed on the host. The default environment is **local**
(`https://localhost/`); production is a separate override.

User-facing docs are in `README.md` (Spanish) — this file covers what is not obvious from
reading any single file.

## Commands

```bash
# Content-only change (the common case) — rebuilds the site, ~13s (astro check dominates)
docker compose run --rm --no-deps build

# bun.lock, package.json or the template changed — full pipeline
docker compose up -d

# Production deploy (needs .env; see .env.example)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

**The plain `docker compose run --rm --no-deps build` above is only correct on the
production host because `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` is set in
its `.env`.** Without that variable, that exact command — run on production out of habit,
since it is *the* documented daily command — silently skips `docker-compose.prod.yml`:
`SITE_URL` is never injected, `astro.config.ts` falls back to `https://localhost`, and the
build writes straight into the live `site_public` volume nginx is serving. Every canonical
link, `rss.xml` and `sitemap-0.xml` then point at `https://localhost/`, with nothing visibly
wrong on the site itself. `.env.example` documents `COMPOSE_FILE`; make sure it made it into
the real `.env` on the production host, not just the template.

There is no test suite. Verify against the running site — Caddy serves it with a local CA,
so **curl needs `-k`**:

```bash
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/
curl -ksI https://localhost/ | grep -i content-security-policy
curl -ks -o /dev/null -w 'POST: %{http_code}\n' -X POST https://localhost/   # 405

# THE canonical check: zero inline <script>/<style> in the built site. MUST print nothing.
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

**`grep` inside `alpine` is busybox and has no `--include`.** Use
`find /d -name '*.html' -exec grep -l PATTERN {} +` instead. Six of this project's
verification commands had to be rewritten for this reason.

## Architecture: a five-stage pipeline

Stages 0-2 are chained with `depends_on: service_completed_successfully`, and `nginx` waits
for the build the same way. The key property is the **network/write asymmetry**, which explains
most of the odd-looking flags in `docker-compose.yml`:

| Stage | Network | Writes to | Why it exists |
|---|---|---|---|
| `init-perms` | none | all three volumes | Docker creates volumes as root; without the `chown`, bun (uid 1000) cannot write. |
| `deps` | **yes** | `node_modules` only | The only stage with internet. `bun install --frozen-lockfile`, seeing only `package.json` and `bun.lock`, both `:ro`. |
| `build` | **none** | `node_modules`, `.astro`, `dist` | Sources mounted `:ro`, one by one. `astro check && astro build`. |
| `nginx` / `caddy` | internal | — | Serve; hardened (unprivileged, read-only rootfs, `cap_drop: ALL`). |

Consequences that will bite you:

- **Sources are mounted one file/dir at a time, not `.:/src:ro`.** A writable volume nested
  under a read-only bind needs its mountpoint to already exist, and Docker cannot create one
  on a read-only filesystem — and in a fresh clone `node_modules/`, `.astro/` and `dist/` do
  not exist. With explicit mounts, `/src` is an ordinary container directory and Docker can
  create the mountpoints inside it. **Adding a config file at the project root therefore means
  adding its mount to the `build` service**, or the build will not see it.
- **`node_modules`, `.astro` and `dist` are writable overlays** on top of that read-only tree.
  They are named volumes (`node_modules`, `astro_cache`, `site_public`), not host paths.
- **Everything in the volumes is uid 1000.** If something outside this pipeline (a manual
  `docker run` as root, say) writes into `site_public`, that content is unreachable by the
  build user and by any wipe running as uid 1000 — Unix needs write access on the *containing*
  directory to unlink a file. The pipeline itself never creates such content, so this is a
  caveat, not a problem to solve. (Also: busybox `find -delete` exits `0` even when individual
  deletions fail, so such a wipe would hide the failure rather than report it.)
- **`nginx.conf` must not build absolute redirects.** `build.format: 'directory'` makes every
  page a directory (`/blog/index.html`), so a link without a trailing slash (or a manual
  `curl https://localhost/blog`) hits `try_files $uri $uri/` and gets a 301. By default nginx
  builds that `Location` from its own `$scheme` and `$server_port` — `http` and `8080`, the
  internal values behind Caddy, not what the browser is using. Symptom: the browser gets sent
  to `http://localhost:8080/...` and cannot connect. Fixed with `absolute_redirect off;` in the
  `server` block, which makes nginx emit a relative `Location: /blog/` instead. The sibling
  Hugo project's `nginx.conf` was copied from before this fix and still has the same defect.

## The theme is a template, not a theme

astro-erudite v2.0.1, commit `1ffdf62`, MIT (© 2026 enscribe), **vendored**: its `.git` was
removed and its files are tracked here. There is no `themes/` directory, because there is no
theme — the repo *is* the project, and **there is no override layer protecting local changes**
the way `layouts/partials/` protects them in the sibling Hugo project.

Updating means `git fetch upstream` and diffing by hand:

```bash
git fetch upstream
git log --oneline upstream/main -5
git diff upstream/main -- src astro.config.ts public
```

At the time of writing, `upstream/main` is exactly the vendored commit, so that diff shows
only this repo's own divergence: the CSP patches, the identity changes and the content.

## The CSP patches, and what to reapply after every upstream merge

`Caddyfile` (and `Caddyfile.prod`, byte-identical in its CSP line) sets:

```
default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none';
base-uri 'none'; form-action 'self'
```

Everything below exists only to satisfy it. All of it is marked in the source with the comment
`PARCHE CSP` (`grep -rn 'PARCHE CSP' astro.config.ts src/`).

| Where | What | Why |
|---|---|---|
| `astro.config.ts` | `build.inlineStylesheets: 'never'` | Astro's default (`'auto'`) writes stylesheets under ~4kB into a `<style>` block; erudite has 19 of them across its components. `style-src 'self'` would block them and the pages would render unstyled. |
| `astro.config.ts` | `vite.build.assetsInlineLimit: 0` | Forces every component `<script>` to be emitted as an external file. See below — this one is load-bearing and easy to mistake for a performance knob. |
| `src/components/MetaHead.astro` | `<script is:inline>` → `<script src="/theme-init.js" is:inline>` | The dark-mode anti-flash script. Must run before first paint, so no `async`/`defer`. Source: `public/theme-init.js`. |
| `src/components/SeriesReader.astro` | `<script is:inline>` → `<script src="/series-scroll.js" is:inline>` | Jumps to the right subpost when a series URL is opened directly. Source: `public/series-scroll.js`. The file's *second* `<script>` (the one that imports from `@/lib/utils`) is untouched — it has an import, so Astro bundles it anyway. |
| `src/lib/expressive-code/index.ts` | `customCreateRenderer` blanks `baseStyles`, `themeStyles` and `jsModules` | Out of the box the plugin injects a `<style>` with the base + theme CSS and a `<script type="module">` per JS module into the HTML of **every page that has code blocks**. Both are blocked. |
| `src/lib/expressive-code/assets.ts` + `src/pages/ec/[hash].css.ts` / `[hash].js.ts` | Serve that CSS and JS as `/ec/<hash>.css` and `/ec/<hash>.js` | The other half of the previous row: what was blanked has to be served from somewhere. Content-hashed, so `Cache-Control: immutable` is safe. `MetaHead.astro` links the CSS; `src/layouts/Layout.astro` loads the JS at the end of `<body>`. |

**These are what to reapply after every upstream merge.** A lost patch does not fail the
build: it fails silently in the browser.

### `nginx.conf`'s cache split: hashed paths vs. hand-edited files

`/_astro/` and `/ec/` are content-hashed — a content change is a new URL — so they get
`Cache-Control: immutable` for a year. Everything else that used to match the same
extension-based regex (`theme-init.js`, `series-scroll.js`, the favicons, everything under
`public/static/`) has **no hash in its name**, and two of those files (`theme-init.js`,
`series-scroll.js`) are exactly the ones this merge workflow expects you to hand-edit. They
get a one-hour TTL instead. `location ^~ /_astro/` and `location ^~ /ec/` are prefix matches
with `^~`, which in nginx beat regex locations regardless of declaration order, so this split
does not depend on where the blocks sit in the file.

### `vite.build.assetsInlineLimit: 0` is load-bearing, not an optimisation

Astro inlines a component `<script>` straight into the HTML when it has **no imports** and
fits under Vite's asset threshold (`astro/dist/core/build/plugins/plugin-scripts.js`:
`output.imports.length === 0 && shouldInlineAsset(...)`). `script-src 'self'` blocks those
**silently** — the symptom would be the theme toggle and the scroll-to-top button quietly not
responding, with no build error and nothing wrong-looking in the source.

So: **a `<script>` without `is:inline` is not guaranteed to become an external file.** This
setting is what guarantees it. It affected `ThemeToggle.astro` and `ScrollToTop.astro`;
`TableOfContents.astro` has an import, so it never qualified. Verified empirically: with the
setting in place, `_astro/` gained exactly those two script files and nothing else changed (no
asset turned into a `data:` URI anywhere in the output).

### `is:inline` on a `<script src>` means "don't bundle", not "put it inline"

The tag keeps its `src` and is still an external, same-origin file, so it satisfies
`script-src 'self'`. Do not "fix" it by removing the attribute — without it, Astro would
process and rebundle the tag.

### `style-src-attr 'unsafe-inline'` must not be removed

`@expressive-code/core` applies syntax colors through an `InlineStyleAnnotation` that writes a
`style="--0:...;--1:..."` attribute on **every** token, and `src/lib/expressive-code/inline.ts`
does the same for `` `code{:.scope}` `` spans. Dropping `style-src-attr` leaves every code
block black-and-white. It does not weaken `<style>` blocks, which `style-src 'self'` still
blocks.

## The zero-inline check: how to use it, and how it lies

The canonical command is in the Commands section above. Three things about it:

1. **`grep`ping for `localStorage.theme` is NOT a valid check** that the anti-flash script was
   externalised. `ThemeToggle.astro` *writes* that key while the anti-flash script *reads* it,
   so the string matches whether or not the patch worked. This cost a full fix round: the
   count stayed at 18 after a correct fix. Use the structural check, which looks for content
   between a tag's open and close.
2. **It false-positives on HTML comments.** It is not HTML-aware, so a comment containing the
   literal text `<style>` or `<script>` followed by a word matches — on every page the comment
   appears in. This is why the comment in `MetaHead.astro` says "un elemento style inline"
   instead of writing the tag. Keep writing them that way.
3. **The zero-inline property is empirical for per-block styles, not structural.**
   `satteri-expressive-code` pushes whatever `ec.render()` returns as per-block `styles`
   unconditionally (`dist/index.js:106`, not gated by `isFirstBlock`). That set has been empty
   for every code block rendered so far — verified by instrumenting `ec.render()` across ~52
   renders, all returning `styles.size === 0`, which is also why the warm-up contingency
   considered during implementation was never needed. But a future post using a language or
   plugin combination that produces per-block styles would silently reintroduce one inline
   `<style>`. **So: run the check after adding a post that contains code blocks.** The README
   says the same, as a habit rather than a footnote.

## The content-layer cache can serve stale HTML across rebuilds

Astro's content store lives at `node_modules/.astro/data-store.json` — **inside the
`node_modules` volume, not the `astro_cache` one** — and it is not invalidated when only the
*markdown-rendering pipeline code* changes, as opposed to the markdown content. Symptom: a
change under `src/lib/` appears to have no effect at all, and deleting the `astro_cache`
volume does not help because that is a different location.

```bash
docker run --rm -v blog-astro_node_modules:/nm alpine sh -c 'rm -rf /nm/.astro'
docker compose run --rm --no-deps build
```

Discovered while implementing the Expressive Code patch, where it made a correct fix look
like it was doing nothing.

## Behaviour differences from the sibling Hugo project

- **Astro empties `outDir` itself.** Verified empirically three times, most recently while
  writing this file: a foreign nested directory planted in the `site_public` volume as uid 1000
  was gone after a plain build, with no wipe in the command. So the explicit
  `find /public -mindepth 1 -delete` the Hugo project needs is **not** required here; one was
  added during implementation and then reverted for exactly this reason. The first probe that
  suggested otherwise was confounded: it created the directory as root, and uid 1000 simply had
  no permission to unlink inside it. Re-run it after a major Astro upgrade if you want to be
  sure:
  ```bash
  docker run --rm --user 1000:1000 -v blog-astro_site_public:/d alpine sh -c \
    'mkdir -p /d/fantasma && echo x > /d/fantasma/x.html'
  docker compose run --rm --no-deps build
  docker run --rm -v blog-astro_site_public:/d:ro alpine ls /d/fantasma   # must not exist
  ```
- **`astro check` fails the build on bad frontmatter**, unlike Hugo, which would just skip or
  mangle the page. The schemas are Zod, in `src/content.config.ts`. A broken post therefore
  blocks the whole site from rebuilding — that is the trade, and it is deliberate.
- **A future `date` still publishes**, unlike Hugo. Use `draft: true` to hide a post.
- **Post images resolve against the post's own folder** (`./cover.png`), because a post is a
  directory with an `index.md`, not a single file.

## sharp is mandatory

The template uses `<Image>` in three places (`BlogCard.astro`, `ProjectCard.astro`,
`src/pages/blog/[...id].astro`), so Astro's image optimisation is not optional. `bun.lock`
carries the musl variants of sharp, which is what makes it work on the Alpine-based bun image.
If image optimisation ever starts failing with a libvips error, look at the lockfile before
anything else — and never regenerate it outside the `deps` container.

## Local vs production

`astro.config.ts` reads `site: process.env.SITE_URL ?? "https://localhost"`.
`docker-compose.prod.yml` injects `SITE_URL` from `SITE_DOMAIN` in `.env` (gitignored;
template in `.env.example`, which uses the placeholder `miblog.com`) and swaps `Caddyfile` for
`Caddyfile.prod`. **Never hardcode the domain into a tracked file** — it has leaked once
already, into `.env.example` and a comment in `Caddyfile.prod`, and had to be scrubbed from
those and from the design documents. Before committing, `git grep` the tree for the real
hostname (not the `miblog.com` placeholder) and confirm it comes back empty. **This only
checks the current working tree** — `git grep` never searches history, so it cannot tell you
whether the hostname was committed and later removed. If that matters, check history
separately, e.g. `git log -p -- '*.env.example' Caddyfile.prod | grep -i '<hostname>'`.

Missing variables fail loudly: `docker compose -f docker-compose.yml -f docker-compose.prod.yml
config` errors with `falta SITE_DOMAIN: copia .env.example a .env` rather than deploying a
misconfigured stack. That `config` call is also the safe way to inspect the production setup —
**do not `up` the production stack from a development machine**, since Caddy would immediately
attempt a live ACME challenge for a real host it cannot serve.

HSTS is written but commented out in both Caddyfiles, and must stay that way until a real
certificate has been verified in a browser. The commented-out `www` block at the end of
`Caddyfile.prod` does **not** work as-is: it uses `import seguridad`, a snippet this file does
not define (it was copied from the Hugo project, where it does). Uncommenting it without first
wrapping the existing `header { ... }` directives in a `(seguridad) { ... }` snippet makes
Caddy refuse to load the config.
