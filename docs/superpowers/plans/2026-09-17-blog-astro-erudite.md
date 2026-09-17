# Blog Astro + erudite sobre Docker — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blog estático con la plantilla astro-erudite v2.0.1, construido y servido enteramente en Docker, con la infraestructura de `hugo-docker-local` (Caddy + Nginx, CSP estricta, contenedores endurecidos, override de producción por `.env`).

**Architecture:** Cinco etapas en `docker-compose.yml` encadenadas con `service_completed_successfully`. Solo `deps` tiene red; `build` corre sin red con las fuentes en solo lectura y escribe únicamente en volúmenes. Nginx sirve el `dist` y Caddy termina TLS e impone las cabeceras. La CSP estricta obliga a externalizar todo lo que el tema emite inline.

**Tech Stack:** Astro 7, bun (lockfile `bun.lock`), Sätteri, Expressive Code, Temml, sharp, Caddy 2, Nginx unprivileged, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-17-blog-astro-erudite-design.md`

## Global Constraints

- **No hay suite de tests.** Cada tarea termina con comandos de verificación cuya salida esperada está escrita de forma literal. Esos comandos son el ciclo de test de este plan: no se marca una tarea como hecha sin haberlos ejecutado y comparado la salida.
- **Nada se instala en el host.** Solo Docker. Ningún paso ejecuta `bun`, `node` o `astro` directamente en la máquina.
- **Identidad de git del repo**: `anjeludo <anjeludo@gmail.com>`. Ya está en `.git/config` local; no pasar `-c user.*` en ningún commit.
- **Versiones de imagen fijadas.** Ninguna etiqueta `latest` ni rango. Las de la infra de Hugo se reutilizan exactas: `alpine:3`, `nginxinc/nginx-unprivileged:1.31.5-alpine`, `caddy:2.11.4-alpine`.
- **El dominio nunca se escribe en un fichero versionado.** Se inyecta por entorno desde `.env`, que está en `.gitignore`. Valor de producción: `miblog.com`.
- **CSP final**, idéntica en `Caddyfile` y `Caddyfile.prod`:
  `default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
- **`style-src-attr 'unsafe-inline'` es obligatorio** y no debe eliminarse: Expressive Code colorea cada token con un atributo `style=""`. `style-src 'self'` sigue bloqueando los bloques `<style>`, que es lo que importa.
- **Cero `<script>` y `<style>` inline en el HTML generado.** Es la propiedad que se verifica en las tareas 3, 4 y 5.
- **Sitio monolingüe en inglés** (`locale: "en-US"`). Todo el contenido y la interfaz, en inglés.
- **Documentación**: `README.md` en español, `CLAUDE.md` en inglés.
- **Upstream del tema**: `jktrn/astro-erudite`, commit `1ffdf62bfd1c4dfc0fa770a0442b8545908689e7`, v2.0.1, MIT (© 2026 enscribe). El `LICENSE` se conserva.

## File Structure

| Fichero | Responsabilidad | Tarea |
|---|---|---|
| `.gitignore` | Excluir salida del build, dependencias y secretos | 1 |
| `astro.config.ts` | Config de Astro: `site` por entorno, `inlineStylesheets`, filtro del sitemap | 1, 4, 5, 7 |
| `docker-compose.yml` | Las cinco etapas del entorno local | 2, 3 |
| `nginx.conf` | Backend estático endurecido | 3 |
| `Caddyfile` | TLS local + CSP + cabeceras | 3 |
| `public/theme-init.js` | Anti-parpadeo del tema, externalizado por la CSP | 4 |
| `public/series-scroll.js` | Restauración de scroll en series, externalizada por la CSP | 4 |
| `src/components/MetaHead.astro` | `<head>`: invoca los scripts externos y el CSS de Expressive Code | 4, 5 |
| `src/components/SeriesReader.astro` | Invoca el script de scroll externo | 4 |
| `src/layouts/Layout.astro` | Invoca el JS externo de Expressive Code | 5 |
| `src/lib/expressive-code/index.ts` | Vacía los assets inline del plugin | 5 |
| `src/lib/expressive-code/assets.ts` | Calcula el CSS, el JS y sus rutas con huella de contenido | 5 |
| `src/pages/ec/[hash].css.ts` | Endpoint que emite el CSS de Expressive Code | 5 |
| `src/pages/ec/[hash].js.ts` | Endpoint que emite el JS de Expressive Code | 5 |
| `src/consts.ts` | Identidad del sitio, navegación y redes | 6 |
| `src/assets/icons/x.svg` | Logo de X, sustituye `twitter.svg` | 6 |
| `src/content/authors/anjeludo.md` | Perfil del autor | 6 |
| `src/content/blog/how-to-publish-a-post/` | Post que hace de plantilla y de demo | 6 |
| `docker-compose.prod.yml` | Override de producción: dominio por `.env` | 7 |
| `Caddyfile.prod` | Let's Encrypt + CSP, sin bloque `www` | 7 |
| `.env.example` | Plantilla de `SITE_DOMAIN` y `ACME_EMAIL` | 7 |
| `README.md` | Documentación de usuario, español | 8 |
| `CLAUDE.md` | Lo no obvio del repo, inglés | 8 |

---

### Task 1: Vendorizar erudite y fijar el `.gitignore`

Trae la plantilla al repo como código propio y evita que las dependencias y la salida del build entren en git.

**Files:**
- Create: todo el árbol de `jktrn/astro-erudite` en la raíz del proyecto (`astro.config.ts`, `package.json`, `bun.lock`, `tsconfig.json`, `biome.json`, `LICENSE`, `.gitattributes`, `src/`, `public/`)
- Modify: `.gitignore` (erudite trae el suyo; se sobrescribe **después** del rsync)
- Delete: el `.git` del clon (los ficheros pasan a estar versionados en este repo)

**Interfaces:**
- Consumes: nada.
- Produces: el árbol del proyecto en su estado upstream. Las tareas 2 a 8 parten de aquí. Rutas que las siguientes tareas dan por existentes: `astro.config.ts`, `package.json`, `bun.lock`, `tsconfig.json`, `src/consts.ts`, `src/layouts/Layout.astro`, `src/components/MetaHead.astro`, `src/components/SeriesReader.astro`, `src/lib/expressive-code/{index,config,inline}.ts`, `public/`.

- [ ] **Step 1: Clonar el upstream en un directorio temporal y fijar el commit**

```bash
cd /tmp
rm -rf erudite-upstream
git clone https://github.com/jktrn/astro-erudite.git erudite-upstream
cd erudite-upstream
git checkout 1ffdf62bfd1c4dfc0fa770a0442b8545908689e7
git log -1 --format='%H %ci'
```

Esperado: `1ffdf62bfd1c4dfc0fa770a0442b8545908689e7 2026-07-27 19:27:19 -0400`

Si el commit no existe (historia reescrita en upstream), **parar y avisar**: el plan fija esta versión y cualquier otra hay que revisarla.

- [ ] **Step 2: Copiar el árbol al proyecto sin el `.git` del clon**

```bash
cd /media/angel/SSD200/proyectos/blog/blog-astro
rsync -a --exclude='.git/' /tmp/erudite-upstream/ ./
rm -rf /tmp/erudite-upstream
ls -a
```

Esperado en `ls -a`: `.gitattributes`, `.gitignore`, `LICENSE`, `README.md`,
`astro.config.ts`, `biome.json`, `bun.lock`, `docs`, `package.json`, `public`,
`src`, `tsconfig.json`. **No** debe aparecer `node_modules` ni `dist`.

El `README.md` de erudite queda sobrescribiendo temporalmente; la tarea 8 lo
reemplaza por el propio.

- [ ] **Step 3: Sobrescribir el `.gitignore` de erudite por el propio**

Este paso va **después** del `rsync` a propósito: erudite versiona su propio
`.gitignore`, así que copiarlo antes lo perdería. El de erudite no ignora
`.env`, y ese fichero lleva el dominio y el correo de ACME.

Conserva la estructura y los comentarios en español del proyecto de Hugo;
cambia la sección de Hugo por la de Astro.

Sobrescribir `.gitignore` con:

