# 🍋 Limoo — لیمو

**A single-user Xray-core proxy management panel for Railway deployment.**

<p dir="rtl">

لیمو یک پنل مدیریت پروکسی ساده و قدرتمند برای استقرار روی Railway است.
با استفاده از Xray-core، از پروتکل‌های VLESS و Trojan با شبکه‌های WebSocket و REALITY پشتیبانی می‌کند.

</p>

---

## Features / ویژگی‌ها

- ✅ **VLESS & Trojan** protocol support
- ✅ **WebSocket (WS)** and **REALITY** network types
- ✅ **Dark theme** with Persian RTL interface
- ✅ **QR code** generation for client configs
- ✅ **Traffic monitoring** per client
- ✅ **Data limit & expiry** per client
- ✅ **Auto-config generation** from database state
- ✅ **Persistent storage** via Railway volume
- ✅ **One-click deployment** on Railway

## Architecture / معماری

```
┌─────────────────────────────────────────────────┐
│                  Railway Edge                    │
│              (TLS Termination)                   │
└──────────┬────────────────────┬─────────────────┘
           │                    │
     HTTPS │ TCP Proxy    HTTPS │
           ▼                    ▼
┌──────────────────┐   ┌──────────────────┐
│   Express.js     │   │  Xray Reality    │
│   (Admin Panel)  │   │  (Port 8443)     │
│   + WS Proxy     │   │  VLESS/Trojan    │
│   (Port $PORT)   │   │  + REALITY       │
└────────┬─────────┘   └──────────────────┘
         │
    HTTP │ WS
         ▼
┌──────────────────┐   ┌──────────────────┐
│  Xray WS Listener│   │  Xray Stats API  │
│  (Port 10080)    │   │  (Port 10085)    │
│  VLESS/Trojan    │   │  Traffic Stats   │
│  + WebSocket     │   │                  │
└──────────────────┘   └──────────────────┘
         │
         ▼
┌──────────────────┐
│     SQLite       │
│  /data/limoo/    │
│  limoo.db        │
│  config.json     │
└──────────────────┘
```

## Environment Variables / متغیرهای محیطی

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Express server port (set by Railway) |
| `LIMOO_USER` | `admin` | Admin panel username |
| `LIMOO_PASS` | `changeme` | Admin panel password |
| `LIMOO_DOMAIN` | auto | Your Railway app domain (auto-detected) |
| `LIMOO_TCP_DOMAIN` | `localhost` | Domain for Reality TCP proxy |
| `LIMOO_TCP_PORT` | `443` | Port for Reality TCP proxy |
| `DATA_DIR` | `/data/limoo` | Persistent data directory |

## Railway Setup / راه‌اندازی روی Railway

### 1. Deploy / استقرار

1. Push this repo to GitHub
2. Go to [Railway](https://railway.app) → New Project → Deploy from GitHub
3. Select your repository

### 2. Persistent Volume / حافظه دائمی

1. In Railway dashboard, go to your service
2. Go to **Settings** → **Volumes**
3. Add a new volume:
   - Mount Path: `/data`
   - This stores the database and Xray config

### 3. TCP Proxy / پروکسی TCP (for REALITY)

1. Go to **Settings** → **Networking**
2. Enable **TCP Proxy** for port `8443`
3. Railway will assign a public TCP endpoint
4. Set `LIMOO_TCP_DOMAIN` and `LIMOO_TCP_PORT` env vars accordingly

### 4. Environment Variables / متغیرها

Go to **Variables** tab and set:

```
LIMOO_USER=admin
LIMOO_PASS=your-secure-password
LIMOO_TCP_DOMAIN=your-tcp-proxy-domain.up.railway.app
LIMOO_TCP_PORT=443
```

### 5. Access / دسترسی

Once deployed, access the panel at:
```
https://your-app.up.railway.app
```

Login with your `LIMOO_USER` / `LIMOO_PASS` credentials.

## How It Works / نحوه کار

### Configuration Generation

The Xray config is generated dynamically from the database:

1. All enabled inbounds are read from SQLite
2. For each inbound, valid clients are filtered (not expired, under data limit, enabled)
3. A complete `config.json` is written to `/data/limoo/config.json`
4. Xray-core is started/restarted with the new config

### Traffic Monitoring

1. Xray Stats API runs on `localhost:10085`
2. Every 30 seconds, the dashboard queries traffic stats via `xray api statsquery`
3. Traffic is accumulated per client email in the `traffic` table
4. Clients can have per-user data limits that disable access when exceeded

### Subscription Links

The panel generates native subscription links:

- **VLESS WS**: `vless://uuid@domain:443?encryption=none&security=tls&type=ws&path=/ws_path#remark`
- **VLESS Reality**: `vless://uuid@tcp_domain:tcp_port?encryption=none&security=reality&sni=...&fp=chrome&pbk=...&sid=...&type=xhttp#remark`
- **Trojan variants**: Replace `vless://` with `trojan://` and UUID with password

### Client Config Import

Clients can:
1. Scan the QR code from the panel
2. Copy the subscription link and paste it into their Xray client
3. Use the subscription link directly (e.g., in v2rayN, Nekoray, etc.)

## Development / توسعه

```bash
# Clone / کلون
git clone <your-repo>
cd limoo

# Install / نصب
npm install

# Run / اجرا
PORT=3000 LIMOO_USER=admin LIMOO_PASS=changeme node server.js
```

## Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: SQLite (better-sqlite3)
- **Proxy Engine**: Xray-core
- **Frontend**: Vanilla HTML/CSS/JS
- **QR Codes**: qrcode (server-side PNG generation)

## License

MIT
