#!/bin/bash

# Fanshi Video Clone - Restore Script
# This script restores from a backup

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BACKUP_DIR="./backups"

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

list_backups() {
    log_info "Available backups:"
    echo ""

    if [ ! -d "$BACKUP_DIR" ]; then
        log_error "No backup directory found"
        exit 1
    fi

    # List database backups
    echo "Database backups:"
    ls -lh "$BACKUP_DIR"/db_backup_*.sql.gz 2>/dev/null | awk '{print $9, "(" $5 ")"}'

    echo ""
    echo "Upload backups:"
    ls -lh "$BACKUP_DIR"/uploads_backup_*.tar.gz 2>/dev/null | awk '{print $9, "(" $5 ")"}'

    echo ""
    echo "Config backups:"
    ls -lh "$BACKUP_DIR"/config_backup_*.tar.gz 2>/dev/null | awk '{print $9, "(" $5 ")"}'

    echo ""
}

select_backup() {
    list_backups

    echo ""
    read -p "Enter backup timestamp (YYYYMMDD_HHMMSS): " TIMESTAMP

    DB_BACKUP="$BACKUP_DIR/db_backup_$TIMESTAMP.sql.gz"
    UPLOADS_BACKUP="$BACKUP_DIR/uploads_backup_$TIMESTAMP.tar.gz"
    CONFIG_BACKUP="$BACKUP_DIR/config_backup_$TIMESTAMP.tar.gz"

    if [ ! -f "$DB_BACKUP" ]; then
        log_error "Database backup not found: $DB_BACKUP"
        exit 1
    fi

    log_info "Selected backup: $TIMESTAMP"
}

confirm_restore() {
    log_warn "This will restore the database, uploads, and config from the selected backup"
    log_warn "Current data will be OVERWRITTEN"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        log_info "Restore cancelled"
        exit 0
    fi
}

restore_database() {
    log_info "Restoring database from backup..."

    if ! docker ps | grep -q fanshi-mysql; then
        log_error "MySQL container is not running"
        exit 1
    fi

    # Decompress backup
    gunzip -c "$DB_BACKUP" > /tmp/restore_db.sql

    # Drop and recreate database
    docker exec fanshi-mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        -e "DROP DATABASE IF EXISTS ${MYSQL_DATABASE:-fanshi_video}; CREATE DATABASE ${MYSQL_DATABASE:-fanshi_video};" 2>/dev/null

    # Restore from backup
    docker exec -i fanshi-mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        "${MYSQL_DATABASE:-fanshi_video}" < /tmp/restore_db.sql 2>/dev/null

    # Cleanup
    rm /tmp/restore_db.sql

    log_info "Database restored successfully"
}

restore_uploads() {
    log_info "Restoring uploads from backup..."

    if [ ! -f "$UPLOADS_BACKUP" ]; then
        log_warn "No uploads backup found, skipping"
        return
    fi

    # Backup current uploads
    if [ -d "backend/uploads" ]; then
        log_info "Backing up current uploads..."
        mv backend/uploads "backend/uploads.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Extract backup
    tar -xzf "$UPLOADS_BACKUP"

    log_info "Uploads restored successfully"
}

restore_config() {
    log_info "Restoring configuration from backup..."

    if [ ! -f "$CONFIG_BACKUP" ]; then
        log_warn "No config backup found, skipping"
        return
    fi

    # Backup current config
    if [ -f ".env" ]; then
        cp .env ".env.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Extract backup
    tar -xzf "$CONFIG_BACKUP"

    log_info "Configuration restored successfully"
}

verify_restore() {
    log_info "Verifying restore..."

    # Restart services
    docker compose restart backend

    # Wait for services to be ready
    sleep 10

    # Check backend health
    if curl -f http://localhost:5000/api/health &> /dev/null; then
        log_info "Backend is healthy"
    else
        log_error "Backend health check failed"
        return 1
    fi

    # Check database connection
    if docker exec fanshi-mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        -e "USE ${MYSQL_DATABASE:-fanshi_video}; SELECT COUNT(*) FROM videos;" &> /dev/null; then
        log_info "Database connection verified"
    else
        log_error "Database verification failed"
        return 1
    fi

    log_info "Restore verification completed"
    return 0
}

# Main restore flow
main() {
    log_info "Starting restore process..."

    select_backup
    confirm_restore
    restore_database
    restore_uploads
    restore_config

    if verify_restore; then
        log_info "Restore completed successfully!"
        log_info "Backup files are preserved in $BACKUP_DIR"
    else
        log_error "Restore verification failed!"
        log_error "Please check logs and restore manually if needed"
        exit 1
    fi
}

# Run main function
main
