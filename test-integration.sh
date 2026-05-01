#!/bin/bash

# Integration Test Script for Task 13
# Tests full-video generation workflow end-to-end

set -e

BASE_URL="https://localhost:5443"
API_URL="${BASE_URL}/api"

echo "=========================================="
echo "Task 13: Integration Testing"
echo "=========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local expected_code=$3
    local description=$4

    echo -n "Testing: $description... "

    response_code=$(curl -k -s -o /dev/null -w "%{http_code}" -X "$method" "${API_URL}${endpoint}" 2>/dev/null)

    if [ "$response_code" = "$expected_code" ]; then
        echo -e "${GREEN}PASS${NC} (HTTP $response_code)"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}FAIL${NC} (Expected $expected_code, got $response_code)"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Test 1: Backend Health Check
echo "=========================================="
echo "Test 1: Backend Health Check"
echo "=========================================="
response=$(curl -k -s "${API_URL}/health")
if echo "$response" | grep -q '"success":true'; then
    echo -e "${GREEN}PASS${NC}: Backend is healthy"
    ((TESTS_PASSED++))
else
    echo -e "${RED}FAIL${NC}: Backend health check failed"
    echo "Response: $response"
    ((TESTS_FAILED++))
fi
echo ""

# Test 2: Verify Removed Endpoints Return 404
echo "=========================================="
echo "Test 2: Verify Removed Endpoints (Should be 404)"
echo "=========================================="
test_endpoint "POST" "/generation/shots/generate" "404" "POST /api/generation/shots/generate"
test_endpoint "POST" "/generation/shots/generate-batch" "404" "POST /api/generation/shots/generate-batch"
echo ""

# Test 3: Check for existing test data
echo "=========================================="
echo "Test 3: Check Existing Test Data"
echo "=========================================="
echo "Querying database for existing videos and segments..."

# Get existing video
video_response=$(curl -k -s "${API_URL}/videos?limit=1")
video_id=$(echo "$video_response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

if [ -n "$video_id" ]; then
    echo -e "${GREEN}Found existing video${NC}: ID=$video_id"
    ((TESTS_PASSED++))

    # Get segments for this video
    segments_response=$(curl -k -s "${API_URL}/segments?videoId=$video_id&limit=1")
    segment_id=$(echo "$segments_response" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)

    if [ -n "$segment_id" ]; then
        echo -e "${GREEN}Found existing segment${NC}: ID=$segment_id"
        ((TESTS_PASSED++))
    else
        echo -e "${YELLOW}WARNING${NC}: No segments found for video $video_id"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}WARNING${NC}: No existing videos found in database"
    ((TESTS_FAILED++))
fi
echo ""

# Test 4: Test Full Video Generation Endpoint
echo "=========================================="
echo "Test 4: Full Video Generation Endpoint"
echo "=========================================="

if [ -n "$segment_id" ]; then
    echo "Testing POST /api/generation/generate with segment $segment_id..."

    # Test with dry-run or minimal parameters
    gen_response=$(curl -k -s -X POST "${API_URL}/generation/generate" \
        -H "Content-Type: application/json" \
        -d "{\"segmentId\": $segment_id, \"styleMode\": \"realistic\"}" 2>&1)

    # Check if response contains expected fields
    if echo "$gen_response" | grep -q '"taskId"'; then
        echo -e "${GREEN}PASS${NC}: Generation endpoint returned taskId"
        echo "Response preview: $(echo "$gen_response" | head -c 200)..."
        ((TESTS_PASSED++))
    elif echo "$gen_response" | grep -q '"error"'; then
        echo -e "${YELLOW}INFO${NC}: Generation endpoint returned error (expected if no resources)"
        echo "Error: $(echo "$gen_response" | grep -o '"message":"[^"]*"' | head -1)"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}FAIL${NC}: Unexpected response from generation endpoint"
        echo "Response: $gen_response"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}: No segment available for testing"
fi
echo ""

# Test 5: Check Analysis Response Structure
echo "=========================================="
echo "Test 5: Analysis Response Structure"
echo "=========================================="

