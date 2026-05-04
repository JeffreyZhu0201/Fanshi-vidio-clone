#!/bin/bash

# Fanshi Video Clone - Health Check Script
# This script checks the health of all services

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:5000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"

# Counters
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

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

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
}

check_docker() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking Docker..."

    if docker ps &> /dev/null; then
        log_pass "Docker is running"
    else
        log_fail "Docker is not running"
    fi
}

check_containers() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking containers..."

    EXPECTED_CONTAINERS=("fanshi-mysql" "fanshi-backend" "fanshi-frontend")
    ALL_RUNNING=true

    for container in "${EXPECTED_CONTAINERS[@]}"; do
        if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            echo "  ✓ $container is running"
        else
            echo "  ✗ $container is not running"
            ALL_RUNNING=false
        fi
    done

    if [ "$ALL_RUNNING" = true ]; then
        log_pass "All containers are running"
    else
        log_fail "Some containers are not running"
    fi
}

check_mysql() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking MySQL..."

    if docker exec fanshi-mysql mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-rootpassword}" &> /dev/null; then
        log_pass "MySQL is healthy"
    else
        log_fail "MySQL is not responding"
    fi
}

check_backend() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking backend..."

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/health" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        log_pass "Backend is healthy (HTTP $HTTP_CODE)"
    else
        log_fail "Backend is not healthy (HTTP $HTTP_CODE)"
    fi
}

check_frontend() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking frontend..."

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        log_pass "Frontend is healthy (HTTP $HTTP_CODE)"
    else
        log_fail "Frontend is not healthy (HTTP $HTTP_CODE)"
    fi
}

check_disk_space() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking disk space..."

    DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')

    if [ "$DISK_USAGE" -lt 80 ]; then
        log_pass "Disk space is sufficient (${DISK_USAGE}% used)"
    elif [ "$DISK_USAGE" -lt 90 ]; then
        log_warn "Disk space is running low (${DISK_USAGE}% used)"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    else
        log_fail "Disk space is critically low (${DISK_USAGE}% used)"
    fi
}

check_memory() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking memory usage..."

    if command -v free &> /dev/null; then
        MEMORY_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2 * 100}')

        if [ "$MEMORY_USAGE" -lt 80 ]; then
            log_pass "Memory usage is normal (${MEMORY_USAGE}% used)"
        elif [ "$MEMORY_USAGE" -lt 90 ]; then
            log_warn "Memory usage is high (${MEMORY_USAGE}% used)"
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
        else
            log_fail "Memory usage is critically high (${MEMORY_USAGE}% used)"
        fi
    else
        log_warn "Cannot check memory usage (free command not available)"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    fi
}

check_logs() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    log_info "Checking for errors in logs..."

    ERROR_COUNT=$(docker compose logs --tail=100 2>&1 | grep -i "error" | wc -l)

    if [ "$ERROR_COUNT" -eq 0 ]; then
        log_pass "No errors found in recent logs"
    elif [ "$ERROR_COUNT" -lt 5 ]; then
        log_warn "Found $ERROR_COUNT errors in recent logs"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
    else
        log_fail "Found $ERROR_COUNT errors in recent logs"
    fi
}

show_summary() {
    echo ""
    echo "=========================================="
    echo "Health Check Summary"
    echo "=========================================="
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "${GREEN}Passed: $PASSED_CHECKS${NC}"
    echo -e "${RED}Failed: $FAILED_CHECKS${NC}"
    echo "=========================================="

    if [ "$FAILED_CHECKS" -eq 0 ]; then
        echo -e "${GREEN}All checks passed!${NC}"
        return 0
    else
        echo -e "${RED}Some checks failed!${NC}"
        return 1
    fi
}

# Main health check flow
main() {
    log_info "Starting health check..."
    echo ""

    check_docker
    check_containers
    check_mysql
    check_backend
    check_frontend
    check_disk_space
    check_memory
    check_logs

    show_summary
}

# Run main function
main
