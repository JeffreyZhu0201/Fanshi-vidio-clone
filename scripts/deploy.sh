#!/bin/bash

# Fanshi Video Clone - Deployment Script
# This script automates the deployment process

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="fanshi-video-clone"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking requirements..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi

    if [ ! -f ".env" ]; then
        log_warn ".env file not found, using .env.example"
        if [ -f ".env.example" ]; then
            cp .env.example .env
            log_info "Created .env from .env.example"
        else
            log_error ".env.example not found"
            exit 1
        fi
    fi

    log_info "All requirements met"
}

backup_current_version() {
    log_info "Backing up current version..."

    mkdir -p "$BACKUP_DIR"

    # Backup database
    if docker ps | grep -q fanshi-mysql; then
        log_info "Backing up database..."
        docker exec fanshi-mysql mysqldump -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
            "${MYSQL_DATABASE:-fanshi_video}" > "$BACKUP_DIR/db_backup_$TIMESTAMP.sql" 2>/dev/null || true
    fi

    # Backup uploads directory
    if [ -d "backend/uploads" ]; then
        log_info "Backing up uploads..."
        tar -czf "$BACKUP_DIR/uploads_backup_$TIMESTAMP.tar.gz" backend/uploads
    fi

    log_info "Backup completed: $BACKUP_DIR/*_$TIMESTAMP.*"
}

pull_latest_code() {
    log_info "Pulling latest code..."

    if [ -d ".git" ]; then
        git fetch origin
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        log_info "Current branch: $CURRENT_BRANCH"

        read -p "Pull latest changes from origin/$CURRENT_BRANCH? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            git pull origin "$CURRENT_BRANCH"
            log_info "Code updated successfully"
        else
            log_warn "Skipping code update"
        fi
    else
        log_warn "Not a git repository, skipping code update"
    fi
}

build_images() {
    log_info "Building Docker images..."

    docker compose build --no-cache

    log_info "Images built successfully"
}

stop_services() {
    log_info "Stopping current services..."

    docker compose down

    log_info "Services stopped"
}

start_services() {
    log_info "Starting services..."

    docker compose up -d

    log_info "Services started"
}

run_migrations() {
    log_info "Running database migrations..."

    # Wait for database to be ready
    sleep 10

    # Run migrations if migration script exists
    if [ -f "backend/migrations/run-migrations.sh" ]; then
        docker exec fanshi-backend bash -c "cd /app && bash migrations/run-migrations.sh"
    else
        log_warn "No migration script found, skipping migrations"
    fi

    log_info "Migrations completed"
}

health_check() {
    log_info "Running health checks..."

    MAX_RETRIES=30
    RETRY_COUNT=0

    # Check backend
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f http://localhost:5000/api/health &> /dev/null; then
            log_info "Backend is healthy"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_warn "Waiting for backend... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
    done

    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        log_error "Backend health check failed"
        return 1
    fi

    # Check frontend
    RETRY_COUNT=0
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f http://localhost:3000 &> /dev/null; then
            log_info "Frontend is healthy"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_warn "Waiting for frontend... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
    done

    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        log_error "Frontend health check failed"
        return 1
    fi

    log_info "All services are healthy"
    return 0
}

show_status() {
    log_info "Service status:"
    docker compose ps

    log_info "\nService logs (last 20 lines):"
    docker compose logs --tail=20
}

cleanup_old_backups() {
    log_info "Cleaning up old backups (keeping last 10)..."

    if [ -d "$BACKUP_DIR" ]; then
        cd "$BACKUP_DIR"
        ls -t db_backup_*.sql 2>/dev/null | tail -n +11 | xargs -r rm
        ls -t uploads_backup_*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm
        cd ..
    fi

    log_info "Cleanup completed"
}

# Main deployment flow
main() {
    log_info "Starting deployment of $PROJECT_NAME..."

    check_requirements
    backup_current_version
    pull_latest_code
    stop_services
    build_images
    start_services
    run_migrations

    if health_check; then
        log_info "Deployment completed successfully!"
        show_status
        cleanup_old_backups
    else
        log_error "Deployment failed! Rolling back..."
        docker compose down
        log_error "Please check logs and try again"
        exit 1
    fi
}

# Run main function
main