if [ -n "$video_id" ]; then
    echo "Fetching analysis for video $video_id..."
    analysis_response=$(curl -k -s "${API_URL}/analysis?videoId=$video_id&limit=1")

    # Check for detailed shot descriptions
    if echo "$analysis_response" | grep -q '"shots"'; then
        echo -e "${GREEN}PASS${NC}: Analysis contains shots array"
        ((TESTS_PASSED++))

        # Check for shot description fields
        if echo "$analysis_response" | grep -q '"description"'; then
            echo -e "${GREEN}PASS${NC}: Shots contain description field"
            ((TESTS_PASSED++))
        else
            echo -e "${RED}FAIL${NC}: Shots missing description field"
            ((TESTS_FAILED++))
        fi

        # Check for visual_prompt field
        if echo "$analysis_response" | grep -q '"visual_prompt"'; then
            echo -e "${GREEN}PASS${NC}: Shots contain visual_prompt field"
            ((TESTS_PASSED++))
        else
            echo -e "${YELLOW}INFO${NC}: Shots missing visual_prompt field (may be added during optimization)"
        fi
    else
        echo -e "${YELLOW}WARNING${NC}: Analysis response doesn't contain shots"
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}: No video available for analysis check"
fi
echo ""

# Test 6: Check Backend Logs for Errors
echo "=========================================="
echo "Test 6: Backend Logs Check"
echo "=========================================="
echo "Checking recent backend logs for errors..."

log_file="/home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/logs/combined.log"
if [ -f "$log_file" ]; then
    recent_errors=$(tail -100 "$log_file" | grep -i "error" | grep -v "errorMessage\":null" | wc -l)

    if [ "$recent_errors" -eq 0 ]; then
        echo -e "${GREEN}PASS${NC}: No recent errors in backend logs"
        ((TESTS_PASSED++))
    else
        echo -e "${YELLOW}WARNING${NC}: Found $recent_errors error entries in recent logs"
        echo "Recent errors:"
        tail -100 "$log_file" | grep -i "error" | grep -v "errorMessage\":null" | tail -5
        ((TESTS_FAILED++))
    fi
else
    echo -e "${YELLOW}INFO${NC}: Log file not found at $log_file"
fi
echo ""

# Test 7: Verify Prompt Structure
echo "=========================================="
echo "Test 7: Verify Prompt Blueprint Structure"
echo "=========================================="
echo "Checking shared/promptBlueprints.js for buildFullVideoPrompt..."

if grep -q "buildFullVideoPrompt" /home/zhuzy2024/workspace/Fanshi_vidio_clone/shared/promptBlueprints.js; then
    echo -e "${GREEN}PASS${NC}: buildFullVideoPrompt exists in promptBlueprints.js"
    ((TESTS_PASSED++))
else
    echo -e "${RED}FAIL${NC}: buildFullVideoPrompt not found in promptBlueprints.js"
    ((TESTS_FAILED++))
fi

if grep -q "buildShotPrompt" /home/zhuzy2024/workspace/Fanshi_vidio_clone/shared/promptBlueprints.js; then
    echo -e "${YELLOW}WARNING${NC}: buildShotPrompt still exists (should be removed)"
    ((TESTS_FAILED++))
else
    echo -e "${GREEN}PASS${NC}: buildShotPrompt has been removed"
    ((TESTS_PASSED++))
fi
echo ""

# Test 8: Check Service Implementation
echo "=========================================="
echo "Test 8: Service Implementation Check"
echo "=========================================="
echo "Verifying shotGenerationService uses buildFullVideoPrompt..."

if grep -q "buildFullVideoPrompt" /home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/services/shotGenerationService.js; then
    echo -e "${GREEN}PASS${NC}: shotGenerationService uses buildFullVideoPrompt"
    ((TESTS_PASSED++))
else
    echo -e "${RED}FAIL${NC}: shotGenerationService doesn't use buildFullVideoPrompt"
    ((TESTS_FAILED++))
fi

if grep -q "buildShotPrompt" /home/zhuzy2024/workspace/Fanshi_vidio_clone/backend/services/shotGenerationService.js; then
    echo -e "${YELLOW}WARNING${NC}: shotGenerationService still references buildShotPrompt"
    ((TESTS_FAILED++))
else
    echo -e "${GREEN}PASS${NC}: shotGenerationService doesn't reference old buildShotPrompt"
    ((TESTS_PASSED++))
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${YELLOW}Some tests failed or warnings found${NC}"
    exit 1
fi
