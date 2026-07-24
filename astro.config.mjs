// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Static storefront + Vercel adapter. Every page prerenders for speed, EXCEPT routes that
// opt out with `export const prerender = false` (the catalog, the admin panel, and the /api
// endpoints) — those run as on-demand Vercel serverless functions so they read live Supabase data.
export default defineConfig({
  site: 'https://app.teiabakery.com.ar',
  output: 'static',
  adapter: vercel({ maxDuration: 30 }),
  // Sin scripts INLINE: en el build de producción Astro inlinea los scripts chicos, y la CSP
  // estricta (`script-src 'self'`, sin 'unsafe-inline') los bloquea → la página queda muerta.
  // Con el límite en 0 todos salen como archivos externos y la CSP funciona sin aflojarla.
  // (Ojo: esto NO se ve en `astro dev`, donde los scripts siempre son externos.)
  vite: { build: { assetsInlineLimit: 0 } },
});
