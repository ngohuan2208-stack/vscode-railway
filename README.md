# VS Code Railway

A production-ready VS Code Web IDE running on Railway with password authentication.

## Features

- Full VS Code in your browser (via code-server)
- Password authentication before access
- Persistent workspace with Railway Volumes
- WebSocket support for terminal and extensions
- 24/7 reliability with auto-restart
- Low resource usage

## Deploy to Railway

### 1. Fork or clone this repository

```bash
git clone https://github.com/your-user/vscode-railway.git
cd vscode-railway
git push
```

### 2. Create a Railway project

1. Go to [Railway Dashboard](https://railway.app)
2. Click **New Project** > **Deploy from GitHub repo**
3. Select this repository

### 3. Add a Volume

1. In your Railway service, go to **Settings** > **Volumes**
2. Click **Add Volume**
3. Set mount path to: `/workspace`
4. This persists your projects across restarts

### 4. Add Environment Variables

Go to **Variables** tab and add:

| Variable | Required | Description |
|----------|----------|-------------|
| `WEB_PASSWORD` | Yes | Password to access the IDE |
| `SESSION_SECRET` | Yes | Random string for session encryption |
| `WORKSPACE_DIR` | No | Workspace path (default: `/workspace`) |
| `LOG_LEVEL` | No | Log level: `debug`, `info`, `warn`, `error` |
| `TZ` | No | Timezone (e.g., `UTC`, `Asia/Ho_Chi_Minh`) |

**Important:**
- `WEB_PASSWORD`: Use a strong, unique password
- `SESSION_SECRET`: Generate with `openssl rand -hex 32`

### 5. Generate a session secret

```bash
openssl rand -hex 32
```

Copy the output and set it as `SESSION_SECRET` in Railway.

### 6. Deploy

Railway will automatically deploy after adding variables. Wait for the build to complete.

### 7. Open your IDE

1. Go to **Settings** > **Networking**
2. Click **Generate Domain** to get a public URL
3. Open the URL in your browser
4. Enter your password to access VS Code

## Railway Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WEB_PASSWORD` | Yes | - | Password for authentication |
| `SESSION_SECRET` | Yes | random | Secret for session cookies |
| `PORT` | No | 8080 | Railway sets this automatically |
| `WORKSPACE_DIR` | No | `/workspace` | Path to persistent workspace |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `NODE_ENV` | No | `production` | Node.js environment |
| `TZ` | No | `UTC` | Container timezone |

## Volume

Mount path: `/workspace`

Data stored in volume:
- `/workspace/projects` - Your project files
- `/workspace/.config` - Code-server and git configuration
- `/workspace/.local` - Extensions and data
- `/workspace/.cache` - Cache files

**Without a volume, all data is lost on container restart.**

## Pre-installed Tools

- git
- node.js + npm
- python3 + pip
- curl, wget, jq
- bash

Install additional tools via the VS Code terminal.

## Development

```bash
# Local development
npm install
WEB_PASSWORD=test SESSION_SECRET=test node server.js

# Build Docker image
docker build -t vscode-railway .

# Run locally with Docker
docker run -p 8080:8080 \
  -e WEB_PASSWORD=test \
  -e SESSION_SECRET=test \
  -v workspace:/workspace \
  vscode-railway
```

## Troubleshooting

### 502 Bad Gateway

- Wait 1-2 minutes for code-server to start
- Check Railway logs for errors
- Ensure `WEB_PASSWORD` and `SESSION_SECRET` are set

### WebSocket failed / Terminal not working

- Ensure your Railway domain supports WebSocket
- Check if proxy is forwarding correctly
- Try refreshing the page

### VS Code not loading

- Check Railway deployment logs
- Verify the container started successfully
- Ensure code-server process is running

### Login not working

- Verify `WEB_PASSWORD` is set correctly in Railway
- Check for typos in the password
- After changing `WEB_PASSWORD`, restart the service

### Volume not persisting data

- Verify Volume is mounted at `/workspace`
- Check Railway Volume settings
- Without Volume, data is ephemeral

### Container keeps restarting

- Check Railway logs for OOM errors
- Reduce extensions if memory is low
- Verify `WEB_PASSWORD` is set (required)

### Permission denied

- The container runs with appropriate user permissions
- If you see permission errors, check file ownership in Volume

### Port error

- Do not set `PORT` manually - Railway sets it automatically
- If you need a different port, update both Railway service and code

### Out of Memory

- Remove heavy extensions
- Close unused terminal tabs
- Consider upgrading Railway plan

## Architecture

```
Internet
   |
   v
Railway Public URL (PORT)
   |
   v
Node.js Auth Proxy (server.js)
   |
   +--> Serves login page (unauthenticated)
   +--> Proxies to code-server (authenticated)
   |
   v
code-server (internal port 8180)
   |
   +--> VS Code Web IDE
   +--> Terminal
   +--> Extensions
   +--> File Manager
   |
   v
Railway Persistent Volume (/workspace)
```

## Security

- Password never stored in source code
- Sessions use HttpOnly, SameSite cookies
- Rate limiting on login attempts (5 attempts / 15 min lockout)
- Security headers (X-Content-Type-Options, X-Frame-Options, CSP)
- WebSocket connections require valid session
- No secrets exposed to frontend

## License

MIT
