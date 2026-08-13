/**
 * A file under `deck/public/`, as a URL the running document can fetch.
 *
 * Vite copies `public/` to the build root unchanged. Locally that root is `/`;
 * the production nginx mount is `/pitch/`. Hardcoding `/brand/…` or
 * `/models/…` therefore 200s as `index.html` on CloudFront (the SPA fallback)
 * and the counsel GLB / founder JPEGs never arrive. `import.meta.env.BASE_URL`
 * is the one value that is `/` in `npm run dev` and `/pitch/` in the release
 * build (`DECK_BASE=/pitch/`).
 */
export function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const cleaned = path.replace(/^\/+/, '')
  return `${base}${cleaned}`
}