```gitignore
# ─── Salida del build ─────────────────────────────────────────────
# El sitio se publica en el volumen Docker site_public, pero si alguna
# vez compilas fuera del contenedor apareceran estos.
dist/
.astro/

# ─── Dependencias ─────────────────────────────────────────────────
# Viven en el volumen Docker node_modules. Se reinstalan con:
# docker compose up -d
node_modules/

# ─── Secretos y entorno ───────────────────────────────────────────
.env
.env.*
!.env.example

# ─── Logs de gestores de paquetes ─────────────────────────────────
npm-debug.log*
pnpm-debug.log*
yarn-error.log*
bun-debug.log*

# ─── Editores y sistema operativo ─────────────────────────────────
.vscode/
.idea/
*.swp
*~
.DS_Store
Thumbs.db
```

Verificar que quedó el propio y no el de erudite:

```bash
grep -c 'Salida del build' .gitignore
grep -c '^\.env$' .gitignore
```

Esperado: `1` en los dos.

- [ ] **Step 4: Verificar que git ve lo que debe y nada más**

```bash
git status --short | head -30
git status --short | wc -l
git status --short | grep -cE 'node_modules|/dist/|\.astro/'
```

Esperado: la lista incluye `?? astro.config.ts`, `?? package.json`, `?? bun.lock`, `?? src/`, `?? public/`, `?? LICENSE`. El último comando debe imprimir `0`.

Verificar también que los ficheros que las siguientes tareas van a editar existen:

```bash
ls src/consts.ts src/layouts/Layout.astro src/components/MetaHead.astro \
   src/components/SeriesReader.astro src/lib/expressive-code/index.ts \
   src/lib/expressive-code/config.ts src/lib/expressive-code/inline.ts
```

Esperado: las siete rutas listadas, sin errores.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Vendoriza astro-erudite v2.0.1 como base del blog

Plantilla jktrn/astro-erudite en el commit 1ffdf62, MIT (c) 2026 enscribe.
Se elimina su .git: los ficheros pasan a estar versionados aqui, asi que el
repositorio es autocontenido. Actualizar significa diffear contra upstream.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Etapas de build en Docker

Levanta las tres primeras etapas y consigue el primer `dist` compilado. Es la tarea con más riesgo técnico: valida la asimetría red/escritura, los overlays escribibles y que sharp funcione en Alpine.

**Files:**
- Create: `docker-compose.yml` (etapas 0 a 2; las de servidores las añade la tarea 3)

**Interfaces:**
- Consumes: el árbol del proyecto de la tarea 1.
- Produces: los volúmenes `site_public` (con el sitio compilado), `node_modules` y `astro_cache`. El servicio `build` y la red `build_net`. La tarea 3 añade servicios a este mismo fichero y monta `site_public` en Nginx.

- [ ] **Step 1: Averiguar la versión exacta de bun y el uid de la imagen**

Las etiquetas se fijan exactas, así que hay que leer la versión concreta en vez de dejar `1-alpine`.

```bash
docker pull oven/bun:1-alpine
docker run --rm oven/bun:1-alpine bun --version
docker run --rm --entrypoint sh oven/bun:1-alpine -c 'id; id bun'
```

Anotar la versión que imprima `bun --version` (por ejemplo `1.3.9`) — se usa como `oven/bun:<version>-alpine` en el paso siguiente. Anotar también si el uid por defecto es 1000; el compose lo fija explícitamente con `user: "1000:1000"`, así que basta con confirmar que el usuario `bun` existe con uid 1000. Si no existiera, **parar y avisar**: habría que ajustar el `chown` de `init-perms`.

- [ ] **Step 2: Escribir `docker-compose.yml` con las tres etapas de build**

Sustituir `<BUN_VERSION>` por la versión anotada en el paso 1.

```yaml
services:
  # ETAPA 0 - Docker crea los volumenes como root. Este paso unico los cede al
  # uid 1000, que es el usuario 'bun' de las imagenes de build.
  init-perms:
    image: alpine:3
    container_name: blog_init_perms
    user: "0:0"
    network_mode: none
    command: sh -c "chown -R 1000:1000 /public /node_modules /astro_cache && echo 'PERMISOS OK'"
    volumes:
      - site_public:/public
      - node_modules:/node_modules
      - astro_cache:/astro_cache
    logging:
      driver: "json-file"
      options:
        max-size: "1m"
        max-file: "1"

  # ETAPA 1 - Unico servicio con red. Solo ve el manifiesto y el lockfile, y su
  # unica salida es el volumen node_modules: con --frozen-lockfile, bun lee
  # package.json y bun.lock pero no los reescribe.
  deps:
    image: oven/bun:<BUN_VERSION>-alpine
    container_name: blog_deps
    entrypoint: sh
    working_dir: /src
    user: "1000:1000"
    networks:
      - build_net
    depends_on:
      init-perms:
        condition: service_completed_successfully
    environment:
      HOME: /tmp
      BUN_INSTALL_CACHE_DIR: /tmp/.bun-cache
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./package.json:/src/package.json:ro
      - ./bun.lock:/src/bun.lock:ro
      - node_modules:/src/node_modules
    command: -c "bun install --frozen-lockfile && echo 'DEPS OK'"
    logging:
      driver: "json-file"
      options:
        max-size: "5m"
        max-file: "2"

  # ETAPA 2 - Sin red y con las fuentes en solo lectura.
  #
  # Cada fuente se monta por separado en vez de montar la raiz con .:/src:ro.
  # Motivo: un volumen escribible en una ruta anidada dentro de un bind :ro
  # necesita que el punto de montaje exista, y Docker no puede crearlo en un
  # sistema de ficheros de solo lectura. En un clon recien hecho no existen
  # node_modules/, .astro/ ni dist/. Con montajes explicitos, /src es un
  # directorio del contenedor y Docker si puede crear ahi los mountpoints.
  #
  # OJO: si añades un fichero de configuracion en la raiz del proyecto, hay que
  # añadir tambien su montaje aqui o el build no lo vera.
  build:
    image: oven/bun:<BUN_VERSION>-alpine
    container_name: blog_builder
    entrypoint: sh
    working_dir: /src
    network_mode: none
    user: "1000:1000"
    depends_on:
      deps:
        condition: service_completed_successfully
    environment:
      HOME: /tmp
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./src:/src/src:ro
      - ./public:/src/public:ro
      - ./astro.config.ts:/src/astro.config.ts:ro
      - ./package.json:/src/package.json:ro
      - ./bun.lock:/src/bun.lock:ro
      - ./tsconfig.json:/src/tsconfig.json:ro
      - node_modules:/src/node_modules
      - astro_cache:/src/.astro
      - site_public:/src/dist
    command: -c "bun run build && echo 'BUILD OK'"
    logging:
      driver: "json-file"
      options:
        max-size: "5m"
        max-file: "2"

networks:
  build_net:
    driver: bridge

volumes:
  site_public:
  node_modules:
  astro_cache:
```

- [ ] **Step 3: Ejecutar el pipeline y verificar que compila**

```bash
docker compose up --abort-on-container-failure
```

Esperado, en orden: `PERMISOS OK`, luego la instalación de bun terminando en `DEPS OK`, luego la salida de `astro check` y `astro build` terminando en `BUILD OK`.

Fallos probables y su lectura:
- `read-only file system` al crear un mountpoint → un montaje anidado quedó bajo un bind `:ro`; revisar que no se haya colado `.:/src:ro`.
- `EACCES` escribiendo en `/src/dist`, `/src/.astro` o `/src/node_modules` → `init-perms` no corrió o no cubrió ese volumen.
- Error de sharp sobre `libvips` o un binario de plataforma → **parar y avisar**; `bun.lock` incluye `@img/sharp-linuxmusl-x64`, así que esto indicaría que el lockfile cambió.
- `astro check` con errores de tipos → son del upstream tal cual; **parar y avisar** antes de tocar nada.

