# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
R2Clone is an Electron desktop application built with React Router 7 and Vite. It uses TypeScript throughout and features a modern development setup with hot module replacement. The app manages backups between Cloudflare R2 storage and local directories using rclone.

### Dual Runtime Modes
The application supports two distinct runtime modes:
- **GUI Mode** (default) - Full Electron application with desktop window, system tray, and native features
- **Headless Mode** (`--headless` flag) - Server-only mode without GUI, designed for Docker/server deployments

Both modes share the same codebase and run an HTTP/WebSocket server on port 3000 (configurable via `--port` flag or database settings).

## Architecture

### Process Architecture
The application follows Electron's multi-process architecture with an integrated web server:
- **Main Process** (`src/main/`) - Manages application lifecycle, window creation, database operations, rclone integration, and system tray
- **Preload Script** (`src/preload/`) - Bridges main and renderer processes with secure IPC through `contextBridge.exposeInMainWorld`
- **Renderer Process** (`src/renderer/`) - React application with React Router 7 flat routes
- **Web Server** (`src/server/`) - Built-in HTTP server and WebSocket handler for both Electron and browser clients

### IPC Communication Pattern
The app uses a structured IPC pattern with namespaced handlers:
- `r2:*` - Bucket configuration management (CRUD operations, connection testing)
- `backup:*` - Backup job operations (start, stop, progress tracking)
- `settings:*` - Application settings management
- `rclone:*` - Rclone installation and path management
- `dialog:*` - Native dialog operations (file/folder selection)

Events flow from renderer → preload (via window.electronAPI) → main (via ipcRenderer.invoke) with responses returning through the same chain.

### Web Server & API Architecture
The application includes a built-in HTTP/HTTPS server (`src/server/index.ts`) that serves the React UI and provides API endpoints:
- **Dual Client Support** - Serves both Electron renderer (via `file://` protocol) and browser clients (via HTTP/HTTPS)
- **HTTPS by Default** - Automatically generates self-signed certificates on first run for encrypted localhost connections
- **Certificate Manager** (`src/main/cert-manager.ts`) - Manages self-signed SSL certificates using the `selfsigned` library
  - Auto-generates 2048-bit RSA certificates with 10-year validity
  - Includes Subject Alternative Names (SANs) for localhost, 127.0.0.1, ::1
  - Stored securely in `~/Library/Application Support/r2clone/certs/`
  - Electron trusts localhost certificates automatically via certificate-error handler
- **API Handler** (`src/server/api-handler.ts`) - RESTful API endpoints mirroring IPC handlers for browser compatibility
- **Unified WebSocket** (`src/server/websocket.ts`) - Single WebSocket endpoint (`/ws`) for real-time events (progress, installation, updates)
  - Supports both `ws://` and `wss://` protocols based on server configuration
- **Smart Binding** - Uses `allowExternal` setting to control network binding:
  - `false` (default) - Binds to `127.0.0.1` (localhost only, secure)
  - `true` - Binds to `0.0.0.0` (all interfaces, allows LAN access)
- **API Client Abstraction** (`src/renderer/lib/api-client.ts`) - Automatically detects runtime mode and protocol
  - Caches HTTPS status and port from webserver:status IPC handler
  - Uses appropriate protocol (http/https) and WebSocket protocol (ws/wss)

**Critical Event Flow Pattern:**
Backup progress events do NOT flow through IPC. Instead, they follow this pattern:
```
WebSocketHandler creates dedicated RcloneHandler per backup (keyed by jobId)
  → Handler emits events (progress, file-transferred, complete, etc.)
  → WebSocketHandler broadcasts events with jobId to all clients
  → WebSocket clients (both Electron renderer and browser clients)
```
The renderer connects to the WebSocket server even in Electron mode, unifying the event architecture. Each backup gets its own isolated RcloneHandler instance, enabling concurrent backups without cross-contamination.

### Data Storage Architecture
- **SQLite Database** (`~/Library/Application Support/r2clone/r2clone.db`) - Primary storage for bucket configurations and backup jobs
- **Credential Encryption** - Uses Electron's `safeStorage` API to encrypt sensitive R2 credentials before database storage
- **Migration Strategy** - Automatic one-time migration from legacy electron-store on first run (checks for existing store data and migrates to SQLite)
- **Settings Storage** - Key-value settings table stores app configuration:
  - `backup_destination` - Default backup storage location
  - `web_server_enabled` - External network access toggle
  - `web_server_port` - HTTP server port (default: 3000)
  - `use_https` - HTTPS toggle (default: true)
  - `https_port` - HTTPS server port (default: 3001)
  - `timezone` - Scheduler timezone setting
  - `theme`, `notifications`, `autoStart` - UI preferences

