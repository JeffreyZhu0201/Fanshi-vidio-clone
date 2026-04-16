#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${1:-${PROJECT_ROOT}/certs/dev}"
KEY_PATH="${OUTPUT_DIR}/localhost-key.pem"
CERT_PATH="${OUTPUT_DIR}/localhost.pem"

mkdir -p "${OUTPUT_DIR}"

openssl req \
  -x509 \
  -nodes \
  -days 365 \
  -newkey rsa:2048 \
  -keyout "${KEY_PATH}" \
  -out "${CERT_PATH}" \
  -subj "/C=CN/ST=Shanghai/L=Shanghai/O=Fanshi/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

echo "Generated development SSL certificate:"
echo "  Key : ${KEY_PATH}"
echo "  Cert: ${CERT_PATH}"
