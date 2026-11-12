# CamNC Website

Just https://github.com/mhyfritz/astro-landing-page adopted for CamNC.

## Deployment

The site is a static Astro build served by the `camnc-website` Cloudflare Worker (static assets only, plainoss
account, `wrangler.jsonc`), deployed through Cloudflare Workers Builds connected to this repository:

| Setting                 | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| Root directory          | `apps/website`                                             |
| Build command           | `cd ../.. && pnpm turbo run build --filter @wbcnc/website` |
| Deploy command (`main`) | `pnpm exec wrangler deploy`                                |
| Custom domains          | `www.camnc.app`, `camnc.app`                               |

`pnpm run deploy` builds and deploys by hand.