### Rclone Integration
- **Process Management** - RcloneHandler class extends EventEmitter to manage rclone child processes
- **Concurrent Backup Support** - WebSocketHandler creates a dedicated RcloneHandler instance for each active backup (keyed by jobId), enabling multiple simultaneous backups without interference
- **Progress Tracking** - Parses rclone's output to emit real-time progress events
- **Progress Pre-Scanning** - Uses `rclone size --json` before transfer to calculate accurate total for smooth progress bars without jumps
- **Installation** - RcloneInstaller handles automatic download and installation if rclone is not found in system PATH
- **Status Caching** - Rclone installation status checked once on app startup via `initialize()` and cached in memory for instant access (<1ms vs 100-400ms)
- **Configuration** - Dynamically builds rclone remote arguments without creating config files

## Key Technologies
- **Electron** v37.3.1 - Desktop application framework
- **React Router** v7 - Flat routes file-based routing with `createHashRouter`
- **Vite** - Build tool with electron-vite for multi-process builds
- **TypeScript** - Type safety across all processes with path aliases (`~/*`)
- **Tailwind CSS** v4 - Utility-first CSS with @tailwindcss/vite plugin
- **shadcn/ui** - Accessible component library built on Radix UI
- **Lucide React** - Icon library
- **better-sqlite3** - SQLite database for storing bucket configurations and backup jobs
- **rclone** - Backend tool for syncing with Cloudflare R2

## Development Commands

**Note: This project uses Bun as the package manager. Always use `bun` instead of `npm` for all commands.**

```bash
# Install dependencies
bun install

# Start development server with HMR
NODE_ENV=development bun run dev

# Build for production
bun run build

# Start built application (GUI mode)
bun start

# Start in headless mode (server only, no GUI)
bun start -- --headless --port 3000

# Package application (uses Electron Forge)
bun run package

# Create distributables (platform-specific)
bun run make

# Create universal macOS build (Intel + Apple Silicon)
bun run make:universal

# Add new packages
bun add [package-name]
bun add -D [dev-package-name]

# Add shadcn/ui components
bunx --bun shadcn@latest add [component-name]

# Rebuild native modules for Electron (required after adding native dependencies like better-sqlite3)
# Note: This runs automatically via postinstall hook, but can be run manually if needed
bun x electron-rebuild -f -w better-sqlite3
```

## Routing System
- Uses React Router 7 with flat routes file-based routing
- Routes defined in `src/renderer/app/routes/` using underscore prefixes for layouts
- Hash routing (`createHashRouter`) for Electron compatibility
- Route error boundaries with `ErrorBoundary` and `RouteError` components

## Build Configuration
- **electron.vite.config.ts** - Configures separate builds for main, preload, and renderer processes
- **vite.config.ts** - Development server configuration for renderer (runs on port 5173)
- **forge.config.js** - Electron Forge configuration for packaging and distribution
- Output directory: `dist/` (main, preload, renderer subdirectories)
- Path alias `~/*` points to `src/renderer/*` for clean imports
- **Native Modules** - better-sqlite3 requires rebuild for Electron (auto-runs via postinstall hook)

## State Management Patterns
- **Backup States** - State management in `backups._index.tsx` tracks backup progress for running jobs (History tab displays live progress, Tasks tab shows simple job cards)
- **Real-time Updates** - Uses WebSocket event listeners (`backup:progress`, `backup:file-transferred`, `backup:file-skipped`, `backup:complete`) via api-client.ts to update History tab UI in real-time
- **Progress Display** - All transfer progress (bar, file counts, speed, ETA) shown in History tab; auto-switches from Tasks tab when backup starts
- **Job Scheduling** - Backup jobs support scheduling with cron patterns via `croner` library with timezone awareness (schedule_metadata stored as JSON string, parsed at runtime)
- **Timezone Support** - BackupScheduler respects timezone setting from database when scheduling cron jobs (defaults to system timezone)

## Performance Optimizations

### Database Query Optimization
- **N+1 Query Fix** - `getAllBackupJobsWithBuckets()` uses LEFT JOIN to fetch jobs + buckets in single query instead of N+1 queries
- **Aggregated Stats** - Uses SQLite SUM/COUNT (`getBackupRunsStats()`) instead of filesystem scanning for backup statistics
- **Indexed Queries** - Indexes on `backup_runs.job_id`, `backup_runs.status`, and `backup_runs.started_at` for fast lookups

### Caching Strategy
- **Rclone Status** - Installation status checked once on app startup, cached in memory, updated only on install/uninstall (100-400x faster page loads)
- **Pre-Scanned Totals** - RcloneHandler calculates total size before transfer and stores in memory to prevent progress bar jumps
- **Page Loaders** - Use SQLite aggregated data instead of expensive filesystem operations

## Dark Mode Implementation
- Dark mode is toggled by adding `.dark` class to `document.documentElement`
- Theme selector is in the navigation bar (_layout.tsx)
- Background colors are hardcoded due to Tailwind v4 CSS variable issues:
  - Light: `bg-white`
  - Dark: `dark:bg-[#1a1a1a]` (dark gray, not pure black)
- All page titles must include `text-foreground` class for proper dark mode text color
- Muted text uses `text-muted-foreground` with increased lightness in dark mode (85% lightness)

## Key Implementation Details

### Multiple R2 Bucket Support
- Database schema supports unlimited bucket configurations with one active bucket
- Each bucket has encrypted credentials stored separately
- Bucket switching updates the active rclone configuration dynamically

