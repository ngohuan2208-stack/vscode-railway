# VS Code Railway

VS Code Web IDE running on Railway with password authentication and GitHub integration.

## Features

- Full VS Code in your browser (code-server)
- Password authentication
- GitHub integration (browse & clone repos)
- Persistent workspace with Railway Volumes
- WebSocket support for terminal & extensions
- 24/7 reliability with auto-restart
- Production-ready for 1GB RAM Railway plans

## Deploy

### 1. Fork this repository

### 2. Create Railway project

Railway Dashboard > New Project > Deploy from GitHub repo

### 3. Add Volume

Settings > Volumes > Add Volume > Mount path: `/workspace`

### 4. Add Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEB_PASSWORD` | Yes | Password to access the IDE |
| `WORKSPACE_DIR` | No | Workspace path (default: `/workspace`) |
| `LOG_LEVEL` | No | debug/info/warn/error |
| `GITHUB_TOKEN` | No | GitHub PAT (can also set via Settings page) |
| `INSTALL_EXTENSIONS` | No | Comma-separated extension IDs |

### 5. Deploy & Open

1. Wait for build to complete
2. Settings > Networking > Generate Domain
3. Open the URL
4. Enter password

## Terminal Usage

After login, open a terminal and use it like a real VPS:

```bash
# Install npm packages globally
npm install -g opencode-ai

# Use opencode
opencode

# Run projects
npm run dev
python3 server.py

# Git operations
git clone https://github.com/user/repo.git
git pull
git push
```

Global npm packages install to `/home/ide/.npm-global` and persist across sessions.

## GitHub Integration

After logging in:

1. Go to **Settings** page (link on login page)
2. Enter your GitHub Personal Access Token
3. Browse your repositories
4. Click **Clone** to clone into workspace
5. Open VS Code to start editing

### Create a GitHub Token

1. Go to https://github.com/settings/tokens
2. Click **Generate new token (classic)**
3. Select scopes: `repo` (full control)
4. Copy the token

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/github/token` | GET | Check if token is set |
| `/api/github/token` | POST | Save/clear token |
| `/api/github/repos` | GET | List user repositories |
| `/api/github/orgs` | GET | List organizations |
| `/api/github/orgs/:org/repos` | GET | List org repositories |
| `/api/github/clone` | POST | Clone a repository |
| `/api/projects` | GET | List workspace projects |

## Architecture

```
Railway URL (PORT)
  |
  v
Node.js Server (server/index.js)
  |-- Auth (session.js)
  |-- Routes (routes.js)
  |-- GitHub API (github.js)
  |-- HTTP Proxy (proxy.js)
  |-- WebSocket Proxy (proxy.js)
  |
  v
code-server (internal:8180)
  |
  v
Railway Volume (/workspace)
```

## Project Structure

```
/
├── Dockerfile
├── start.sh
├── package.json
├── railway.toml
├── server/
│   ├── index.js      # Entry point
│   ├── config.js     # Configuration
│   ├── logger.js     # Logging
│   ├── session.js    # Auth & sessions
│   ├── github.js     # GitHub API
│   ├── proxy.js      # HTTP/WS proxy
│   └── routes.js     # HTTP routes
├── public/
│   ├── login.html    # Login page
│   └── settings.html # GitHub settings
└── .env.example
```

## Development

```bash
npm install
WEB_PASSWORD=test node server/index.js
```

## Troubleshooting

**WebSocket error (1006)**
- Wait 1-2 min for code-server to start
- Check Railway logs
- Reload the page

**502 Bad Gateway**
- Check deployment logs
- Ensure WEB_PASSWORD is set

**GitHub repos not loading**
- Verify token has `repo` scope
- Check token is not expired
- Try in Settings page

**Volume not persisting**
- Verify Volume mounted at `/workspace`

**Container restart loop**
- Check logs for OOM errors
- Verify environment variables

## License

MIT
