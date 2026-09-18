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