### Backup Job System
- Jobs are stored with unique IDs and linked to specific buckets
- Support for scheduled backups using cron patterns via `croner` library (schedule_metadata stored as JSON string)
- Backup runs are tracked in `backup_runs` table with status, file counts, total_size, and backup_path
- **Concurrent Backup Support** - Multiple jobs can run simultaneously; each gets a dedicated RcloneHandler with isolated event listeners
- Pre-scan using `rclone size --json` before transfer for accurate progress tracking
- Real-time progress updates through EventEmitter pattern in RcloneHandler
- Progress displayed in History tab (auto-switches from Tasks tab on backup start)
- All backup operations use WebSocket (no IPC handlers); see `src/server/websocket.ts` for implementation

### Security Considerations
- **Credential Encryption** - All R2 credentials are encrypted using Electron's `safeStorage` before database storage
- **No Plaintext Secrets** - No plaintext credentials in config files or environment variables
- **Secure Rclone Communication** - Rclone receives credentials through command-line arguments, not config files
- **HTTPS by Default** - Web server uses HTTPS with self-signed certificates for encrypted localhost connections
  - Electron automatically trusts localhost certificates via certificate-error event handler
  - Browsers show security warnings for self-signed certs (expected behavior, can be bypassed)
  - TLS 1.2+ with AES-256-GCM encryption (same security as trusted certificates)
- **Certificate Storage** - SSL certificates stored with 0600 permissions in app data directory

### Auto-Update System
- **Custom UpdateManager** (`src/main/update-manager.ts`) - Custom update implementation (not using electron-updater)
- **Version Checking** - Main process fetches JSON manifest from `https://r2clone.gruntmods.com/latest-{platform}.json` and compares versions
- **Download Process** - Main process downloads installer to temp directory using Node.js `https` module with manual chunk writing for accurate progress tracking
- **Progress Tracking** - Real-time download progress emitted via EventEmitter and forwarded to renderer through IPC events (`app:update-download-progress`)
- **Installation** - Uses `shell.openPath()` to open downloaded installer/DMG, then quits app (sets `isQuitting = true` to bypass tray)
- **Manifest Format** - Platform-specific JSON manifests (`latest-mac.json`, `latest-win.json`, etc.) with version, releaseDate, releaseNotes, and files array
- **No CORS Issues** - Main process handles all HTTP requests (server-to-server), renderer only receives IPC events
- **IPC Events** - `app:update-checking`, `app:update-available`, `app:update-not-available`, `app:update-error`, `app:update-download-progress`, `app:update-downloaded`

### Docker Deployment
- **Overview** - Docker support for running R2Clone in headless mode without GUI
- **Architecture** - Uses existing `--headless` mode, downloads pre-built `.deb` packages from CDN
- **Multi-Architecture** - Supports linux/amd64 and linux/arm64 via Docker buildx
- **Base Image** - debian:bookworm-slim
- **Package Source** - Downloads from `https://r2clone.gruntmods.com/api/releases/linux-{arch}.json`
- **Files** - Dockerfile, docker-compose.yml, build-docker.sh, .dockerignore
- **Volumes** - `/data` (database and app data), `/backups` (backup storage)
- **Environment Variables** - `PORT` (default 3000), `USER_DATA_DIR` (default /data, maps to ELECTRON_USER_DATA_DIR)
- **Command** - Runs `r2clone --headless --port 3000` directly
- **Auto-Install** - Rclone is automatically installed on first run in Docker if not present

### System Tray Integration (GUI Mode Only)
- **Tray Menu** - Displays app status, scheduler state, and next scheduled runs
- **Quick Actions** - Trigger backups manually from tray menu without opening main window
- **Background Running** - Window close minimizes to tray instead of quitting (controlled by `isQuitting` flag)
- **First-Run Notification** - Shows system notification on first minimize explaining tray behavior
- **Dynamic Menu** - Updates in real-time to reflect backup job changes and scheduler updates
- **macOS Template Icon** - Uses programmatically-generated cloud icon with proper dark mode support

### EventEmitter Pattern
The codebase extensively uses Node.js EventEmitter pattern for loose coupling:
- **RcloneHandler** - Emits `progress`, `file-transferred`, `file-skipped`, `complete`, `error`, `stopped` events
  - WebSocketHandler creates one instance per active backup, stored in `activeHandlers` Map (keyed by jobId)
  - Each handler has dedicated event listeners that broadcast events with the corresponding jobId
  - Handlers are automatically cleaned up on backup completion/error/stop
- **BackupScheduler** - Emits `started`, `completed`, `error`, `skipped` events for scheduled jobs
  - Creates its own dedicated RcloneHandler for each scheduled backup execution
- **RcloneInstaller** - Emits `status`, `progress`, `complete`, `error` events during installation
- **UpdateManager** - Emits `checking`, `available`, `not-available`, `error` events for app updates

Events flow through WebSocketHandler which broadcasts to all connected clients (both Electron renderer and browser). The per-backup handler architecture ensures concurrent backups don't interfere with each other's progress tracking.