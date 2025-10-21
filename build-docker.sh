#!/bin/bash

# Interactive Docker setup script for R2Clone
# Guides user through configuration, build, and deployment

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
DEFAULT_PORT=3000
DEFAULT_BACKUP_DIR="./backups"
IMAGE_NAME="r2clone"
VERSION="latest"

clear

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                        ║${NC}"
echo -e "${BLUE}║         ${GREEN}R2Clone Docker Interactive Setup${BLUE}            ║${NC}"
echo -e "${BLUE}║                                                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}This script will:${NC}"
echo -e "  ${CYAN}•${NC} Check prerequisites"
echo -e "  ${CYAN}•${NC} Configure your deployment"
echo -e "  ${CYAN}•${NC} Build the Docker image"
echo -e "  ${CYAN}•${NC} Start R2Clone"
echo ""
read -p "$(echo -e ${YELLOW}Press Enter to begin...${NC})" < /dev/tty
echo ""

# ============================================================================
# STEP 1: Prerequisites Check
# ============================================================================
echo -e "${BLUE}[1/5]${NC} ${GREEN}Checking prerequisites...${NC}"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - Direct to Docker Desktop
        echo -e "${YELLOW}Please install Docker Desktop for macOS:${NC}"
        echo -e "${CYAN}https://docs.docker.com/desktop/setup/install/mac-install/${NC}"
        echo ""
        exit 1
    else
        # Linux - Offer to install
        echo -e "${YELLOW}Would you like to install Docker now?${NC}"
        read -p "$(echo -e ${CYAN}Install Docker? [Y/n]: ${NC})" -n 1 -r INSTALL_DOCKER < /dev/tty
        echo ""
        echo ""

        if [[ ! $INSTALL_DOCKER =~ ^[Nn]$ ]]; then
            echo -e "${CYAN}Installing Docker...${NC}"
            if curl -fsSL https://get.docker.com | sh; then
                echo -e "${GREEN}✓ Docker installed successfully${NC}"
                echo -e "${YELLOW}Note: You may need to log out and back in for group permissions to take effect${NC}"
            else
                echo -e "${RED}✗ Docker installation failed${NC}"
                echo ""
                echo -e "${YELLOW}Please install Docker manually:${NC}"
                echo -e "${CYAN}curl -fsSL https://get.docker.com | sh${NC}"
                echo ""
                exit 1
            fi
        else
            echo -e "${YELLOW}Please install Docker manually:${NC}"
            echo -e "${CYAN}curl -fsSL https://get.docker.com | sh${NC}"
            echo ""
            exit 1
        fi
    fi
else
    echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Check docker-compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}✗ docker-compose is not installed${NC}"
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - Should come with Docker Desktop
        echo -e "${YELLOW}docker-compose should be included with Docker Desktop${NC}"
        echo -e "${YELLOW}Please reinstall Docker Desktop or check your installation${NC}"
        echo ""
        exit 1
    else
        # Linux - Offer to install
        echo -e "${YELLOW}Would you like to install docker-compose now?${NC}"
        read -p "$(echo -e ${CYAN}Install docker-compose? [Y/n]: ${NC})" -n 1 -r INSTALL_COMPOSE < /dev/tty
        echo ""
        echo ""

        if [[ ! $INSTALL_COMPOSE =~ ^[Nn]$ ]]; then
            echo -e "${CYAN}Installing docker-compose...${NC}"

            # Get latest version
            COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

            # Try to install with sudo
            if sudo curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose 2>/dev/null && sudo chmod +x /usr/local/bin/docker-compose 2>/dev/null; then
                echo -e "${GREEN}✓ docker-compose installed successfully${NC}"
            else
                echo -e "${RED}✗ docker-compose installation failed (insufficient permissions)${NC}"
                echo ""
                echo -e "${YELLOW}Please install docker-compose manually:${NC}"
                echo -e "${CYAN}COMPOSE_VERSION=\$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '\"tag_name\":' | sed -E 's/.*\"([^\"]+)\".*/\1/')${NC}"
                echo -e "${CYAN}sudo curl -L \"https://github.com/docker/compose/releases/download/\${COMPOSE_VERSION}/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose${NC}"
                echo -e "${CYAN}sudo chmod +x /usr/local/bin/docker-compose${NC}"
                echo ""
                exit 1
            fi
        else
            echo -e "${YELLOW}Please install docker-compose manually:${NC}"
            echo -e "${CYAN}COMPOSE_VERSION=\$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '\"tag_name\":' | sed -E 's/.*\"([^\"]+)\".*/\1/')${NC}"
            echo -e "${CYAN}sudo curl -L \"https://github.com/docker/compose/releases/download/\${COMPOSE_VERSION}/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose${NC}"
            echo -e "${CYAN}sudo chmod +x /usr/local/bin/docker-compose${NC}"
            echo ""
            exit 1
        fi
    fi
