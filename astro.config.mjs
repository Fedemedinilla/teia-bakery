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
  redirects: {
    '/': '/catalogo',
  },
});
