# R2Clone

A desktop and server application for backing up files to Cloudflare R2 storage with scheduled backups and a modern web interface.

## Features

- Backup files to Cloudflare R2 storage using rclone
- Schedule automated backups
- Support for multiple R2 buckets and accounts
- Real-time progress tracking
- Backup history and statistics
- Dark/light mode interface
- Cross-platform support (macOS, Windows, Linux)
- Docker deployment for Servers and NAS systems

## Installation

### Desktop Application

Download the latest release for your platform:

- [Getting Started](https://r2clone.gruntmods.com/getting-started/)

```

## Architecture

- **Main Process**: Electron main process handles database, rclone integration, and IPC
- **Renderer Process**: React application with React Router 7
- **Preload Script**: Secure bridge between main and renderer processes
- **Database**: SQLite for storing configurations and backup history
- **Web Server**: Built-in HTTP server for web interface and API
```

## Technology Stack

- **Electron** - Desktop application framework
- **React Router 7** - Routing and data loading
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **SQLite** - Database
- **rclone** - Storage backend

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Links

- [Website](https://r2clone.gruntmods.com)
- [Issues](https://github.com/gruntlord5/R2_Clone/issues)
- [Documentation](https://r2clone.gruntmods.com/getting-started/)