else
    echo -e "${GREEN}✓ docker-compose installed${NC}"
fi

echo ""
sleep 1

# ============================================================================
# Check for Existing Configuration
# ============================================================================
EXISTING_CONFIG=false
if [ -f docker-compose.yml ]; then
    echo -e "${BLUE}[*]${NC} ${GREEN}Detecting existing configuration...${NC}"
    echo ""

    # Parse port from docker-compose.yml
    EXISTING_PORT=$(grep -E '^\s*-\s*"[0-9]+:[0-9]+"' docker-compose.yml | head -1 | sed -E 's/.*"([0-9]+):[0-9]+".*/\1/')

    # Parse data directory from first volume mount
    EXISTING_DATA_DIR=$(grep -E '^\s*-\s*.+:/data' docker-compose.yml | head -1 | sed -E 's/^[^/]+(\/.*):\/data$/\1/')

    # Parse backup directory from second volume mount
    EXISTING_BACKUP_DIR=$(grep -E '^\s*-\s*.+:/backups' docker-compose.yml | head -1 | sed -E 's/^[^/]+(\/.*):\/backups$/\1/')

    if [ -n "$EXISTING_PORT" ] && [ -n "$EXISTING_DATA_DIR" ] && [ -n "$EXISTING_BACKUP_DIR" ]; then
        EXISTING_CONFIG=true
        echo -e "${GREEN}✓ Found existing configuration:${NC}"
        echo -e "  Port:           ${CYAN}${EXISTING_PORT}${NC}"
        echo -e "  Backup dir:     ${CYAN}${EXISTING_BACKUP_DIR}${NC}"
        echo -e "  Data dir:       ${CYAN}${EXISTING_DATA_DIR}${NC}"
        echo ""

        read -p "$(echo -e ${YELLOW}Use existing configuration? [Y/n]: ${NC})" -n 1 -r USE_EXISTING < /dev/tty
        echo

        if [[ ! $USE_EXISTING =~ ^[Nn]$ ]]; then
            PORT=$EXISTING_PORT
            BACKUP_DIR=$EXISTING_BACKUP_DIR
            DATA_DIR=$EXISTING_DATA_DIR
            SKIP_COMPOSE=true  # Don't ask again later
            echo -e "${GREEN}✓ Using existing configuration${NC}"
            echo ""
            sleep 1
        else
            EXISTING_CONFIG=false
            echo -e "${CYAN}Configuring new settings...${NC}"
            echo ""
        fi
    fi
fi

# ============================================================================
# STEP 2: Configuration
# ============================================================================
if [ "$EXISTING_CONFIG" = false ]; then
echo -e "${BLUE}[2/5]${NC} ${GREEN}Configuration${NC}"
echo ""

# Port
read -p "$(echo -e ${CYAN}Enter port for web interface [default: ${DEFAULT_PORT}]: ${NC})" USER_PORT < /dev/tty
PORT=${USER_PORT:-$DEFAULT_PORT}

# Validate port
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo -e "${RED}Invalid port. Using default: ${DEFAULT_PORT}${NC}"
    PORT=$DEFAULT_PORT
fi

# Backup directory
echo -e "${CYAN}Select backup directory location${NC}"
echo -e "${YELLOW}This is where your backup files will be stored.${NC}"
echo -e "${YELLOW}A folder called 'R2CloneDocker' will be created in the location you choose.${NC}"
echo ""
read -p "$(echo -e ${YELLOW}Press Enter to open file picker...${NC})" < /dev/tty
echo ""
BACKUP_DIR=""

# Try to use GUI file picker based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use osascript
    echo -e "${YELLOW}Opening macOS file picker...${NC}"
    BACKUP_DIR=$(osascript -e 'POSIX path of (choose folder with prompt "Select backup directory:")' 2>/dev/null || echo "")
    if [ -n "$BACKUP_DIR" ]; then
        # Remove trailing slash if present
        BACKUP_DIR="${BACKUP_DIR%/}"
    fi
