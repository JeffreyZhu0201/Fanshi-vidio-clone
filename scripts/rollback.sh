#!/bin/bash

# Fanshi Video Clone - Rollback Script
# This script rolls back to a previous version

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
    ls -lh "$BACKUP_DIR"/db_backup_*.sql 2>/dev/null | awk '{print $9, "(" $5 ")"}'

    echo ""
    echo "Upload backups:"
    ls -lh "$BACKUP_DIR"/uploads_backup_*.tar.gz 2>/dev/null | awk '{print $9, "(" $5 ")"}'

    echo ""
}

select_backup() {
    list_backups

    echo ""
    read -p "Enter backup timestamp (YYYYMMDD_HHMMSS): " TIMESTAMP

    DB_BACKUP="$BACKUP_DIR/db_backup_$TIMESTAMP.sql"
    UPLOADS_BACKUP="$BACKUP_DIR/uploads_backup_$TIMESTAMP.tar.gz"

    if [ ! -f "$DB_BACKUP" ]; then
        log_error "Database backup not found: $DB_BACKUP"
        exit 1
    fi

    log_info "Selected backup: $TIMESTAMP"
}

confirm_rollback() {
    log_warn "This will restore the database and uploads to the selected backup"
    log_warn "Current data will be backed up before rollback"
    echo ""
    read -p "Are you sure you want to continue? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        log_info "Rollback cancelled"
        exit 0
    fi
}

backup_current() {
    log_info "Backing up current state before rollback..."

    CURRENT_TIMESTAMP=$(date +%Y%m%d_%H%M%S)

    # Backup current database
    if docker ps | grep -q fanshi-mysql; then
        log_info "Backing up current database..."
        docker exec fanshi-mysql mysqldump -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
            "${MYSQL_DATABASE:-fanshi_video}" > "$BACKUP_DIR/db_backup_${CURRENT_TIMESTAMP}_pre_rollback.sql" 2>/dev/null || true
    fi

    # Backup current uploads
    if [ -d "backend/uploads" ]; then
        log_info "Backing up current uploads..."
        tar -czf "$BACKUP_DIR/uploads_backup_${CURRENT_TIMESTAMP}_pre_rollback.tar.gz" backend/uploads
    fi

    log_info "Current state backed up"
}

restore_database() {
    log_info "Restoring database from backup..."

    if ! docker ps | grep -q fanshi-mysql; then
        log_error "MySQL container is not running"
        exit 1
    fi

    # Drop and recreate database
    docker exec fanshi-mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        -e "DROP DATABASE IF EXISTS ${MYSQL_DATABASE:-fanshi_video}; CREATE DATABASE ${MYSQL_DATABASE:-fanshi_video};" 2>/dev/null

    # Restore from backup
    docker exec -i fanshi-mysql mysql -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" \
        "${MYSQL_DATABASE:-fanshi_video}" < "$DB_BACKUP" 2>/dev/null

    log_info "Database restored successfully"
}

restore_uploads() {
    log_info "Restoring uploads from backup..."

    if [ -f "$UPLOADS_BACKUP" ]; then
        # Remove current uploads
        if [ -d "backend/uploads" ]; then
            rm -rf backend/uploads
        fi

        # Extract backup
        tar -xzf "$UPLOADS_BACKUP"

        log_info "Uploads restored successfully"
    else
        log_warn "No uploads backup found, skipping"
    fi
}

restart_services() {
    log_info "Restarting services..."

    docker compose restart backend

    log_info "Services restarted"
}

verify_rollback() {
    log_info "Verifying rollback..."

    # Wait for services to be ready
    sleep 5

    # Check backend health
    if curl -f http://localhost:5000/api/health &> /dev/null; then
        log_info "Backend is healthy"
    else
        log_error "Backend health check failed"
        return 1
    fi

    log_info "Rollback verification completed"
    return 0
}

# Main rollback flow
main() {
    log_info "Starting rollback process..."

    select_backup
    confirm_rollback
    backup_current
    restore_database
    restore_uploads
    restart_services

    if verify_rollback; then
        log_info "Rollback completed successfully!"
        log_info "Previous state backed up with '_pre_rollback' suffix"
    else
        log_error "Rollback verification failed!"
        log_error "Please check logs and restore manually if needed"
        exit 1
    fi
}

# Run main function
main