- [ ] **Step 4: Verificar que el sitio está en el volumen**

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'ls /d; echo "--- html ---"; find /d -name "*.html" | head -20; echo "--- total ---"; find /d -name "*.html" | wc -l'
```

Esperado: `index.html`, `404.html`, `_astro/`, `blog/`, `rss.xml`, `sitemap-index.xml` entre otros, y un recuento de HTML mayor que 1.

- [ ] **Step 5: Verificar que Astro vacía `outDir` por sí solo**

El proyecto de Hugo necesitaba `find /public -mindepth 1 -delete` porque Hugo no borra páginas que ya no existen. Hay que comprobar si Astro sí lo hace, porque de ello depende que el comando del compose sea correcto.

```bash
# Un post de demo cualquiera que exista ahora
docker run --rm -v blog-astro_site_public:/d:ro alpine find /d -path '*introducing-v2*' -name 'index.html'
# Sacarlo de en medio y reconstruir
mv src/content/blog/introducing-v2 /tmp/introducing-v2-tmp
docker compose run --rm --no-deps build
docker run --rm -v blog-astro_site_public:/d:ro alpine find /d -path '*introducing-v2*' -name 'index.html'
# Restaurarlo
mv /tmp/introducing-v2-tmp src/content/blog/introducing-v2
docker compose run --rm --no-deps build
```

Esperado: el primer `find` imprime una ruta, el segundo **no imprime nada**.

Si el segundo `find` sigue imprimiendo la ruta, Astro no vació el punto de montaje. En ese caso cambiar el `command` de `build` a:

```yaml
    command: -c "find /src/dist -mindepth 1 -delete && bun run build && echo 'BUILD OK'"
```

y repetir esta verificación hasta que el segundo `find` salga vacío. Anotar el resultado: la tarea 8 lo documenta en `CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "Añade el pipeline de build en Docker

Tres etapas encadenadas: init-perms cede los volumenes al uid 1000, deps es
la unica con red e instala en el volumen node_modules, y build corre sin red
con las fuentes en solo lectura.

Las fuentes se montan una a una en vez de montar la raiz :ro, porque un
volumen escribible anidado bajo un bind de solo lectura no puede crear su
punto de montaje en un clon recien hecho.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Servir en local con la CSP estricta

Añade Nginx y Caddy y pone la CSP definitiva. Al final de esta tarea el sitio se sirve **y la verificación de "cero inline" falla a propósito**: esa salida es la evidencia que justifica las tareas 4 y 5.

**Files:**
- Create: `nginx.conf` (copia literal del proyecto de Hugo)
- Create: `Caddyfile`
- Modify: `docker-compose.yml` (añadir `nginx` y `caddy`, y la red `internal_net`)

**Interfaces:**
- Consumes: el volumen `site_public` y el servicio `build` de la tarea 2.
- Produces: el sitio en `https://localhost/` y la CSP aplicada. Las tareas 4 y 5 usan el comando de verificación de inline definido aquí.

- [ ] **Step 1: Copiar `nginx.conf` literal del proyecto de Hugo**

Se reutiliza sin cambios: es agnóstico del generador. El formato de salida por defecto de Astro es `directory` (`/blog/post/index.html`), que es lo que `try_files $uri $uri/` resuelve; los assets con hash van bajo `/_astro/` y los cubre la regla de caché inmutable; y Astro genera `/404.html`, que `error_page` ya espera.

```bash
cp /media/angel/SSD200/proyectos/blog/hugo-docker-local/nginx.conf ./nginx.conf
diff /media/angel/SSD200/proyectos/blog/hugo-docker-local/nginx.conf ./nginx.conf && echo "IDENTICO"
```

Esperado: `IDENTICO`.

- [ ] **Step 2: Escribir el `Caddyfile` local**

Crear `Caddyfile`:

```caddyfile
{
    servers {
        protocols h1 h2 h3
    }
}

localhost {
    encode zstd gzip

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        # style-src-attr cubre los atributos style="" y es OBLIGATORIO aqui:
        # Expressive Code colorea cada token de codigo con una
        # InlineStyleAnnotation, que escribe un style="--0:...;--1:...".
        # No abre 'unsafe-inline' a los bloques <style>, que siguen bloqueados
        # por style-src 'self'.
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        Permissions-Policy "geolocation=(), camera=(), microphone=()"
        -Server

        # PRODUCCION: descomentar solo cuando el certificado real este validado.
        # Activarlo con TLS roto deja el dominio inaccesible durante max-age.
        # Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    reverse_proxy nginx:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

- [ ] **Step 3: Añadir los servidores al `docker-compose.yml`**

Insertar estos dos servicios después de `build`, antes del bloque `networks:`:

```yaml
  nginx:
    image: nginxinc/nginx-unprivileged:1.31.5-alpine
    container_name: blog_nginx
    restart: unless-stopped
    depends_on:
      build:
        condition: service_completed_successfully
    networks:
      - internal_net
    expose:
      - "8080"
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=10m
    volumes:
      - site_public:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.50'
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  caddy:
    image: caddy:2.11.4-alpine
    container_name: blog_caddy
    restart: unless-stopped
    depends_on:
      - nginx
    ports:
      - "80:80/tcp"
      - "443:443/tcp"
      - "443:443/udp"
    networks:
      - internal_net
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.50'
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Y ampliar los dos bloques del final:

```yaml
networks:
  internal_net:
    driver: bridge
  build_net:
    driver: bridge

volumes:
  site_public:
  node_modules:
  astro_cache:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Levantar y verificar que el sitio responde**

```bash
docker compose up -d
sleep 5
curl -ks -o /dev/null -w 'raiz: %{http_code}\n'   https://localhost/
curl -ks -o /dev/null -w 'blog: %{http_code}\n'   https://localhost/blog/
curl -ks -o /dev/null -w 'rss:  %{http_code}\n'   https://localhost/rss.xml
curl -ks -o /dev/null -w '404:  %{http_code}\n'   https://localhost/no-existe
curl -ksI https://localhost/ | grep -i 'content-security-policy'
curl -ksI https://localhost/ | grep -ci 'server:'
```

Esperado: `raiz: 200`, `blog: 200`, `rss: 200`, `404: 404`, la cabecera CSP completa, y `0` en el último (la directiva `-Server` la suprime).

- [ ] **Step 5: Ejecutar la verificación de "cero inline" — debe FALLAR aquí**

Este es el test que las tareas 4 y 5 hacen pasar. Se normalizan los saltos de línea antes de buscar, porque un `<style>` puede abrir en una línea y tener el contenido en la siguiente.

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

Esperado **en esta tarea**: una lista no vacía de ficheros HTML. Son tres cosas distintas, y conviene identificarlas para saber qué arregla cada tarea siguiente:

```bash
# El <script is:inline> del anti-parpadeo: en TODAS las paginas (tarea 4)
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rl "localStorage.theme" /d --include="*.html" | wc -l'

# Los <style> que Astro inlinea por inlineStylesheets: auto (tarea 4)
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rlE "<style>[^<]" /d --include="*.html" | wc -l'

# Los <script type="module"> de Expressive Code (tarea 5)
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rl "script type=\"module\"" /d --include="*.html" | wc -l'
```

Esperado: los tres recuentos mayores que 0. Anotarlos: las tareas 4 y 5 los tienen que llevar a `0`.

- [ ] **Step 6: Commit**

```bash
git add nginx.conf Caddyfile docker-compose.yml
git commit -m "Sirve el sitio en local con Nginx, Caddy y la CSP estricta

nginx.conf se reutiliza literal del proyecto de Hugo: es agnostico del
generador y el formato de salida por defecto de Astro encaja con su try_files.

La CSP conserva la concesion style-src-attr 'unsafe-inline', obligatoria
porque Expressive Code colorea cada token con un atributo style. Los bloques
<style> siguen bloqueados.

El HTML generado todavia contiene scripts y estilos inline, que la CSP bloquea.
Las dos tareas siguientes los externalizan.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Externalizar los dos scripts `is:inline` del tema

Quita dos de las tres fuentes de contenido inline: los scripts marcados `is:inline` y el inlineado automático de hojas de estilo pequeñas.

**Files:**
- Create: `public/theme-init.js`
- Create: `public/series-scroll.js`
- Modify: `src/components/MetaHead.astro` (el bloque `<script is:inline>`, hacia la línea 59)
- Modify: `src/components/SeriesReader.astro` (el bloque `<script is:inline>`, líneas 1-14)
- Modify: `astro.config.ts` (añadir `build.inlineStylesheets`)