elif command -v zenity &> /dev/null; then
    # Linux with zenity
    echo -e "${YELLOW}Opening file picker...${NC}"
    BACKUP_DIR=$(zenity --file-selection --directory --title="Select backup directory" 2>/dev/null || echo "")
elif command -v kdialog &> /dev/null; then
    # Linux with KDE
    echo -e "${YELLOW}Opening file picker...${NC}"
    BACKUP_DIR=$(kdialog --getexistingdirectory "$HOME" --title "Select backup directory" 2>/dev/null || echo "")
fi

# Fallback to text input if GUI picker not available or cancelled
if [ -z "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}No directory selected or GUI file picker not available${NC}"
    read -p "$(echo -e ${CYAN}Enter backup directory path [default: ${DEFAULT_BACKUP_DIR}]: ${NC})" USER_BACKUP_DIR < /dev/tty
    BACKUP_DIR=${USER_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}
fi

# Append R2CloneDocker to the selected path to keep backups organized
BACKUP_DIR="${BACKUP_DIR}/R2CloneDocker"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo ""

# Data directory (database and settings)
echo -e "${CYAN}Select data directory location (for database and settings)${NC}"
echo -e "${YELLOW}This is where your application data, database, and settings will be stored.${NC}"
echo -e "${YELLOW}A folder called 'R2CloneDockerAppData' will be created in the location you choose.${NC}"
echo ""
read -p "$(echo -e ${YELLOW}Press Enter to open file picker...${NC})" < /dev/tty
echo ""
DATA_DIR=""

# Try to use GUI file picker based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use osascript
    echo -e "${YELLOW}Opening macOS file picker...${NC}"
    DATA_DIR=$(osascript -e 'POSIX path of (choose folder with prompt "Select data directory:")' 2>/dev/null || echo "")
    if [ -n "$DATA_DIR" ]; then
        # Remove trailing slash if present
        DATA_DIR="${DATA_DIR%/}"
    fi
elif command -v zenity &> /dev/null; then
    # Linux with zenity
    echo -e "${YELLOW}Opening file picker...${NC}"
    DATA_DIR=$(zenity --file-selection --directory --title="Select data directory" 2>/dev/null || echo "")
elif command -v kdialog &> /dev/null; then
    # Linux with KDE
    echo -e "${YELLOW}Opening file picker...${NC}"
    DATA_DIR=$(kdialog --getexistingdirectory "$HOME" --title "Select data directory" 2>/dev/null || echo "")
fi

# Fallback to text input if GUI picker not available or cancelled
if [ -z "$DATA_DIR" ]; then
    echo -e "${YELLOW}No directory selected or GUI file picker not available${NC}"
    read -p "$(echo -e ${CYAN}Enter data directory path [default: ${DEFAULT_BACKUP_DIR}]: ${NC})" USER_DATA_DIR < /dev/tty
    DATA_DIR=${USER_DATA_DIR:-$DEFAULT_BACKUP_DIR}
fi

# Append R2CloneDockerAppData to the selected path
DATA_DIR="${DATA_DIR}/R2CloneDockerAppData"

# Create data directory if it doesn't exist
mkdir -p "$DATA_DIR"

echo ""
echo -e "${YELLOW}Configuration summary:${NC}"
echo -e "  Port:           ${GREEN}${PORT}${NC}"
echo -e "  Backup dir:     ${GREEN}${BACKUP_DIR}${NC}"
echo -e "  Data dir:       ${GREEN}${DATA_DIR}${NC}"
echo ""

read -p "$(echo -e ${YELLOW}Continue with these settings? [Y/n]: ${NC})" -n 1 -r < /dev/tty
echo
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo -e "${RED}Setup cancelled${NC}"
    exit 0
fi

fi  # End of EXISTING_CONFIG check

echo ""
sleep 1

# ============================================================================
# STEP 3: Generate Dockerfile and docker-compose.yml
# ============================================================================
echo -e "${BLUE}[3/5]${NC} ${GREEN}Generating Dockerfile and docker-compose.yml...${NC}"
echo ""

# Generate Dockerfile
cat > Dockerfile <<'DOCKERFILE_EOF'
# Multi-architecture Dockerfile for R2Clone
# Supports: linux/amd64, linux/arm64

FROM debian:bookworm-slim

# Build arguments for multi-architecture support
ARG TARGETARCH
ARG CACHEBUST=1

# Install dependencies
RUN apt-get update && \
    apt-get install -y \
        curl \
        jq \
        ca-certificates \
        libsecret-1-0 \
        gnome-keyring \
        dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Download and install R2Clone from CDN
# CACHEBUST arg forces this layer to rebuild and fetch latest version
RUN echo "Cache bust: ${CACHEBUST}" && \
    MANIFEST_URL="https://r2clone.gruntmods.com/api/releases/linux-${TARGETARCH}.json" && \
    echo "Fetching manifest from: ${MANIFEST_URL}" && \
    DOWNLOAD_URL=$(curl -sSL "${MANIFEST_URL}" | jq -r '.files[0].url') && \
    echo "Downloading R2Clone from: ${DOWNLOAD_URL}" && \
    curl -sSL -o /tmp/r2clone.deb "${DOWNLOAD_URL}" && \
    echo "Installing R2Clone..." && \
    apt-get update && \
    apt-get install -y /tmp/r2clone.deb && \
    rm /tmp/r2clone.deb && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create backups directory with permissions
RUN mkdir -p /backups && \
    chmod 755 /backups

# Create entrypoint script to set up data directories, symlinks, and keyring at runtime
RUN cat > /entrypoint.sh << 'ENTRYPOINT_EOF'
#!/bin/bash
set -e

# Create data subdirectories if they don't exist (volume is mounted at runtime)
mkdir -p /data/config /data/local
chmod 700 /data/config /data/local

# Create symlinks if they don't exist
if [ ! -L /root/.config ]; then
    rm -rf /root/.config
    ln -s /data/config /root/.config
fi

if [ ! -L /root/.local ]; then
    rm -rf /root/.local
    ln -s /data/local /root/.local
fi

# Create symlink for R2Clone backups
if [ ! -L /root/R2Clone ]; then
    rm -rf /root/R2Clone
    ln -s /backups /root/R2Clone
fi

# Start D-Bus system daemon (required for Electron system-level features)
mkdir -p /run/dbus
rm -f /run/dbus/pid
dbus-daemon --system --fork

# Start D-Bus session bus and export environment variables
eval $(dbus-launch --sh-syntax)
export DBUS_SESSION_BUS_ADDRESS

# Initialize gnome-keyring with persistent password for credential encryption
# Create/use persistent keyring password file in /data volume
KEYRING_PASSWORD_FILE="/data/.keyring-password"
if [ ! -f "$KEYRING_PASSWORD_FILE" ]; then
    # Generate random password on first run and save it
    openssl rand -base64 32 > "$KEYRING_PASSWORD_FILE"
    chmod 600 "$KEYRING_PASSWORD_FILE"
    echo "[Entrypoint] Generated new keyring password"
else
    echo "[Entrypoint] Using existing keyring password"
fi

# Initialize gnome-keyring with persistent password
# Using eval pattern from https://alex-ber.medium.com/using-gnome-keyring-in-docker-container-2c8a56a894f7
eval $(cat "$KEYRING_PASSWORD_FILE" | gnome-keyring-daemon --unlock --components=secrets | sed -e 's/^/export /')

# Send Ctrl+D to stdin
exec 0<&-

# Verify keyring is accessible
if [ -n "$GNOME_KEYRING_CONTROL" ]; then
    echo "[Entrypoint] Gnome-keyring initialized: $GNOME_KEYRING_CONTROL"
    echo "[Entrypoint] SSH_AUTH_SOCK: $SSH_AUTH_SOCK"
    echo "[Entrypoint] DBUS_SESSION_BUS_ADDRESS: $DBUS_SESSION_BUS_ADDRESS"
else
    echo "[Entrypoint] WARNING: GNOME_KEYRING_CONTROL not set"
fi

# Execute the CMD with all environment variables
exec "$@"
ENTRYPOINT_EOF

RUN chmod +x /entrypoint.sh

# Set working directory
WORKDIR /app

# Expose web server port
EXPOSE 3000

# Set environment variables
ENV USER_DATA_DIR=/data \
    NODE_ENV=production \
    DOCKER=true

# Volume mounts
VOLUME ["/data", "/backups"]

# Use entrypoint script
ENTRYPOINT ["/entrypoint.sh"]

# Run r2clone in headless mode
# --no-sandbox is required when running Electron as root in Docker
# --password-store=gnome-libsecret forces Electron to use gnome-keyring for credential encryption
# Note: Port can be overridden by docker-compose command
CMD ["r2clone", "--headless", "--port", "3000", "--no-sandbox", "--password-store=gnome-libsecret"]
DOCKERFILE_EOF

echo -e "${GREEN}✓ Dockerfile created${NC}"

# Generate docker-compose.yml only if we don't have existing config
if [ "$SKIP_COMPOSE" != true ]; then
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  r2clone:
    image: r2clone:latest
    build:
      context: .
      dockerfile: Dockerfile
    container_name: r2clone
    command: ["r2clone", "--headless", "--port", "${PORT}", "--no-sandbox", "--password-store=gnome-libsecret"]
    ports:
      - "${PORT}:${PORT}"
    volumes:
      # Database and application data (bind mount to host directory)
      - ${DATA_DIR}:/data
      # Backup storage (bind mount to host directory)
      - ${BACKUP_DIR}:/backups
    environment:
      # Port for web interface
      - PORT=${PORT}
      # Docker mode flag for auto-update
      - DOCKER=true
    cap_add:
      - SYS_TIME  # Allows setting system time
    restart: unless-stopped
    # Healthcheck to ensure service is running
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${PORT}/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

echo -e "${GREEN}✓ docker-compose.yml created${NC}"
else
    echo -e "${GREEN}✓ Keeping existing docker-compose.yml${NC}"
fi

# Create .dockerignore to keep build context clean
cat > .dockerignore <<'DOCKERIGNORE_EOF'
node_modules
.git
.github
*.md
*.log
out
dist
build
.DS_Store
DOCKERIGNORE_EOF

echo -e "${GREEN}✓ .dockerignore created${NC}"
echo ""
sleep 1

# ============================================================================
# STEP 4: Build Docker Image
# ============================================================================
echo -e "${BLUE}[4/5]${NC} ${GREEN}Building Docker image...${NC}"
echo ""

echo -e "${CYAN}Building Docker image for current architecture...${NC}"
docker build --build-arg CACHEBUST=$(date +%s) -t "${IMAGE_NAME}:${VERSION}" .

echo ""
echo -e "${GREEN}✓ Docker image built successfully${NC}"
echo ""
sleep 1

# ============================================================================
# STEP 5: Start Container
# ============================================================================
echo -e "${BLUE}[5/5]${NC} ${GREEN}Starting R2Clone...${NC}"
echo ""

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^r2clone$"; then
    echo -e "${YELLOW}Stopping existing container...${NC}"
    docker-compose down
fi

# Start the container
echo -e "${CYAN}Starting container...${NC}"
docker-compose up -d

echo ""
echo -e "${CYAN}Waiting for R2Clone to be ready...${NC}"
sleep 3

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^r2clone$"; then
    echo -e "${GREEN}✓ R2Clone is running!${NC}"
else
    echo -e "${RED}✗ Container failed to start${NC}"
    echo ""
    echo -e "${YELLOW}Showing logs:${NC}"
    docker-compose logs
    exit 1
fi

# ============================================================================
# Setup Complete
# ============================================================================
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                        ║${NC}"
echo -e "${GREEN}║              ${BLUE}Setup completed successfully!${GREEN}            ║${NC}"
echo -e "${GREEN}║                                                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}📍 Access R2Clone at:${NC}"
echo -e "   ${BLUE}http://localhost:${PORT}${NC}"
echo ""
echo -e "${CYAN}📚 Useful commands:${NC}"
echo -e "   View logs:        ${YELLOW}docker-compose logs -f${NC}"
echo -e "   Stop R2Clone:     ${YELLOW}docker-compose down${NC}"
echo -e "   Restart R2Clone:  ${YELLOW}docker-compose restart${NC}"
echo -e "   Update R2Clone:   ${YELLOW}docker-compose pull && docker-compose up -d${NC}"
echo ""
echo -e "${CYAN}📂 Storage locations:${NC}"
echo -e "   Backups: ${YELLOW}${BACKUP_DIR}${NC}"
echo -e "   Data:    ${YELLOW}${DATA_DIR}${NC}"
echo ""
echo -e "${GREEN}Happy backing up! 🚀${NC}"
echo ""
