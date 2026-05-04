#!/bin/bash

# Fanshi Video Clone - Backup Script
# This script creates backups of database and uploads

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

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

    if ! docker ps | grep -q fanshi-mysql; then
        log_error "MySQL container is not running"
        exit 1
    fi

    mkdir -p "$BACKUP_DIR"

    log_info "Requirements met"
}

backup_database() {
    log_info "Backing up database..."

    DB_BACKUP_FILE="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"

    docker exec fanshi-mysql mysqldump \
        -u root \
        -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        --single-transaction \
        --routines \
        --triggers \
        --events \
        "${MYSQL_DATABASE:-fanshi_video}" > "$DB_BACKUP_FILE" 2>/dev/null

    # Compress backup
    gzip "$DB_BACKUP_FILE"

    log_info "Database backup completed: ${DB_BACKUP_FILE}.gz"
}

backup_uploads() {
    log_info "Backing up uploads..."

    if [ ! -d "backend/uploads" ]; then
        log_warn "Uploads directory not found, skipping"
        return
    fi

    UPLOADS_BACKUP_FILE="$BACKUP_DIR/uploads_backup_$TIMESTAMP.tar.gz"

    tar -czf "$UPLOADS_BACKUP_FILE" backend/uploads

    log_info "Uploads backup completed: $UPLOADS_BACKUP_FILE"
}

backup_config() {
    log_info "Backing up configuration files..."

    CONFIG_BACKUP_FILE="$BACKUP_DIR/config_backup_$TIMESTAMP.tar.gz"

    tar -czf "$CONFIG_BACKUP_FILE" \
        .env \
        docker-compose.yml \
        nginx/ \
        2>/dev/null || true

    log_info "Config backup completed: $CONFIG_BACKUP_FILE"
}

cleanup_old_backups() {
    log_info "Cleaning up backups older than $RETENTION_DAYS days..."

    find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete

    log_info "Cleanup completed"
}

show_backup_summary() {
    log_info "Backup summary:"
    echo ""
    echo "Timestamp: $TIMESTAMP"
    echo "Location: $BACKUP_DIR"
    echo ""
    echo "Files created:"
    ls -lh "$BACKUP_DIR"/*_$TIMESTAMP.* 2>/dev/null | awk '{print "  " $9, "(" $5 ")"}'
    echo ""

    # Calculate total size
    TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | awk '{print $1}')
    echo "Total backup size: $TOTAL_SIZE"
}

# Main backup flow
main() {
    log_info "Starting backup process..."

    check_requirements
    backup_database
    backup_uploads
    backup_config
    cleanup_old_backups
    show_backup_summary

    log_info "Backup completed successfully!"
}

# Run main function
main