**Interfaces:**
- Consumes: el árbol del tema de la tarea 1 y el comando de verificación de la tarea 3.
- Produces: `/theme-init.js` y `/series-scroll.js` servidos desde `public/`. La tarea 5 añade más contenido a `MetaHead.astro` y a `astro.config.ts`, así que deja esos ficheros formateados y coherentes.

- [ ] **Step 1: Crear `public/theme-init.js` con la lógica literal del script inline**

La lógica se copia sin modificar. `const` en el ámbito de un script clásico no crea una propiedad global, así que no hace falta envolverlo.

```javascript
// Aplica el tema guardado antes del primer pintado, para que no haya un
// fogonazo del tema claro al recargar con el oscuro activo.
//
// Vive aqui y no inline en MetaHead.astro por la CSP: script-src 'self' no
// permite codigo dentro del HTML. Al invocarse con <script src> sin async ni
// defer sigue siendo sincrono y bloqueante, asi que corre igual de pronto.
const theme = localStorage.theme
if (theme === "light" || theme === "dark")
  document.documentElement.dataset.theme = theme
```

- [ ] **Step 2: Crear `public/series-scroll.js` con la lógica literal del script inline**

```javascript
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
```

- [ ] **Step 3: Sustituir el bloque inline de `MetaHead.astro`**

Buscar este bloque (hacia la línea 59, justo antes de `<slot />`):

```astro
  <script is:inline>
    const theme = localStorage.theme
    if (theme === "light" || theme === "dark")
      document.documentElement.dataset.theme = theme
  </script>
```

Y dejarlo así:

```astro
  <!-- PARCHE CSP sobre el tema. is:inline aqui significa "no lo empaquetes",
       no "ponlo inline": el tag conserva su src y sigue siendo un fichero
       externo del propio dominio, asi que cumple script-src 'self'.
       Sin async ni defer: tiene que correr antes del primer pintado. -->
  <script src="/theme-init.js" is:inline></script>
```

- [ ] **Step 4: Sustituir el bloque inline de `SeriesReader.astro`**

Es el primer bloque del fichero, líneas 1 a 14. Buscar:

```astro
<script is:inline>
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
</script>
```

Y dejarlo así:

```astro
<!-- PARCHE CSP sobre el tema. Ver public/series-scroll.js. -->
<script src="/series-scroll.js" is:inline></script>
```

El segundo `<script>` del fichero (el que importa de `@/lib/utils`) **no se toca**: Astro lo empaqueta a un fichero externo y ya cumple la CSP.

- [ ] **Step 5: Añadir `build.inlineStylesheets` a `astro.config.ts`**

En el objeto de `defineConfig`, después de `prefetch`, insertar:

```ts
  // PARCHE CSP sobre el tema. Por defecto ('auto') Astro escribe en un <style>
  // las hojas de menos de ~4 kB, y erudite tiene 19 bloques <style> repartidos
  // por sus componentes. style-src 'self' los bloquearia y las paginas saldrian
  // sin estilos.
  build: {
    inlineStylesheets: "never",
  },
```

- [ ] **Step 6: Reconstruir y verificar que estas dos fuentes de inline desaparecen**

```bash
docker compose run --rm --no-deps build
docker compose up -d

# El script del anti-parpadeo ya no esta inline: debe dar 0
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rl "localStorage.theme" /d --include="*.html" | wc -l'

# Los <style> inlineados por Astro: debe dar 0
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rlE "<style>[^<]" /d --include="*.html" | wc -l'

# Los ficheros externos se sirven
curl -ks -o /dev/null -w 'theme-init:    %{http_code}\n' https://localhost/theme-init.js
curl -ks -o /dev/null -w 'series-scroll: %{http_code}\n' https://localhost/series-scroll.js
```

Esperado: los dos recuentos a `0`, y `200` en los dos ficheros.

- [ ] **Step 7: Verificar que solo queda el inline de Expressive Code**

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

Esperado: una lista **más corta** que la de la tarea 3, y todos los ficheros que salgan deben ser páginas con bloques de código. Comprobarlo:

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && \
       { grep -q "expressive-code" "$f" && echo "EC   $f" || echo "OTRO $f"; }
   done'
```

Esperado: solo líneas `EC`. Si aparece alguna `OTRO`, es una cuarta fuente de inline no prevista —probablemente el `prefetch`— y hay que **parar y avisar** con el nombre del fichero y el fragmento inline que contiene.

- [ ] **Step 8: Verificar en el navegador que no se rompió el comportamiento**

Abrir `https://localhost/` (aceptar el aviso de la CA local), activar el tema oscuro, y recargar con la consola abierta.

Esperado: ninguna violación de CSP, y **ningún fogonazo blanco** al recargar. El fogonazo significaría que `theme-init.js` no se está ejecutando antes del pintado.

- [ ] **Step 9: Commit**

```bash
git add public/theme-init.js public/series-scroll.js \
        src/components/MetaHead.astro src/components/SeriesReader.astro \
        astro.config.ts
git commit -m "Externaliza los dos scripts inline del tema y desactiva el inlineado de CSS

Los <script is:inline> de MetaHead y SeriesReader pasan a public/ y se
invocan con <script src> sin async ni defer, asi que siguen ejecutandose
antes del primer pintado. inlineStylesheets: 'never' evita que Astro escriba
en un <style> las hojas de menos de 4 kB.

Queda una unica fuente de contenido inline: Expressive Code.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sacar los estilos y el JS de Expressive Code del HTML

La última fuente de inline. `satteri-expressive-code` inserta un `<style>` y un `<script type="module">` en el HTML de cada página con bloques de código. Se vacían mediante el punto de extensión del propio paquete y se sirven como endpoints estáticos con huella de contenido.

**Files:**
- Create: `src/lib/expressive-code/assets.ts`
- Create: `src/pages/ec/[hash].css.ts`
- Create: `src/pages/ec/[hash].js.ts`
- Modify: `src/lib/expressive-code/index.ts` (todo el fichero)
- Modify: `src/components/MetaHead.astro` (añadir el `<link>`)
- Modify: `src/layouts/Layout.astro` (añadir el `<script>` al final del body)
- Modify: `astro.config.ts` (excluir `/ec/` del sitemap)

**Interfaces:**
- Consumes: `ecRenderer` de `src/lib/expressive-code/config.ts`, que es una `Promise<SatteriExpressiveCodeRenderer>` con la forma `{ ec, baseStyles, themeStyles, jsModules }`.
- Produces: desde `@/lib/expressive-code/assets` — `ecCss: string`, `ecJs: string`, `ecCssHash: string`, `ecJsHash: string`, `ecCssPath: string` (`/ec/<hash>.css`), `ecJsPath: string` (`/ec/<hash>.js`). Y las rutas generadas `/ec/<hash>.css` y `/ec/<hash>.js`.

- [ ] **Step 1: Crear `src/lib/expressive-code/assets.ts`**

La huella de contenido en la ruta permite que la regla de caché inmutable de `nginx.conf` siga siendo correcta sin tocarla.

```ts
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
```

- [ ] **Step 2: Vaciar los assets inline en `src/lib/expressive-code/index.ts`**

Reemplazar el fichero completo por:

```ts
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
```

- [ ] **Step 3: Crear el endpoint del CSS en `src/pages/ec/[hash].css.ts`**

Se usan endpoints estáticos de Astro y no un módulo virtual de Vite porque son API pública y estable, sin depender de internals del bundler.

```ts
import type { APIRoute, GetStaticPaths } from "astro"
import { ecCss, ecCssHash } from "@/lib/expressive-code/assets"

export const getStaticPaths: GetStaticPaths = () => [
  { params: { hash: ecCssHash } },
]

export const GET: APIRoute = () =>
  new Response(ecCss, {
    headers: { "content-type": "text/css; charset=utf-8" },
  })
```

- [ ] **Step 4: Crear el endpoint del JS en `src/pages/ec/[hash].js.ts`**

```ts
import type { APIRoute, GetStaticPaths } from "astro"
import { ecJs, ecJsHash } from "@/lib/expressive-code/assets"

export const getStaticPaths: GetStaticPaths = () => [
  { params: { hash: ecJsHash } },
]

