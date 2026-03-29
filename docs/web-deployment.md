# Web Deployment Guide

The `apps/web` React SPA supports four deployment modes.

## Prerequisites

- Agent Gateway running and reachable
- `JWT_SECRET` set to a secure 32+ char string

---

## Mode 1: Static Hosting (Vercel / Netlify / CDN)

```bash
pnpm --filter @openAwork/shared build
pnpm --filter @openAwork/shared-ui build
pnpm --filter @openAwork/web-client build
pnpm --filter @openAwork/web build
```

Upload `apps/web/dist/` to your CDN. Configure your hosting to redirect all 404s to `index.html`.

Set Vite proxy targets via environment variable at build time:

```bash
VITE_GATEWAY_URL=https://api.example.com pnpm --filter @openAwork/web build
```

Or configure a reverse proxy (see Mode 3).

---

## Mode 2: Gateway-Embedded Static Serve

The Gateway automatically serves the Web UI when `apps/web/dist/` exists.

```bash
pnpm --filter @openAwork/web build
pnpm --filter @openAwork/agent-gateway start
```

Access at `http://localhost:3000`. The gateway serves the SPA from `/` and falls back to `index.html` for client-side routing.

---

## Mode 3: Docker (Recommended for Self-Hosting)

```bash
docker-compose up --build
```

Services:

- `web` — Nginx serving the SPA on port `5173`
- `gateway` — Fastify API on port `3000`
- `postgres` — PostgreSQL 16
- `redis` — Redis 7

Nginx proxies `/auth/`, `/sessions/` to the Gateway automatically.

Environment variables (set in `docker-compose.yml` or `.env`):

| Variable         | Default        | Required   |
| ---------------- | -------------- | ---------- |
| `JWT_SECRET`     | `change-me...` | Yes (prod) |
| `JWT_EXPIRES_IN` | `15m`          | No         |
| `DATABASE_URL`   | postgres://... | Yes        |
| `REDIS_URL`      | redis://...    | Yes        |

---

## Mode 4: PWA — Install to Desktop

After loading the app in a browser, users can install it:

- **Chrome/Edge**: Click the install icon in the address bar
- **Safari (iOS)**: Share → Add to Home Screen

The PWA caches the UI shell for offline use. API calls still require network.

---

## Reverse Proxy (Nginx/Caddy) — Single Domain

To serve both Web UI and Gateway on one domain:

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    location /auth/ { proxy_pass http://localhost:3000/auth/; }
    location /sessions/ {
        proxy_pass http://localhost:3000/sessions/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location / { proxy_pass http://localhost:5173; }
}
```

> WSS (WebSocket Secure) requires the reverse proxy to forward `Upgrade` headers as shown above.
