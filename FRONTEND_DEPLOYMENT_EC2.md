# Frontend Deployment Guide (EC2)

This guide shows how to deploy this React frontend on an EC2 instance (including the same EC2 where your MCP server runs).

## Recommended plan

- **Yes, you can deploy on the same EC2** as MCP.
- Best practical setup:
  - Run MCP on its own port (for example `9000`)
  - Serve frontend static build through **Nginx** on `80/443`
  - Use a domain + HTTPS (Let's Encrypt)
- Keep frontend and MCP as separate services on the same machine.

This gives you simple operations now, while still being production-friendly.

---

## 1) Prerequisites

- EC2 Ubuntu instance (22.04 or similar)
- Security group open:
  - `22` (SSH)
  - `80` (HTTP)
  - `443` (HTTPS)
- Node.js `18+` and npm
- Nginx installed
- (Optional but strongly recommended) Domain pointed to EC2 public IP

---

## 2) Clone and build frontend

```bash
cd /var/www
sudo git clone <your-repo-url> ailifebot-frontend
cd ailifebot-frontend
npm install
npm run build
```

After this, production files are in:

`/var/www/ailifebot-frontend/build`

---

## 3) Nginx config (recommended production setup)

Create config:

```bash
sudo nano /etc/nginx/sites-available/ailifebot-frontend
```

Use:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    root /var/www/ailifebot-frontend/build;
    index index.html;

    # React SPA routing
    location / {
        try_files $uri /index.html;
    }

    # Optional caching for static assets
    location /static/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/ailifebot-frontend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4) Enable HTTPS (recommended)

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

Verify auto-renew:

```bash
sudo certbot renew --dry-run
```

---

## 5) CORS and backend notes

Your frontend calls backend APIs (Lambda/API Gateway + optional Mongo API). Confirm:

- API Gateway CORS allows your frontend domain (or `*` where acceptable)
- Mongo API CORS allows your frontend domain
- Any MCP or internal API endpoint needed by browser is publicly reachable OR proxied through your backend

Important for this codebase:

- Query/analysis API URLs are currently hardcoded in `src/services/chatApi.js`
- Mongo API is read from `REACT_APP_MONGO_API_URL`

If you change backend URLs, update code/env and rebuild.

---

## 6) Deploy updates (after code changes)

```bash
cd /var/www/ailifebot-frontend
git pull
npm install
npm run build
sudo systemctl reload nginx
```

---

## 7) Optional quick deployment (not preferred for production)

You can also serve the `build` folder with Node:

```bash
npm install -g serve
serve -s build -l 3000
```

But this is better only for quick testing. For production, use Nginx.

---

## 8) Same-EC2 architecture (simple)

- Nginx: serves frontend on `443`
- MCP server: runs separately on `9000` (or your port)
- Optional Mongo/other service: separate process/port

Keep each service isolated via:

- `systemd` services (recommended)
- distinct ports
- logs per service

---

## 9) Troubleshooting

- `502/504` from Nginx:
  - usually upstream service/port issue (if proxying)
- React routes return 404 on refresh:
  - ensure `try_files $uri /index.html;` is present
- Frontend loads but API fails:
  - check browser console + Network tab
  - check CORS headers on backend
- Old UI after deploy:
  - hard refresh browser
  - verify `build/static/*` files updated

---

## 10) Suggested next improvement

If traffic grows, keep frontend on this EC2 for now, but later move static hosting to S3 + CloudFront and keep EC2 for MCP/app services only.