export const GET: APIRoute = () =>
  new Response(ecJs, {
    headers: { "content-type": "text/javascript; charset=utf-8" },
  })
```

- [ ] **Step 5: Referenciar el CSS desde `MetaHead.astro`**

En el frontmatter del componente, añadir a los imports existentes:

```ts
import { ecCssPath } from "@/lib/expressive-code/assets"
```

Y en el `<head>`, justo después del bloque `<link rel="alternate" type="application/rss+xml" ...>`, insertar:

```astro
  <!-- PARCHE CSP sobre el tema: los estilos de Expressive Code, que el plugin
       emitiria en un <style> inline en cada pagina con codigo. Como fichero
       unico se cachean una vez para todo el sitio. -->
  <link rel="stylesheet" href={ecCssPath}>
```

- [ ] **Step 6: Referenciar el JS desde `Layout.astro`**

En el frontmatter, añadir a los imports existentes:

```ts
import { ecJsPath } from "@/lib/expressive-code/assets"
```

Y en el `<body>`, justo antes de `</body>`, después de `</page-grid>`, insertar:

```astro
    <!-- PARCHE CSP sobre el tema: los jsModules de Expressive Code (el boton
         de copiar de @expressive-code/plugin-frames), que el plugin emitiria
         inline. is:inline aqui significa "no lo empaquetes", no "ponlo
         inline": el tag conserva su src y es un fichero externo del propio
         dominio. type="module" ya implica defer. -->
    <script type="module" src={ecJsPath} is:inline></script>
```

- [ ] **Step 7: Excluir `/ec/` del sitemap en `astro.config.ts`**

En el `filter` de la integración `sitemap`, añadir una condición más:

```ts
    sitemap({
      filter: (page) =>
        !/\/blog\/[^/]+\/[^/]+\/?$/.test(page) &&
        !/\/authors\/[^/]+\/?$/.test(page) &&
        !page.includes("/tags/") &&
        !page.includes("/ec/"),
    }),
```

- [ ] **Step 8: Reconstruir y verificar que NO queda nada inline**

Este es el test que cierra la propiedad de "cero inline".

```bash
docker compose run --rm --no-deps build
docker compose up -d

docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

Esperado: **sin salida**.

Si aparece algún fichero, mirar qué contiene:

```bash
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'tr "\n" " " < /d/blog/introducing-v2/index.html | grep -oE "<(script|style)[^>]*> *[^ <]{0,120}"'
```

Contingencia prevista: además de `baseStyles` y `themeStyles`, el plugin inserta los `styles` que devuelve cada `ec.render()`. Expressive Code los deduplica por instancia del renderer y el renderer es único, así que tras recuperar las base styles ese conjunto suele venir vacío — pero si no lo está, aparecerá un `<style>` residual en la primera página construida. En ese caso, precalentar el renderer en `assets.ts` para que esos estilos salgan también al fichero: añadir, justo después del `await ecRenderer`,

```ts
import { createHash } from "node:crypto"
import { ExpressiveCodeBlock } from "satteri-expressive-code"
import { ecRenderer } from "./config"

const { ec, baseStyles, themeStyles, jsModules } = await ecRenderer

// Renderiza un bloque de calentamiento para que EC emita de una vez los
// estilos que solo descubre al renderizar. Van al fichero del endpoint en vez
// de acabar en un <style> inline de la primera pagina construida.
const warmup = await ec.render(
  new ExpressiveCodeBlock({ code: "const a = 1", language: "ts" }),
)
const extraStyles = [...warmup.styles].join("")

export const ecCss = baseStyles + themeStyles + extraStyles
export const ecJs = jsModules.join("\n")
```

es decir: se añade `ec` a la desestructuración, y `extraStyles` a `ecCss`. El
resto de `assets.ts` no cambia. Repetir la verificación del paso 8 hasta que
salga vacía.

- [ ] **Step 9: Verificar que los endpoints se sirven y que el código sigue estilado**

```bash
# Las rutas generadas, con su huella
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c 'ls -l /d/ec/'

# Se sirven con el content-type correcto
HASHCSS=$(docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c 'ls /d/ec/*.css' | xargs basename)
HASHJS=$(docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c 'ls /d/ec/*.js' | xargs basename)
curl -ksI "https://localhost/ec/$HASHCSS" | grep -iE 'HTTP/|content-type|cache-control'
curl -ksI "https://localhost/ec/$HASHJS"  | grep -iE 'HTTP/|content-type|cache-control'

# El CSS no esta vacio y contiene reglas de Expressive Code
curl -ks "https://localhost/ec/$HASHCSS" | wc -c
curl -ks "https://localhost/ec/$HASHCSS" | grep -c 'expressive-code'
```

Esperado: `200` en los dos, `text/css` y `text/javascript` respectivamente, `Cache-Control: public, max-age=31536000, immutable` (la regla de nginx para `.css`/`.js`), un tamaño de CSS de varios kB y un recuento de `expressive-code` mayor que 0.

- [ ] **Step 10: Verificar en el navegador que los bloques de código funcionan**

Abrir `https://localhost/blog/introducing-v2/` con la consola abierta.

Esperado: ninguna violación de CSP; los bloques de código **con colores de sintaxis y su marco**; el botón de copiar aparece al pasar el ratón y **copia de verdad** al pulsarlo (eso valida que el JS externo se cargó); y las secciones colapsables se abren y cierran.

- [ ] **Step 11: Commit**

```bash
git add src/lib/expressive-code/index.ts src/lib/expressive-code/assets.ts \
        src/pages/ec/ src/components/MetaHead.astro src/layouts/Layout.astro \
        astro.config.ts
git commit -m "Saca los estilos y el JS de Expressive Code del HTML

El plugin de Satteri inserta un <style> y un <script type=module> en cada
pagina con bloques de codigo, algo que inlineStylesheets: 'never' no cubre
porque no son hojas de estilo de Astro sino HTML renderizado del Markdown.

Se vacian baseStyles, themeStyles y jsModules a traves de
customCreateRenderer, el punto de extension documentado del paquete, y se
sirven como endpoints estaticos bajo /ec/<huella>. La huella de contenido en
la ruta mantiene correcta la cache inmutable de nginx.

Efecto colateral: los estilos base dejan de duplicarse en cada pagina con
codigo y pasan a ser un fichero unico cacheado.

Con esto el HTML generado no contiene ni un <script> ni un <style> inline.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Identidad y contenido

Convierte la demo del tema en el blog de anjeludo.

**Files:**
- Modify: `src/consts.ts` (todo el fichero)
- Modify: `src/components/AuthorCard.astro:6,20` (importa `twitter.svg`, que esta tarea borra)
- Create: `src/assets/icons/x.svg`
- Delete: `src/assets/icons/twitter.svg`
- Delete: `src/content/blog/introducing-v2/`, `src/content/blog/v1-posts/`, `src/content/authors/enscribe.md`, `src/content/projects/project-a.md`, `src/content/projects/project-b.md`, `src/content/projects/project-c.md`, `src/content/projects/placeholder.png`
- Create: `src/content/authors/anjeludo.md`
- Create: `src/content/blog/how-to-publish-a-post/index.md`
- Create: `src/content/blog/how-to-publish-a-post/cover.png`

**Interfaces:**
- Consumes: el esquema de colecciones de `src/content.config.ts`, que **no se modifica**. `blog` exige `title`, `description`, `date` y `authors` (referencias a `authors`); acepta `order`, `tags`, `image`, `draft`. `authors` exige `name` y `avatar` (una URL o una ruta que empiece por `/`); acepta `pronouns`, `bio`, `mail`, `socials`.
- Produces: el contenido real del sitio. La tarea 8 lo referencia en el README.

- [ ] **Step 1: Reescribir `src/consts.ts`**

Se quita `/authors` de la navegación: con un solo autor esa página no aporta. Sus rutas siguen generándose, solo no van en el menú. Y no se pone correo en las redes.

```ts
import type { SvgComponent } from "astro/types"
import GitHub from "@/assets/icons/github.svg"
import RSS from "@/assets/icons/rss.svg"
import X from "@/assets/icons/x.svg"

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

