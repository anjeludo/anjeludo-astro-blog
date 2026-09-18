# Blog Astro + erudite sobre Docker — diseño

Fecha: 2026-09-17

Blog estático con la plantilla [astro-erudite](https://github.com/jktrn/astro-erudite)
v2.0.1, construido y servido enteramente en Docker, reutilizando la infraestructura
del proyecto hermano `hugo-docker-local` (Caddy + Nginx, CSP estricta, contenedores
endurecidos, override de producción por `.env`).

Nada —Node, bun, Astro— necesita estar instalado en el host. Solo Docker.

## Punto de partida

**Upstream del tema**: `jktrn/astro-erudite`, commit `1ffdf62bfd1c4dfc0fa770a0442b8545908689e7`
(2026-07-27), versión 2.0.1, licencia MIT (© 2026 enscribe). Astro 7, Node ≥ 22.12.

Sin framework de UI ni de CSS: CSS nativo con custom elements autónomos y escalas
fluidas de Utopia. Procesador Markdown Sätteri, Expressive Code para bloques de
código, Temml para matemáticas en MathML, fuentes IBM Plex auto-hospedadas.

**Infraestructura reutilizada** de `/media/angel/SSD200/proyectos/blog/hugo-docker-local`:
`docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile`, `Caddyfile.prod`,
`nginx.conf`, `.env.example`, `.gitignore`. Todo lo específico de Hugo se descarta.
Ese proyecto no contiene ningún directorio `.github`, por lo que no hay CI que
trasladar.

## Decisión de fondo: erudite es una plantilla, no un tema

No existe `themes/`. El repositorio **es** el proyecto y se personaliza editando sus
ficheros. Esto rompe el modelo mental de Hugo:

| | Hugo + TailBliss | Astro + erudite |
|---|---|---|
| Ubicación del tema | `themes/tailbliss/`, aislado | el repositorio entero |
| Personalización | overrides en `layouts/` | edición directa de los ficheros |
| Actualización | descargar y diffear la carpeta | `upstream` remoto + merge/diff manual |
| Sustituir el tema | borrar la carpeta | imposible: es el proyecto |

**Consecuencia**: no hay capa de overrides que aísle los cambios locales. La
estrategia de actualización es un remoto `upstream` hacia `jktrn/astro-erudite` y
diff manual. Por eso los parches de CSP (sección "CSP") quedan documentados de
forma explícita en `CLAUDE.md`: son exactamente lo que hay que reaplicar tras cada
merge de upstream.

## Arquitectura: pipeline de cinco etapas

Encadenadas con `depends_on: service_completed_successfully`. Se conserva la
**asimetría red/escritura** del proyecto de Hugo: solo una etapa tiene internet, y
la que compila no puede ni salir a la red ni modificar las fuentes.

| # | Servicio | Imagen | Red | Escribe en |
|---|---|---|---|---|
| 0 | `init-perms` | `alpine:3` | ninguna | `site_public`, `node_modules` → uid 1000 |
| 1 | `deps` | `oven/bun:1-alpine` | **sí** | solo el volumen `node_modules` |
| 2 | `build` | `oven/bun:1-alpine` | **ninguna** | `dist` y `.astro` (volúmenes) |
| 3 | `nginx` | `nginxinc/nginx-unprivileged:1.31.5-alpine` | interna | nada |
| 4 | `caddy` | `caddy:2.11.4-alpine` | interna | `/data` |

Todas las imágenes con versión fijada, como en el proyecto de Hugo.

### `init-perms`

Docker crea los volúmenes como root y Nginx copia en el suyo sus ficheros por
defecto. Cede `site_public` y `node_modules` al uid 1000. La imagen `oven/bun`
corre como el usuario `bun` (uid 1000), así que el uid coincide con el de las
etapas de Hugo y no hay que cambiar nada más.

### `deps` — la única etapa con red

Ejecuta `bun install --frozen-lockfile`. Solo ve el manifiesto y el lockfile; su
única salida es el volumen `node_modules`.

Con `--frozen-lockfile`, bun lee `package.json` y `bun.lock` pero no los reescribe,
así que **esta etapa tampoco muta las fuentes**. La caché de bun se redirige con
`BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache` y `HOME=/tmp`.

`bun.lock` incluye las variantes de plataforma de sharp para musl
(`@img/sharp-linuxmusl-x64`, `@img/sharp-libvips-linuxmusl-x64`), así que la
instalación en Alpine resuelve el binario correcto. Esto es obligatorio, no
opcional: el tema usa `<Image>` de `astro:assets` en `BlogCard.astro`,
`ProjectCard.astro` y `pages/blog/[...id].astro`, y sin sharp el build falla.

### `build` — sin red, fuentes en solo lectura

`network_mode: none`, `user: "1000:1000"`, y las fuentes montadas en solo lectura.
Ejecuta `bun run build`, que es `astro check && astro build`.

### Los montajes: rutas explícitas, no un bind de la raíz

Cada fuente se monta individualmente en solo lectura, en lugar de montar el
proyecto entero con `.:/src:ro`:

```
deps:
  ./package.json:/src/package.json:ro
  ./bun.lock:/src/bun.lock:ro
  node_modules:/src/node_modules

build:
  ./src:/src/src:ro
  ./public:/src/public:ro
  ./astro.config.ts:/src/astro.config.ts:ro
  ./package.json:/src/package.json:ro
  ./bun.lock:/src/bun.lock:ro
  ./tsconfig.json:/src/tsconfig.json:ro
  node_modules:/src/node_modules      deps + caché de Vite y de Astro
  astro_cache:/src/.astro             tipos y caché de la content layer
  site_public:/src/dist               la salida
```

**Motivo**: montar un volumen escribible en una ruta anidada dentro de un bind
`:ro` exige que el punto de montaje ya exista, y Docker no puede crearlo dentro de
un sistema de ficheros de solo lectura. En un clon recién hecho no existen
`node_modules/`, `.astro/` ni `dist/`, así que `.:/src:ro` más overlays anidados
fallaría con `read-only file system`. Con montajes explícitos, `/src` es un
directorio propio del contenedor y Docker sí puede crear ahí los puntos de montaje.

Los overlays escribibles son necesarios porque **Astro escribe dentro del
proyecto** durante el build: `.astro/` (tipos generados y caché de la content
layer) y las cachés de Vite y Astro bajo `node_modules/`. Es el equivalente del
`HUGO_CACHEDIR` / `HUGO_RESOURCEDIR` / `--noBuildLock` del proyecto de Hugo.

Al montar la salida exactamente en `/src/dist`, que es el `outDir` por defecto de
Astro, el comando de build no necesita flags de destino.

Dos ventajas colaterales: `deps` no ve ni `src/` ni `public/`, y cualquier
escritura que bun o Astro intentaran hacer en la raíz del proyecto va a la capa
efímera del contenedor sin alcanzar el host.

**Coste**: añadir un fichero de configuración en la raíz obliga a añadir su montaje
al compose. Queda anotado en `CLAUDE.md`.

### `nginx` y `caddy`

Sin cambios funcionales respecto al proyecto de Hugo. `nginx.conf` se reutiliza tal
cual: sirve `site_public`, `try_files $uri $uri/ =404`, caché inmutable de un año
para assets con hash, `no-store` para HTML, `set_real_ip_from` en rangos privados,
405 para métodos distintos de GET/HEAD, denegación de ficheros ocultos, `404.html`.

El formato de salida por defecto de Astro es `directory` (`/blog/post/index.html`),
que es justo lo que `try_files $uri $uri/` resuelve. Astro emite los assets con
hash bajo `/_astro/`, cubiertos por la regla de caché inmutable. Y genera
`/404.html`, que `error_page` ya espera.

## Diferencias de comportamiento frente a Hugo

Dos, y las dos van documentadas en `CLAUDE.md`:

1. **Astro vacía `outDir` él solo** antes de cada build. El
   `find /public -mindepth 1 -delete` que Hugo necesitaba (porque sobrescribe pero
   no borra páginas que ya no existen en `content/`) no hace falta aquí. Se verifica
   empíricamente en la implementación: se construye, se borra un post, se reconstruye
   y se comprueba que su HTML desapareció. Si Astro no vaciase el punto de montaje,
   se añade el wipe explícito al comando.

2. **El build falla si el frontmatter está mal.** `astro check` valida TypeScript y
   los schemas Zod de las colecciones. Hugo dejaba pasar contenido mal formado; aquí
   un post con un campo obligatorio ausente rompe el build. Es una mejora, pero
   cambia el modo de fallo: el error aparece al compilar, no al visitar la página.

También desaparece la trampa de la fecha futura de Hugo: erudite filtra por
`draft: true`, no por fecha.

## CSP

Política final, servida por Caddy en local y en producción:

```
default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none';
base-uri 'none'; form-action 'self'
```

**Idéntica** a la del proyecto de Hugo, incluida la concesión
`style-src-attr 'unsafe-inline'`. Esa concesión es obligatoria aquí, por dos
motivos independientes:

- `@expressive-code/core` aplica los colores de sintaxis con una
  `InlineStyleAnnotation` que hace `setProperty(node, "style", styleString)`. El
  plugin de Shiki usa variantes de estilo por tema, así que **cada token de cada
  bloque de código** lleva un `style="--0:…;--1:…"`.
- `src/lib/expressive-code/inline.ts:48` (`highlightScope`) emite
  `h("span", { style: "--0:…;--1:…" }, code)` para la sintaxis
  `` `code{:.scope}` ``.

Es una concesión estrecha y deliberada: `style-src-attr` gobierna solo los
atributos `style=""`. Los bloques `<style>` siguen bloqueados por
`style-src 'self'`, que es lo que de verdad importa aquí.

Las fuentes IBM Plex vienen auto-hospedadas en `src/assets/fonts/`, así que
`font-src 'self'` se cumple sin cambios.

### Los tres puntos de fricción y su solución

Un `<script>` sin `is:inline` **no** se empaqueta siempre a un fichero externo:
Astro lo inlinea si no tiene imports y cabe bajo el umbral de assets de Vite. Ese
es un cuarto punto de fricción, descubierto durante la implementación y no en el
diseño. Los cuatro:

| Fichero | Problema | Solución |
|---|---|---|
| `astro.config.ts` | `build.inlineStylesheets` por defecto es `'auto'`: inlinea en `<style>` las hojas de menos de ~4 kB, y erudite tiene 19 bloques `<style>` repartidos por sus componentes | `build.inlineStylesheets: 'never'` |
| `MetaHead.astro:59` | `<script is:inline>` que lee `localStorage.theme` antes del primer pintado (anti-parpadeo del modo oscuro) | extraer a `public/theme-init.js`, invocar con `<script src="/theme-init.js">` |
| `SeriesReader.astro:1` | `<script is:inline>` que restaura la posición de scroll en los posts encadenados en serie | extraer a `public/series-scroll.js`, invocar con `<script src="/series-scroll.js">` |
| `lib/expressive-code/index.ts` | el plugin de Sätteri inyecta un `<style>` y uno o más `<script type="module">` **dentro del HTML de cada página con bloques de código** | vaciar `baseStyles`/`themeStyles`/`jsModules` en `customCreateRenderer` y servirlos como ficheros propios |
| `astro.config.ts` (2) | Astro inlinea en un `<script type="module">` los scripts de componente sin imports que caben bajo el umbral de assets de Vite (`core/build/plugins/plugin-scripts.js`); afecta a `ThemeToggle` y `ScrollToTop`; `TableOfContents` tiene un import, así que nunca cumple la condición | `vite.build.assetsInlineLimit: 0` |

Los dos scripts extraídos se invocan **sin `async` ni `defer`**, en la misma
posición del documento que ocupaban. Un `<script src>` clásico es síncrono y
bloqueante, así que se ejecutan antes del primer pintado igual que antes: el
comportamiento no cambia. La lógica de ambos se copia sin modificar.

La alternativa de los hashes SHA-256 se descarta: acopla la CSP al contenido byte a
byte, y al actualizar el tema un cambio de un solo espacio bloquearía el script
**en silencio** —el síntoma sería un fogonazo blanco en cada carga, sin error
evidente—. `'unsafe-inline'` se descarta por renunciar a la protección contra XSS,
que es la razón de ser de todo el montaje.

### Expressive Code: el punto de fricción grande

`satteri-expressive-code` (`dist/index.js:107-124`) construye elementos
`<style>` y `<script type="module">` y los inserta en el árbol HAST del documento:

```js
extraElements.push({ type: "element", tagName: "style", ... })   // baseStyles + themeStyles
extraElements.push({ type: "element", tagName: "script",
                     properties: { type: "module" }, ... })      // los jsModules de EC
```

`firstBlockClaimed` es una variable del closure **por documento**, no global, así
que esto se repite en cada página que tenga al menos un bloque de código.
`@expressive-code/plugin-frames` sí emite un `jsModules` (`dist/index.js:533`): el
botón de copiar código.

`build.inlineStylesheets: 'never'` **no cubre nada de esto**, porque no son hojas de
estilo de Astro sino parte del HTML renderizado del Markdown. Con la CSP estricta,
en cada post con código los bloques quedarían sin estilo y el botón de copiar no
funcionaría, y en silencio.

La solución usa el punto de extensión documentado del paquete. `customCreateRenderer`
—que erudite ya utiliza— devuelve `{ ec, baseStyles, themeStyles, jsModules }`. Se
vacían los tres y se sirven como ficheros propios mediante **endpoints estáticos de
Astro** con el contenido bajo una ruta con huella de contenido:

```
src/lib/expressive-code/assets.ts   calcula ecCss, ecJs y sus rutas /ec/<sha>.{css,js}
src/pages/ec/[hash].css.ts          endpoint que emite el CSS
src/pages/ec/[hash].js.ts           endpoint que emite el JS
MetaHead.astro                      <link rel="stylesheet" href={ecCssPath}>
Layout.astro                        <script type="module" src={ecJsPath} is:inline>
```

Se eligen endpoints estáticos en lugar de un módulo virtual de Vite porque son API
pública y estable de Astro, sin depender de internals del bundler. La huella de
contenido en la ruta permite que la regla de caché inmutable de `nginx.conf` siga
siendo correcta sin tocarla.

El `is:inline` de ese `<script>` significa "no lo empaquetes", no "ponlo inline": el
tag conserva su `src` y sigue siendo un fichero externo del propio dominio, así que
cumple la CSP.

**Beneficio colateral, independiente de la seguridad**: los estilos base de
Expressive Code dejan de duplicarse en cada página con código y pasan a ser un
único fichero cacheado.

El filtro del sitemap en `astro.config.ts` excluye `/ec/` para que esas rutas no
aparezcan en él.

### A verificar en la implementación

Dos cosas:

1. erudite activa `prefetch: { prefetchAll: true }`. Hay que comprobar en el HTML
   generado si Astro emite algo inline para ello. Si lo hiciera, se externaliza del
   mismo modo; si no, no hay nada que tocar.

2. Además de `baseStyles` y `themeStyles`, el plugin inserta los `styles` que
   devuelve cada llamada a `ec.render()`. Expressive Code los deduplica por
   instancia del renderer, y el renderer es único y compartido, así que tras
   recuperar las base styles ese conjunto suele venir vacío. Si no lo estuviera,
   aparecería un `<style>` inline residual en la primera página construida.

La verificación de la sección "Verificación" detecta ambos casos
automáticamente: cualquier resto inline hace que el `grep` devuelva un fichero.

## Local vs producción

El dominio **nunca** aparece en ficheros versionados, igual que en el proyecto de
Hugo. Los ficheros de producción son overrides aparte y el entorno local no se toca.

```ts
// astro.config.ts
site: process.env.SITE_URL ?? "https://localhost",
```

```yaml
# docker-compose.prod.yml
services:
  build:
    environment:
      SITE_URL: "https://${SITE_DOMAIN:?falta SITE_DOMAIN: copia .env.example a .env}/"
  caddy:
    environment:
      SITE_DOMAIN: "${SITE_DOMAIN:?falta SITE_DOMAIN: copia .env.example a .env}"
      ACME_EMAIL: "${ACME_EMAIL:?falta ACME_EMAIL: copia .env.example a .env}"
    volumes:
      - ./Caddyfile.prod:/etc/caddy/Caddyfile:ro
```

Equivalente exacto del `HUGO_BASEURL` del proyecto de Hugo. `site` alimenta las URL
canónicas, el RSS y el sitemap. `.env` sigue ignorado por git; `.env.example` trae
el host de producción (un subdominio de YDNS) como ejemplo.

Si falta `SITE_DOMAIN` o `ACME_EMAIL`, el despliegue se detiene con un mensaje claro
en vez de arrancar mal configurado.

HSTS queda escrito y comentado en `Caddyfile.prod`, con la misma advertencia que en
el proyecto de Hugo: activarlo con el TLS roto deja el dominio inaccesible durante
todo el `max-age` sin vuelta atrás rápida.

### El bloque `www` se elimina

`Caddyfile.prod` de Hugo incluye un bloque `www.{$SITE_DOMAIN}` que redirige al apex
con un 301. Se **elimina** en este proyecto:

- el host de producción ya es un subdominio de DNS dinámico; "www" delante no tiene sentido.
- YDNS entrega registros de host concretos: su variante `www.` no resolvería.
- Caddy pediría un certificado para ese nombre, fallaría el desafío ACME y
  reintentaría, llenando el log de errores.

Queda documentado en `Caddyfile.prod` como comentario, para reactivarlo el día que
haya un dominio propio con registro `www`.

## Contenido e identidad

### `src/consts.ts`

```ts
export const SITE = {
  title: "anjeludo blog",
  description: "Personal blog of anjeludo.",
  locale: "en-US",
  dir: "ltr",
  defaultPageImage: "/static/opengraph-image.png",
  defaultPostImage: "/static/1200x630.png",
} as const

export const NAVIGATION = [
  { href: "/blog", label: "Blog" },
  { href: "/projects", label: "Projects" },
]

export const SOCIALS = [
  { href: "https://github.com/anjeludo", label: "GitHub", icon: GitHub },
  { href: "https://x.com/anjeludo", label: "X", icon: X },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]
```

Sitio en inglés (`en-US`), monolingüe. Sin correo en las redes sociales.
`/authors` sale de la navegación: con un solo autor la página no aporta, aunque sus
rutas siguen generándose. `src/assets/icons/twitter.svg` (logo del pájaro) se
sustituye por `x.svg` con el logo de X.

La descripción del sitio es una línea en `src/consts.ts` y se cambia sin más.

### Contenido

Se borra todo el contenido de demo del tema:

```
src/content/blog/introducing-v2/     ~1300 líneas, es la documentación del tema
src/content/blog/v1-posts/
src/content/projects/project-{a,b,c}.md
src/content/projects/placeholder.png
src/content/authors/enscribe.md
```

Y se crea:

```
src/content/authors/anjeludo.md              perfil del autor
src/content/blog/how-to-publish-a-post/       un post que sirve de plantilla
  index.md
src/content/projects/                          vacío
```

El post de ejemplo cumple el papel de `content/posts/como-publicar-un-post.md` en el
proyecto de Hugo: documenta el frontmatter y ejercita lo que de verdad se va a usar
—callouts con directivas `:::`, bloques de código de Expressive Code, código inline
con `` `code{:lang}` ``, matemáticas con Temml, una imagen—. Está en inglés, como el
resto del sitio.

`src/content/projects/` se queda vacío. La página `/projects` debe seguir
construyendo sin errores con la colección vacía; si no lo hiciera, se añade el
manejo del caso vacío en `src/pages/projects/index.astro`.

## Documentación del repositorio

Se respeta la convención del proyecto de Hugo:

- **`README.md` en español** — documentación de usuario: arquitectura del pipeline,
  uso diario, estructura, cómo escribir posts, seguridad, despliegue en producción.
  Incluye lo que YDNS implica: el servidor está en una red doméstica, hacen falta
  los puertos 80, 443/tcp y 443/udp abiertos en el router y el cliente de YDNS
  actualizando la IP.
- **`CLAUDE.md` en inglés** — lo que no es obvio leyendo un solo fichero: la
  naturaleza de plantilla del tema y la estrategia de actualización, los cuatro
  parches de CSP y por qué existen, los overlays escribibles del build, las dos
  diferencias de comportamiento frente a Hugo, y los comandos de verificación.

## `.gitignore`

Se conserva la estructura y los comentarios en español del proyecto de Hugo,
sustituyendo la sección de Hugo por la de Astro y manteniendo intactas las de
secretos, logs y editores:

```
dist/
.astro/
node_modules/
.env  (con !.env.example)
```

## Verificación

No hay suite de tests, igual que en el proyecto de Hugo: se verifica contra el sitio
en marcha. Caddy sirve con una CA local, así que **curl necesita `-k`**.

```bash
# Cero <script>/<style> inline en todo el HTML generado.
# Sin salida = correcto. Detecta también una posible regresión del prefetch.
docker run --rm -v blog-astro_site_public:/d:ro alpine \
  sh -c "grep -rlE '<(script|style)[^>]*>[^<]' /d --include='*.html'"

curl -ksI https://localhost/ | grep -i content-security-policy
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/            # 200
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/blog/       # 200
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/rss.xml     # 200
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/no-existe   # 404
```

Y en el navegador, con la consola abierta: ninguna violación de CSP, y sin fogonazo
blanco al recargar con el tema oscuro activo (eso valida `theme-init.js`).

`astro check`, que forma parte de `bun run build`, valida TypeScript y los schemas
de las colecciones en cada build.

Verificación del vaciado de `outDir`: construir, borrar un post, reconstruir y
comprobar que su HTML ya no está en el volumen.

## Git

`git init` en `blog-astro`, rama `main`. El `.git` de erudite se elimina: sus
ficheros pasan a estar versionados en este repositorio, que queda autocontenido.
Sin remoto `origin` por ahora. Se conserva el `LICENSE` MIT del tema.

## Fuera de alcance

- **CI/CD**: no se crea ningún workflow. `hugo-docker-local` no tiene `.github`
  (la mención original a `.github` era un lapsus: se refería a `.gitignore`).
- **i18n / multiidioma**: el sitio es monolingüe en inglés. erudite v2 no trae
  infraestructura de i18n ni rutas por idioma; añadirla sería un proyecto aparte.
- **Port forwarding, DDNS y DNS**: se documentan en el README, no se configuran.
- **Rate limiting**: sigue sin haberlo, igual que en el proyecto de Hugo. Para un
  sitio estático el riesgo es bajo; si llega tráfico hostil, `fail2ban` sobre los
  logs de Caddy o el módulo `rate_limit`.
- **Migrar el contenido del blog de Hugo**: no se traslada ningún post.
