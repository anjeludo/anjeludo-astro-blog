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