export const SOCIALS: { href: string; label: string; icon: SvgComponent }[] = [
  { href: "https://github.com/anjeludo", label: "GitHub", icon: GitHub },
  { href: "https://x.com/anjeludo", label: "X", icon: X },
  { href: "/rss.xml", label: "RSS", icon: RSS },
]
```

- [ ] **Step 2: Crear `src/assets/icons/x.svg` y borrar `twitter.svg`**

Mismo formato que el resto de iconos del tema: `width="1em" height="1em"`, `viewBox="0 0 24 24"`, `fill="currentColor"`.

```html
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584l-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zm-1.29 19.491h2.039L6.486 3.24H4.298z"/></svg>
```

```bash
rm src/assets/icons/twitter.svg
```

- [ ] **Step 2b: Actualizar `AuthorCard.astro`, que importa el icono borrado**

`src/components/AuthorCard.astro` importa `twitter.svg` y lo usa en su mapa de
iconos. Sin este cambio el build falla con un error de módulo no encontrado.

En la línea 6, sustituir

```ts
import Twitter from "@/assets/icons/twitter.svg"
```

por

```ts
import X from "@/assets/icons/x.svg"
```

Y en el mapa `ICONS` (hacia la línea 20), sustituir

```ts
  twitter: { label: "Twitter", icon: Twitter },
```

por

```ts
  x: { label: "X", icon: X },
```

Las claves que no estén en `ICONS` caen al icono genérico `Link`, así que el
perfil del autor del paso 4 usa la clave `x` para que le toque el logo correcto.

- [ ] **Step 2c: Verificar que no queda ninguna referencia al icono borrado**

```bash
grep -rn 'icons/twitter\.svg' src/ || echo "SIN IMPORTS DE twitter.svg"
grep -rn 'icon: Twitter' src/ || echo "SIN USOS DE Twitter"
```

Esperado: las dos líneas de confirmación.

Los `<meta name="twitter:card">` y compañía de `MetaPage.astro` y
`MetaPost.astro` **no se tocan**: son los nombres estándar de las tarjetas
sociales, que X sigue leyendo. No son referencias al icono.

- [ ] **Step 3: Borrar el contenido de demo**

```bash
rm -rf src/content/blog/introducing-v2 src/content/blog/v1-posts
rm -f src/content/authors/enscribe.md
rm -f src/content/projects/project-a.md src/content/projects/project-b.md \
      src/content/projects/project-c.md src/content/projects/placeholder.png
find src/content -type f | sort
```

Esperado: sin salida, o solo lo que se cree en los pasos siguientes.

- [ ] **Step 4: Crear el perfil del autor en `src/content/authors/anjeludo.md`**

`avatar` apunta a un fichero que ya existe en `public/static/`, para no dejar una ruta rota. Se cambia por una foto real cuando la haya.

```markdown
---
name: "anjeludo"
avatar: "/static/logo.svg"
bio: "Notes on things I build and break."
socials:
  github: "https://github.com/anjeludo"
  x: "https://x.com/anjeludo"
---
```

- [ ] **Step 5: Crear la imagen de portada del post de ejemplo**

`image` en el frontmatter se resuelve contra la carpeta del post, así que la imagen vive junto al `index.md`. Se reutiliza una que ya trae el tema para no inventar un binario.

```bash
mkdir -p src/content/blog/how-to-publish-a-post
cp public/static/1200x630.png src/content/blog/how-to-publish-a-post/cover.png
ls -l src/content/blog/how-to-publish-a-post/
```

Esperado: `cover.png` presente y de tamaño no nulo.

- [ ] **Step 6: Crear el post de ejemplo en `src/content/blog/how-to-publish-a-post/index.md`**

Hace el papel de `content/posts/como-publicar-un-post.md` del proyecto de Hugo: documenta el frontmatter y ejercita lo que de verdad se va a usar, así que además sirve de prueba de humo del pipeline de Markdown.

```markdown
---
title: "How to publish a post"
description: "The frontmatter this blog expects, and the Markdown features available in a post."
date: 2026-09-17
tags: ["meta", "astro"]
authors: ["anjeludo"]
image: ./cover.png
draft: false
---

A post is a folder under `src/content/blog/` with an `index.md` inside. The
folder name is the URL: `src/content/blog/how-to-publish-a-post/` is served at
`/blog/how-to-publish-a-post/`.

## Frontmatter

`title`, `description`, `date` and `authors` are required; the build fails
without them. `authors` holds references to files in `src/content/authors/`, by
filename without the extension.

`tags`, `image`, `draft` and `order` are optional. `image` resolves against the
post's own folder, so `./cover.png` sits next to this file.

:::note
Unlike Hugo, a future `date` still publishes. To hide a post, set
`draft: true`.
:::

## Code

Fenced blocks get syntax highlighting, a frame and a copy button:

```ts title="example.ts"
export const greet = (name: string): string => `Hello, ${name}`
```

Inline code can be highlighted too, with the `` `code{:lang}` `` annotation:
`const x = 1{:ts}`.

Shell blocks drop the line numbers:

```bash
docker compose run --rm --no-deps build
```

## Callouts

Five variants: `note`, `tip`, `warning`, `caution` and `important`. Add
`{closed}` to render one collapsed.

:::tip
Callouts are `<details>` elements, so they are open by default and the reader
can fold them away.
:::

:::warning{closed}
This one starts collapsed.
:::

## Math

Inline math like $e^{i\pi} = -1$, and display math:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

It renders to native MathML through Temml, so there is no client-side layout
step.

## Images

![The cover image of this post](./cover.png)
```

- [ ] **Step 7: Reconstruir y verificar que todo compila y responde**

`astro check` valida los esquemas Zod, así que un frontmatter mal puesto rompe el build aquí y no en el navegador.

```bash
docker compose run --rm --no-deps build
docker compose up -d

curl -ks -o /dev/null -w 'raiz:      %{http_code}\n' https://localhost/
curl -ks -o /dev/null -w 'blog:      %{http_code}\n' https://localhost/blog/
curl -ks -o /dev/null -w 'post:      %{http_code}\n' https://localhost/blog/how-to-publish-a-post/
curl -ks -o /dev/null -w 'projects:  %{http_code}\n' https://localhost/projects/
curl -ks -o /dev/null -w 'authors:   %{http_code}\n' https://localhost/authors/
curl -ks -o /dev/null -w 'tags:      %{http_code}\n' https://localhost/tags/
curl -ks -o /dev/null -w 'rss:       %{http_code}\n' https://localhost/rss.xml
```

Esperado: `200` en todas. `/projects/` con la colección vacía es el caso frágil: si devuelve 500 o rompe el build, añadir el manejo del caso vacío en `src/pages/projects/index.astro` y anotarlo.

- [ ] **Step 8: Verificar la identidad y que no queda rastro de la demo**

```bash
# El titulo propio esta, y el del tema no
curl -ks https://localhost/ | grep -o '<title>[^<]*</title>'
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -rli "enscribe\|astro-erudite" /d --include="*.html" | wc -l'

# Las rutas de la demo ya no existen
curl -ks -o /dev/null -w 'demo v2:  %{http_code}\n' https://localhost/blog/introducing-v2/

# Y sigue sin haber nada inline
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'
```

Esperado: el `<title>` contiene `anjeludo blog`; el recuento de menciones a la demo es `0`; `demo v2: 404`; y la última verificación sin salida.

- [ ] **Step 9: Verificar el post en el navegador**

Abrir `https://localhost/blog/how-to-publish-a-post/` con la consola abierta.

Esperado: ninguna violación de CSP; los tres bloques de código con colores y botón de copiar; el código inline `const x = 1` resaltado; los tres callouts con su icono, y el de `warning` colapsado; las dos fórmulas renderizadas como MathML; la imagen de portada visible (lo que confirma que sharp funciona); y en la barra lateral los tres iconos de GitHub, X y RSS, sin el de correo.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Sustituye la demo del tema por la identidad y el contenido propios

Sitio en en-US con el titulo, la descripcion y las redes de anjeludo, sin
correo y con el logo de X en lugar del pajaro de Twitter. /authors sale de la
navegacion: con un solo autor la pagina no aporta, aunque sus rutas se siguen
generando.

