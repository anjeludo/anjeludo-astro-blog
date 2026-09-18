# Blog Astro + Nginx + Caddy sobre Docker

Sitio estático con Astro y la plantilla [astro-erudite](https://github.com/jktrn/astro-erudite),
servido por Nginx tras un proxy Caddy con TLS. Todo el build ocurre en contenedores:
**no hace falta Node, Bun ni Astro instalados en la máquina**, solo Docker.

El entorno por defecto es **local** (`https://localhost/`). La producción vive en
ficheros aparte y se activa con un override; al final está la sección de despliegue.

Este fichero es la documentación de uso. Lo que no se deduce leyendo un solo fichero —por qué
cada parche de CSP está donde está, y las trampas que ya han costado una tarde— está en
`CLAUDE.md`.

---

## Arquitectura: pipeline de cinco etapas

Las etapas se encadenan con `depends_on`: cada una de las tres primeras espera a que la
anterior termine con éxito (`service_completed_successfully`), y Nginx no arranca hasta que el
build ha acabado. Basta un `docker compose up -d` para ejecutarlas en orden y dejar el sitio
servido.

| # | Servicio | Imagen | Red | Escritura | Cometido |
|---|---|---|---|---|---|
| 0 | `init-perms` | `alpine:3` | ninguna | los tres volúmenes | Cede `site_public`, `node_modules` y `astro_cache` al uid 1000 |
| 1 | `deps` | `oven/bun:1.4.2-alpine` | **sí** | solo `node_modules` | `bun install --frozen-lockfile` |
| 2 | `build` | `oven/bun:1.4.2-alpine` | **ninguna** | `node_modules`, `.astro` y `dist` | `astro check && astro build`, con las fuentes en solo lectura |
| 3 | `nginx` | `nginxinc/nginx-unprivileged:1.31.5-alpine` | interna | solo un `tmpfs` en `/tmp` | Sirve los ficheros estáticos, con el rootfs de solo lectura |
| 4 | `caddy` | `caddy:2.11.4-alpine` | interna | `/data`, `/config` | TLS, HTTP/3 y cabeceras de seguridad |

Las decisiones de fondo:

- **Solo la etapa 1 tiene internet.** Es la única que necesita salir a la red, y solo ve
  `package.json` y `bun.lock`, montados en solo lectura: con `--frozen-lockfile`, bun los
  lee pero no los reescribe. La etapa de build compila sin red y con el código fuente
  montado en solo lectura, así que no puede modificar tus fuentes ni hablar con el exterior.
- **`init-perms` existe** porque Docker crea los volúmenes como root; sin ese paso, bun
  (uid 1000) no podría escribir en ellos.
- **No hace falta vaciar el destino.** A diferencia de Hugo, Astro limpia `outDir` por su
  cuenta antes de cada build, incluidas las carpetas que él nunca escribió. Se comprobó a
  mano (ver `CLAUDE.md`), así que aquí no hay ningún `find -delete` previo.
- **Las fuentes se montan una a una**, no con `.:/src:ro`. Si añades un fichero de
  configuración en la raíz del proyecto, hay que añadir también su montaje al servicio
  `build` o el build no lo verá. El motivo está comentado en `docker-compose.yml`.
- **Versiones fijadas** en todas las imágenes, para que el entorno sea reproducible.

---

## Uso diario

```bash
# Editaste contenido (lo habitual): recompila solo el sitio, ~13 s
docker compose run --rm --no-deps build

# Cambió bun.lock, package.json o la plantilla: pipeline completo
docker compose up -d

# Ver el sitio
#   https://localhost/     (aviso de certificado: CA local de Caddy, es normal)

# Parar / arrancar
docker compose down
docker compose up -d
```

`docker compose run --rm --no-deps build` tarda unos 13 s, de los que la mayor parte se la
lleva `astro check`: valida tipos y frontmatter **antes** de compilar, y si algo está mal el
build falla en vez de publicar una página rota.

Después de arrancar, comprueba lo que quieras con `curl`. El certificado es de la CA local
de Caddy, así que hace falta `-k`:

```bash
curl -ks -o /dev/null -w '%{http_code}\n' https://localhost/
curl -ksI https://localhost/ | grep -i content-security-policy
```

---

## Estructura

```
├── docker-compose.yml          Las cinco etapas (local)
├── docker-compose.prod.yml     Override de produccion
├── Caddyfile                   TLS local, CSP y cabeceras de seguridad
├── Caddyfile.prod              Igual, pero con tu dominio y Let's Encrypt
├── .env.example                Plantilla para .env (dominio y correo ACME)
├── nginx.conf                  Backend estático: caché, 404, métodos permitidos
├── astro.config.ts             Config del sitio + los dos parches de CSP
├── package.json / bun.lock     Dependencias (se instalan en un volumen Docker)
├── public/                     Ficheros servidos tal cual
│   ├── theme-init.js           Anti-parpadeo del modo oscuro (externalizado por CSP)
│   └── series-scroll.js        Salto al subpost de una serie (externalizado por CSP)
├── src/
│   ├── consts.ts               Título, descripción, menú y redes sociales
│   ├── content.config.ts       Esquemas (Zod) de blog, authors y projects
│   ├── content/
│   │   ├── blog/               Tus entradas, una carpeta por post
│   │   ├── authors/            Fichas de autor referenciadas desde los posts
│   │   └── projects/           Vacío por ahora
│   ├── assets/                 Fuentes e iconos que pasan por el pipeline de Astro
│   ├── components/ layouts/ pages/ styles/   La plantilla
│   ├── lib/                    Los plugins de Markdown (callouts, matemáticas, enlaces…)
│   └── lib/expressive-code/    Bloques de código + el parche que saca su CSS y su JS del HTML
└── LICENSE                     MIT de astro-erudite
```

Lo que **no** está en git: `node_modules/`, `dist/`, `.astro/` (viven en volúmenes Docker)
y `.env` (tu dominio y tu correo).

---

## La plantilla: no es un tema, es el proyecto

erudite es una **plantilla**, no un tema de los que se instalan en una carpeta. No hay
`themes/` que borrar ni capa de overrides que proteja tus cambios: el repositorio *es* el
proyecto, y tus ficheros y los de la plantilla son los mismos.

Versión vendorizada: **astro-erudite v2.0.1**, commit `1ffdf62`. El remoto está configurado:

```bash
git fetch upstream
git log --oneline upstream/main -5           # ¿hay novedades?
git diff upstream/main -- src astro.config.ts public   # qué separa este repo del original
```

Para **actualizar** no hay atajo: se compara contra `upstream/main` y se aplican a mano los
cambios que interesen. Y lo importante:

> **Tras cualquier merge o copia desde upstream hay que reaplicar los parches de CSP.**
> Son pocos y están todos marcados en el código con el comentario `PARCHE CSP`:
> `astro.config.ts`, `src/components/MetaHead.astro`, `src/components/SeriesReader.astro`,
> `src/layouts/Layout.astro` y `src/lib/expressive-code/index.ts`. De ellos cuelgan ficheros
> que no existen en upstream —`public/theme-init.js`, `public/series-scroll.js`,
> `src/lib/expressive-code/assets.ts` y las dos rutas de `src/pages/ec/`—: un merge no puede
> pisarlos, pero sí dejarlos huérfanos. La lista completa, con el motivo de cada parche,
> está en `CLAUDE.md`.

Para encontrarlos en cualquier momento:

```bash
grep -rn 'PARCHE CSP' astro.config.ts src/
```

Si se pierde alguno, el síntoma no es un error de compilación: es un trozo de la página que
deja de funcionar en silencio porque el navegador bloquea el script o el estilo inline.

---

## Escribir posts

Un post es una **carpeta** dentro de `src/content/blog/` con un `index.md` dentro. El nombre
de la carpeta es la URL: `src/content/blog/hola-mundo/` → `/blog/hola-mundo/`. Las imágenes
del post viven en esa misma carpeta y se referencian en relativo (`./cover.png`).

```yaml
---
title: "Título del post"                  # obligatorio
description: "Resumen para la tarjeta y los metadatos."   # obligatorio
date: 2026-09-17                          # obligatorio
authors: ["anjeludo"]                     # obligatorio: ficheros de src/content/authors/
tags: ["docker", "astro"]                 # opcional
image: ./cover.png                        # opcional, relativo a la carpeta del post
draft: false                              # opcional
order: 1                                  # opcional, para ordenar subposts de una serie
---
```

Si la carpeta del post contiene más `.md` además del `index.md`, la plantilla los trata como
**subposts** de una serie: se leen seguidos en la misma página y se ordenan por `order`, y
si no lo tienen, por fecha (`src/lib/content.ts`).

Dos diferencias con Hugo que conviene tener presentes:

- **Una fecha futura sí se publica.** Para ocultar un borrador, `draft: true`.
- **El frontmatter mal puesto rompe el build.** `astro check` valida contra los esquemas de
  `src/content.config.ts` y aborta antes de compilar. Es mejor que publicar una página rota,
  pero significa que un post a medias no se queda "sin salir": impide que salga todo lo demás.

Lo que la plantilla ofrece en el cuerpo del post —bloques de código con título y botón de
copiar, código resaltado en línea, callouts (`note`, `tip`, `warning`, `caution`,
`important`), matemáticas en MathML e imágenes optimizadas— está demostrado en
`src/content/blog/how-to-publish-a-post/index.md`. Úsalo de plantilla.

### Tras escribir un post con bloques de código, comprueba que no hay nada inline

Es un hábito, no una curiosidad. Todo el sitio se sirve bajo una CSP que prohíbe `<script>`
y `<style>` inline, y los estilos de Expressive Code están sacados a `/ec/<hash>.css` para
cumplirla. Pero Expressive Code **puede** emitir estilos propios de un bloque concreto para
combinaciones de lenguaje o de plugin que aún no se han usado nunca. Si eso ocurre,
reaparecería un `<style>` inline y el navegador lo bloquearía **en silencio**: el bloque de
código se vería sin colores, sin ningún error visible en el build.

```bash
docker compose run --rm --no-deps build
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

**No debe imprimir nada.** Si imprime un fichero, mira qué etiqueta es antes de tocar nada:

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  "tr '\n' ' ' < /d/blog/mi-post/index.html | grep -oE '<(script|style)[^>]*> *[^ <]{1,120}'"
```

---

## Seguridad

**Cabeceras** (en el `Caddyfile`, idénticas en `Caddyfile.prod`): CSP estricta,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` y
supresión de `Server`.

```
default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none';
base-uri 'none'; form-action 'self'
```

Sin `'unsafe-inline'` para `<script>` ni `<style>`, y sin `'unsafe-eval'`. Todo el JS y el
CSS se sirven desde este dominio. La única concesión es `style-src-attr`, y es obligatoria:
Expressive Code colorea **cada token** de código con un atributo `style=""`. No abre la mano
con los bloques `<style>`, que `style-src 'self'` sigue bloqueando.

**Contenedores**: `no-new-privileges` en todos; el build sin red y con las fuentes en solo
lectura; Nginx sin privilegios, con sistema de ficheros de solo lectura y `tmpfs`; Caddy con
`cap_drop: ALL` y solo `NET_BIND_SERVICE`; límites de memoria y CPU; rotación de logs; el
backend no se expone al exterior (`expose`, no `ports`).

**Redirecciones de Nginx**: `nginx.conf` lleva `absolute_redirect off;` a propósito. Sin él,
un 301 (por ejemplo `/blog` → `/blog/`, que `try_files` genera para cualquier ruta que sea un
directorio) se construye con el `$scheme` y el `$server_port` internos de Nginx —
`http://localhost:8080/...`—, no con lo que el navegador tiene delante detrás de Caddy. Con la
directiva, el `Location` es relativo (`/blog/`) y el navegador lo resuelve él mismo.

> Si ves un error de CSP en la consola sobre un script inline procedente de `sandbox eval
> code`, es una **extensión de tu navegador**, no el sitio: aquí no hay ni un solo `<script>`
> inline. No añadas el hash que sugiere el navegador.

---

## Desplegar en producción

El entorno local **no se toca**: producción va en ficheros aparte (`Caddyfile.prod` y
`docker-compose.prod.yml`), y el dominio se inyecta por variables de entorno, así que
`astro.config.ts` sigue apuntando a `https://localhost`.

El servidor de producción es **una máquina en una red doméstica**, y el dominio es un
**subdominio de DNS dinámico (YDNS)**. Eso condiciona sobre todo la red:

### 1. Red y DNS

- **Abre en el router los puertos 80, 443/tcp y 443/udp** hacia la máquina que sirve el blog.
  El **80 no es opcional**: Caddy lo necesita para el desafío ACME con el que Let's Encrypt
  emite y renueva el certificado. Sin él no hay HTTPS. El 443/udp es para HTTP/3.
- **Hace falta un cliente de YDNS corriendo** en la red, actualizando el registro cada vez
  que el operador cambia la IP. Si la IP se queda obsoleta, el sitio deja de resolver y, de
  paso, falla la renovación del certificado.
- **No hay registro `www`**, a diferencia del proyecto de Hugo. "www" delante de un
  subdominio ya cualificado no tiene sentido, y YDNS solo entrega el registro de host
  concreto que se ha dado de alta, así que la variante `www.` no resolvería: Caddy pediría un
  certificado para ese nombre y fallaría el desafío ACME en bucle.

### 2. Configurar el dominio

```bash
cp .env.example .env
# edita .env con tu dominio y tu correo
```

```ini
SITE_DOMAIN=miblog.com
ACME_EMAIL=tu-correo@ejemplo.com
```

`.env` está ignorado por git a propósito: **el dominio no se escribe nunca en un fichero
versionado**. Si falta alguna de las dos variables, el despliegue se detiene con un mensaje
claro (`falta SITE_DOMAIN: copia .env.example a .env`) en vez de arrancar mal configurado.

### 3. Desplegar

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

El override hace dos cosas: inyecta `SITE_URL=https://$SITE_DOMAIN/` en la etapa de build
—para que los enlaces canónicos, el RSS y el sitemap salgan con el dominio real— y monta
`Caddyfile.prod` en lugar del `Caddyfile` local. A partir de ahí Caddy pide y renueva el
certificado de Let's Encrypt y redirige HTTP a HTTPS por su cuenta.

### 4. Activar HSTS (después, no antes)

Cuando hayas comprobado en el navegador que el certificado es válido, descomenta en
`Caddyfile.prod`:

```caddyfile
Strict-Transport-Security "max-age=31536000; includeSubDomains"
```

y vuelve a desplegar. **No lo actives antes**: si el TLS falla con HSTS puesto, los
navegadores que ya visitaron el sitio se negarán a entrar durante todo el `max-age` y no hay
forma rápida de revertirlo.

### Comprobaciones tras el despliegue

Contra tu dominio real, sin `-k` esta vez: el certificado tiene que ser válido de verdad.

```bash
curl -sI https://TU-DOMINIO/ | grep -i 'content-security-policy\|strict-transport'
curl -sI https://TU-DOMINIO/          # 200
curl -sI http://TU-DOMINIO/           # 308 hacia https
curl -s -o /dev/null -w '%{http_code}\n' https://TU-DOMINIO/no-existe   # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://TU-DOMINIO/    # 405
```

### Si algún día hay un dominio propio con `www`

`Caddyfile.prod` termina con un bloque `www` comentado, listo para descomentar. **Tal cual no
funciona**: usa `import seguridad`, un snippet que este fichero **no define** (viene copiado
del proyecto de Hugo, donde sí existe). Si lo descomentas sin más, Caddy se niega a cargar la
configuración y el sitio no arranca.

Antes de descomentarlo hay que envolver el bloque `header { ... }` existente en una
definición de snippet:

```caddyfile
(seguridad) {
    header {
        ...   # el contenido actual del bloque header
    }
}
```

y usar `import seguridad` también dentro del bloque principal.

---

## Pendientes

- **`/projects/` está en el menú pero su colección está vacía.** La página responde 200 y
  renderiza una lista vacía, sin mensaje. Además, el build imprime un aviso
  (`The collection "projects" does not exist or is empty`). Las dos cosas son consecuencia de
  no tener proyectos todavía, no defectos: se arreglan solas al añadir el primer proyecto en
  `src/content/projects/`, o quitando la entrada del menú en `src/consts.ts`.
- **Sin rate limiting**, igual que en el proyecto de Hugo. Para un sitio estático el riesgo es
  bajo, pero si llega tráfico hostil, considera `fail2ban` sobre los logs de Caddy o su
  módulo `rate_limit`.
- **La portada** (`src/pages/index.astro`) es una presentación genérica que sustituyó a la de
  la demo. Funciona, pero está pidiendo un rediseño personal.

## Licencias

astro-erudite es **MIT** (© 2026 enscribe); su licencia está en `LICENSE`, en la raíz del
repositorio, y se conserva tal cual.
