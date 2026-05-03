# Network Setup for Doubao-Seed Integration

## Current Status

The Doubao-Seed temporal-aware API integration requires publicly accessible video URLs. The current frp tunnel configuration is experiencing connectivity issues.

## Configuration

### Environment Variables

```bash
# Backend server ports
PORT=5000                    # Local HTTP server
HTTPS_PORT=5443             # Local HTTPS server

# Public URLs (via frp tunnel)
SEED_DANCE_PUBLIC_ASSET_BASE_URL=http://yd.frp-fox.com:42733   # For Doubao-Seed (HTTP required)
PUBLIC_ASSET_BASE_URL=https://yd.frp-fox.com:42734             # For other services (HTTPS)
```

### Current Issue

**Symptom**: Connection refused / 502 Bad Gateway when accessing `http://yd.frp-fox.com:42733`

**Diagnosis** (as of test on 2024):
```bash
$ curl -I http://yd.frp-fox.com:42733/uploads/test-video.mp4
HTTP/1.1 502 Bad Gateway
```

**Root Cause**: The frp tunnel on port 42733 is not properly forwarding traffic to the local backend server on port 5000.

## Required Setup

### 1. FRP Client Configuration

The frp client needs to be configured to tunnel:
- Port 42733 (HTTP) → localhost:5000
- Port 42734 (HTTPS) → localhost:5443

Example `frpc.ini`:
```ini
[common]
server_addr = yd.frp-fox.com
server_port = 7000

[http_tunnel]
type = tcp
local_ip = 127.0.0.1
local_port = 5000
remote_port = 42733

[https_tunnel]
type = tcp
local_ip = 127.0.0.1
local_port = 5443
remote_port = 42734
```

### 2. Backend Server

Ensure the backend HTTP server is running:
```bash
cd backend
npm start
```

The server should be listening on:
- HTTP: `http://localhost:5000`
- HTTPS: `https://localhost:5443`

### 3. Verification

Test local access:
```bash
curl -I http://localhost:5000/uploads/test-video.mp4
```

Test public access (after frp is running):
```bash
curl -I http://yd.frp-fox.com:42733/uploads/test-video.mp4
```

Expected response: `HTTP/1.1 200 OK` or `HTTP/1.1 404 Not Found` (if file doesn't exist)

## Alternative Solutions

If frp tunneling is not available, consider:

1. **ngrok**: Quick temporary public URL
   ```bash
   ngrok http 5000
   # Update SEED_DANCE_PUBLIC_ASSET_BASE_URL with the ngrok URL
   ```

2. **Direct public IP**: If server has a public IP
   ```bash
   SEED_DANCE_PUBLIC_ASSET_BASE_URL=http://your-public-ip:5000
   ```

3. **Cloud storage**: Upload videos to S3/OSS and use those URLs
   - Requires implementing upload-to-cloud functionality
   - More reliable for production use

## Testing Doubao-Seed Integration

Once network connectivity is established:

```bash
cd backend
node test-doubao-temporal.js
```

This will test the temporal-aware API with a sample video at FPS=5.