Fuera el post introducing-v2 (~1300 lineas, es la documentacion del tema), los
v1-posts, los tres proyectos de relleno y el autor de ejemplo. En su lugar, un
post que documenta el frontmatter y ejercita callouts, bloques de codigo,
codigo inline, matematicas e imagenes, asi que hace tambien de prueba de humo
del pipeline de Markdown.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Override de producción

Añade el despliegue con dominio real y Let's Encrypt sin tocar el entorno local y sin escribir el dominio en ningún fichero versionado.

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `Caddyfile.prod`
- Create: `.env.example`
- Modify: `astro.config.ts` (`site` desde el entorno)

**Interfaces:**
- Consumes: los servicios `build` y `caddy` del `docker-compose.yml` de las tareas 2 y 3.
- Produces: la variable de entorno `SITE_URL` que lee `astro.config.ts`, y `SITE_DOMAIN`/`ACME_EMAIL` que lee `Caddyfile.prod`. Todas vienen de `.env`.

- [ ] **Step 1: Hacer que `site` venga del entorno en `astro.config.ts`**

Es el equivalente del `HUGO_BASEURL` del proyecto de Hugo: `hugo.yaml` se quedaba en localhost y producción lo inyectaba. `site` alimenta las URL canónicas, el RSS y el sitemap.

Reemplazar la línea

```ts
  site: "https://astro-erudite.vercel.app",
```

por

```ts
  // El dominio nunca se escribe en un fichero versionado: en local esto es
  // localhost, y docker-compose.prod.yml inyecta SITE_URL desde .env.
  site: process.env.SITE_URL ?? "https://localhost",
```

- [ ] **Step 2: Crear `.env.example`**

```ini
# Copia este fichero a .env y rellena los valores.
# .env esta ignorado por git: no subas tu dominio ni tu correo al repositorio.

# Dominio sin https:// y sin barra final.
SITE_DOMAIN=miblog.com

# Correo para Let's Encrypt: avisos de caducidad de certificados.
ACME_EMAIL=tu-correo@ejemplo.com
```

- [ ] **Step 3: Crear `Caddyfile.prod`**

Sin bloque `www`, a diferencia del proyecto de Hugo. El motivo va escrito en el propio fichero para quien lo lea dentro de un año.

```caddyfile
# Configuracion de PRODUCCION. El dominio y el email se leen de .env
# (copia .env.example a .env y rellenalos).
#
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

{
    # Let's Encrypt usa este correo para avisarte si un certificado va a
    # caducar sin renovarse. Caddy pide y renueva los certificados solo.
    email {$ACME_EMAIL}

    servers {
        protocols h1 h2 h3
    }
}

{$SITE_DOMAIN} {
    encode zstd gzip

    header {
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        # style-src-attr cubre los atributos style="" y es OBLIGATORIO:
        # Expressive Code colorea cada token de codigo con una
        # InlineStyleAnnotation, que escribe un style="--0:...;--1:...".
        # No abre 'unsafe-inline' a los bloques <style>, que siguen bloqueados
        # por style-src 'self'.
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        Permissions-Policy "geolocation=(), camera=(), microphone=()"
        -Server

        # HSTS - ACTIVAR SOLO tras comprobar que el certificado real funciona.
        # Si lo activas con el TLS roto, los navegadores que ya visitaron el
        # sitio se negaran a entrar durante todo el max-age y no hay forma
        # rapida de revertirlo.
        # Strict-Transport-Security "max-age=31536000; includeSubDomains"
    }

    reverse_proxy nginx:8080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        # Sobrescribe en vez de anadir: al ser el borde, impide que un cliente
        # falsifique la cadena de X-Forwarded-For.
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# NO hay bloque de www, a diferencia del proyecto de Hugo.
#
# miblog.com ya es un subdominio, asi que "www" delante no tiene sentido,
# y YDNS entrega registros de host concretos: www.miblog.com no resolveria.
# Caddy pediria un certificado para ese nombre, fallaria el desafio ACME y
# reintentaria llenando el log de errores.
#
# El dia que haya un dominio propio con registro www, descomentar:
#
# www.{$SITE_DOMAIN} {
#     import seguridad
#     redir https://{$SITE_DOMAIN}{uri} permanent
# }
```

- [ ] **Step 4: Crear `docker-compose.prod.yml`**

```yaml
# Override de PRODUCCION. No sustituye al fichero base, lo complementa:
#
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
#
# En local sigues usando simplemente 'docker compose up -d'.
services:
  build:
    environment:
      # Astro incrusta site en canonical, RSS y sitemap. Se inyecta aqui para
      # que el mismo astro.config.ts (con localhost) sirva en los dos entornos.
      SITE_URL: "https://${SITE_DOMAIN:?falta SITE_DOMAIN: copia .env.example a .env}/"

  caddy:
    environment:
      SITE_DOMAIN: "${SITE_DOMAIN:?falta SITE_DOMAIN: copia .env.example a .env}"
      ACME_EMAIL: "${ACME_EMAIL:?falta ACME_EMAIL: copia .env.example a .env}"
    volumes:
      - ./Caddyfile.prod:/etc/caddy/Caddyfile:ro
```

Ojo: el `build` de este override **solo** añade `environment`. Los `volumes` y el resto los hereda del fichero base; no hay que repetirlos.

- [ ] **Step 5: Verificar que sin `.env` el despliegue se detiene con un mensaje claro**

```bash
ls .env 2>/dev/null && echo "OJO: hay un .env, moverlo antes de esta prueba"
docker compose -f docker-compose.yml -f docker-compose.prod.yml config 2>&1 | tail -3
```

Esperado: un error que mencione `falta SITE_DOMAIN: copia .env.example a .env`. Que falle aquí es el comportamiento correcto: es mejor que arrancar mal configurado.

- [ ] **Step 6: Verificar que con `.env` el dominio se inyecta de verdad**

Se usa un `.env` de prueba, no el real, para no pedir un certificado a Let's Encrypt desde la máquina de desarrollo. Solo se comprueba la etapa de build, con `--no-deps` para no arrancar Caddy.

```bash
cat > /tmp/env-prueba <<'EOF'
SITE_DOMAIN=ejemplo.invalid
ACME_EMAIL=nadie@ejemplo.invalid
EOF
cp /tmp/env-prueba .env

# El override resuelve las variables
docker compose -f docker-compose.yml -f docker-compose.prod.yml config | grep -A2 'SITE_URL\|ACME_EMAIL'

# Y el build usa el dominio en canonical, RSS y sitemap
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --no-deps build
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -o "https://ejemplo.invalid[^\"]*" /d/index.html | head -3;
   echo "--- rss ---"; grep -o "https://ejemplo.invalid[^<]*" /d/rss.xml | head -2;
   echo "--- sitemap ---"; grep -o "https://ejemplo.invalid[^<]*" /d/sitemap-0.xml | head -2'
```

Esperado: `SITE_URL: https://ejemplo.invalid/`, y los tres bloques mostrando URL con `ejemplo.invalid`.

- [ ] **Step 7: Volver a dejar el entorno local limpio**

El `.env` de prueba se borra y se reconstruye en modo local, para no dejar el volumen con el dominio falso incrustado.

```bash
rm -f .env
docker compose run --rm --no-deps build
docker compose up -d
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'grep -c "ejemplo.invalid" /d/index.html || echo "0 (correcto)"'
curl -ks https://localhost/ | grep -o 'https://localhost[^"]*' | head -2
git status --short | grep -c '\.env$'
```

Esperado: ninguna aparición de `ejemplo.invalid`, URL con `localhost`, y `0` en el último comando (`.env` está ignorado, no debe aparecer en git).

- [ ] **Step 8: Commit**

```bash
git add docker-compose.prod.yml Caddyfile.prod .env.example astro.config.ts
git commit -m "Añade el despliegue de produccion sin tocar el entorno local

astro.config.ts lee site de SITE_URL con localhost por defecto, y el override
lo inyecta desde SITE_DOMAIN en .env, igual que HUGO_BASEURL en el proyecto de
Hugo. Si falta una variable el despliegue se detiene con un mensaje claro en
vez de arrancar mal configurado.

Caddyfile.prod no lleva bloque de www: miblog.com ya es un subdominio y
YDNS no serviria www.miblog.com, asi que Caddy fallaria el desafio ACME
en bucle. Queda comentado para el dia que haya un dominio propio.

HSTS escrito y comentado, hasta validar el certificado real.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentación y remoto upstream

Cierra el repo: documentación de usuario, lo no obvio para quien lo retome, y el remoto que hace posible actualizar el tema.

**Files:**
- Modify: `README.md` (reemplaza el de erudite; español)
- Create: `CLAUDE.md` (inglés)
- Modify: nada de código

**Interfaces:**
- Consumes: todo lo anterior, incluidos los resultados anotados en la tarea 2 paso 5 (si Astro vacía `outDir` por sí solo) y la tarea 5 paso 8 (si hizo falta el bloque de calentamiento).
- Produces: nada que consuma código.

- [ ] **Step 1: Añadir el remoto upstream**

erudite es una plantilla, no un tema: no hay `themes/` que borrar y el repo *es* el proyecto. La única vía de actualización es diffear contra upstream, y para eso hace falta el remoto.

```bash
git remote add upstream https://github.com/jktrn/astro-erudite.git
git remote -v
git fetch upstream --depth 50
git log --oneline upstream/main -3
```

Esperado: `upstream` listado como fetch y push, y los últimos commits del tema.

- [ ] **Step 2: Escribir el `README.md` en español**

Reemplaza por completo el de erudite. Sigue la estructura del README del proyecto de Hugo: arquitectura, uso diario, estructura, escribir posts, seguridad, despliegue, pendientes, licencias.

Contenido obligatorio, además de lo anterior:

- La tabla de las cinco etapas con imagen, red y escritura de cada una, tal como quedó en el `docker-compose.yml` (con la versión de bun anotada en la tarea 2).
- Los comandos del día a día: `docker compose run --rm --no-deps build` para contenido, `docker compose up -d` cuando cambie `bun.lock` o el tema.
- **Que el tema es una plantilla, no un tema**: no hay `themes/`, se actualiza con `git fetch upstream` y diff manual, y los parches de CSP hay que reaplicarlos.
- La sección de despliegue con lo que implica YDNS: el servidor está en una red doméstica, hay que abrir **80, 443/tcp y 443/udp** en el router, el 80 no es opcional porque Caddy lo necesita para el desafío ACME, y hace falta el cliente de YDNS actualizando la IP. Y que **no hay registro `www`**, a diferencia del proyecto de Hugo.
- Activar HSTS después de validar el certificado, nunca antes.
- Las comprobaciones tras el despliegue, con `curl -sI` sobre el dominio real.
- **Pendiente de valorar**: sin rate limiting, igual que en el proyecto de Hugo; si llega tráfico hostil, `fail2ban` sobre los logs de Caddy o su módulo `rate_limit`.
- Licencias: astro-erudite es MIT (© 2026 enscribe), `LICENSE` en la raíz.

- [ ] **Step 3: Escribir el `CLAUDE.md` en inglés**

Cubre lo que no es obvio leyendo un solo fichero. Contenido obligatorio:

- **The theme is a template, not a theme.** No `themes/` directory; the repo *is* the project. Updating means `git fetch upstream` and diffing by hand. There is no override layer protecting local changes.
- **The five CSP patches and why they exist**, as a table: `astro.config.ts` (`inlineStylesheets: 'never'`), `MetaHead.astro` and `SeriesReader.astro` (`is:inline` → `<script src>`), `lib/expressive-code/index.ts` (blanked `baseStyles`/`themeStyles`/`jsModules`), plus the `src/pages/ec/` endpoints. **These are what to reapply after every upstream merge.**
- **`style-src-attr 'unsafe-inline'` is load-bearing and must not be removed**: `@expressive-code/core` applies syntax colors with an `InlineStyleAnnotation` that writes a `style=""` attribute on every token, and `lib/expressive-code/inline.ts` does the same for `` `code{:.scope}` ``. `style-src 'self'` still blocks `<style>` blocks.
- **`is:inline` on a `<script src>` means "don't bundle", not "put it inline".** The tag keeps its `src` and is still an external same-origin file. Do not "fix" it.
- **The writable overlays in the `build` stage**, and why sources are mounted one by one instead of `.:/src:ro` (a writable volume nested under a read-only bind cannot create its mountpoint). **Adding a config file at the project root means adding its mount to the compose file**, or the build will not see it.
- **Two behaviour differences from the Hugo project**: whether Astro empties `outDir` on its own (record the answer found in Task 2 Step 5, and whether the explicit `find -delete` was needed), and that `astro check` fails the build on bad frontmatter, unlike Hugo. Also that a future `date` still publishes — use `draft: true`.
- **sharp is mandatory**: the theme uses `<Image>` in three places, and `bun.lock` carries the musl variants that make it work on Alpine.
- **The verification commands**, verbatim, including the zero-inline check.
- If the warm-up block from Task 5 Step 8 was needed, document why.

- [ ] **Step 4: Verificar la documentación contra la realidad**

Una documentación que miente es peor que no tenerla, así que se comprueban las afirmaciones comprobables.

```bash
# Los comandos que el README anuncia funcionan
docker compose run --rm --no-deps build
docker compose up -d
curl -ks -o /dev/null -w 'raiz: %{http_code}\n' https://localhost/

# Las rutas y ficheros que menciona el README existen
ls docker-compose.yml docker-compose.prod.yml Caddyfile Caddyfile.prod \
   nginx.conf .env.example astro.config.ts src/consts.ts LICENSE

# La version de imagen que dice el README es la que hay en el compose
grep -n 'image:' docker-compose.yml

# Los cinco parches de CSP que lista CLAUDE.md estan de verdad
grep -n 'inlineStylesheets' astro.config.ts
grep -n 'theme-init.js' src/components/MetaHead.astro
grep -n 'series-scroll.js' src/components/SeriesReader.astro
grep -n 'baseStyles: ""' src/lib/expressive-code/index.ts
ls src/pages/ec/
```

Esperado: todos los comandos sin error, y cada `grep` con una coincidencia. Si alguno falla, corregir el documento, no el código.

- [ ] **Step 5: Verificación final de todo el proyecto**

```bash
docker compose down
docker compose up -d
sleep 5

echo "--- codigos de respuesta ---"
for p in / /blog/ /blog/how-to-publish-a-post/ /projects/ /authors/ /tags/ /rss.xml /sitemap-index.xml /theme-init.js /series-scroll.js; do
  printf '%-34s %s\n' "$p" "$(curl -ks -o /dev/null -w '%{http_code}' "https://localhost$p")"
done
printf '%-34s %s\n' "/no-existe" "$(curl -ks -o /dev/null -w '%{http_code}' https://localhost/no-existe)"

echo "--- cabeceras ---"
curl -ksI https://localhost/ | grep -iE 'content-security-policy|x-frame-options|x-content-type|referrer-policy|permissions-policy'

echo "--- cero inline (debe salir vacio) ---"
docker run --rm -v blog-astro_site_public:/d:ro alpine sh -c \
  'find /d -name "*.html" | while read f; do
     tr "\n" " " < "$f" | grep -qE "<(script|style)[^>]*> *[^ <]" && echo "$f"
   done'

echo "--- metodos no permitidos ---"
curl -ks -o /dev/null -w 'POST: %{http_code}\n' -X POST https://localhost/

echo "--- git limpio ---"
git status --short
```

Esperado: `200` en todo menos `/no-existe` (`404`); las cinco cabeceras presentes; la comprobación de inline **sin salida**; `POST: 405`; y `git status` sin cambios sin commitear salvo los documentos de este paso.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Documenta el proyecto en README.md y CLAUDE.md

README en español, documentacion de usuario: las cinco etapas, el uso diario,
como escribir posts y el despliegue, incluido lo que implica YDNS (servidor en
red domestica, puertos 80 y 443 tcp/udp abiertos, sin registro www).

CLAUDE.md en ingles, lo no obvio: que el tema es una plantilla y no un tema y
por tanto no hay capa de overrides, los cinco parches de CSP que hay que
reaplicar tras cada merge de upstream, por que style-src-attr no se puede
quitar, los overlays escribibles del build y las diferencias de comportamiento
frente a Hugo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
