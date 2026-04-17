#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_E2E="${RUN_E2E:-false}"
RUN_PERF_BENCHMARK="${RUN_PERF_BENCHMARK:-false}"

frontend_audit_file="$(mktemp)"
backend_audit_file="$(mktemp)"

cleanup() {
  rm -f "$frontend_audit_file" "$backend_audit_file"
}

trap cleanup EXIT

echo "[1/7] Verifying required project files"
for required_path in \
  "$ROOT_DIR/backend/.env.example" \
  "$ROOT_DIR/frontend/.env.example" \
  "$ROOT_DIR/README.md" \
  "$ROOT_DIR/CONTRIBUTING.md" \
  "$ROOT_DIR/docs/task/5.集成测试与优化报告.md"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Missing required file: $required_path" >&2
    exit 1
  fi
done

echo "[2/7] Checking for runtime console.log usage"
if rg -n "console\\.log\\(" \
  "$ROOT_DIR/backend/controllers" \
  "$ROOT_DIR/backend/services" \
  "$ROOT_DIR/backend/middleware" \
  "$ROOT_DIR/backend/routes" \
  "$ROOT_DIR/backend/models" \
  "$ROOT_DIR/backend/config" \
  "$ROOT_DIR/frontend/src"; then
  echo "Remove console.log statements from runtime code before deployment." >&2
  exit 1
fi

echo "[3/7] Running backend validation"
(
  cd "$ROOT_DIR/backend"
  npm run check
  npm run test:coverage
)

(
  cd "$ROOT_DIR/backend"
  set +e
  npm audit --omit=dev --json > "$backend_audit_file"
  exit 0
)

node - "$backend_audit_file" <<'NODE'
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const vulnerabilities = report.metadata?.vulnerabilities ?? {};

if ((vulnerabilities.high ?? 0) > 0 || (vulnerabilities.critical ?? 0) > 0) {
  console.error('Backend audit found high or critical vulnerabilities.');
  process.exit(1);
}

console.log(
  `Backend audit summary: moderate=${vulnerabilities.moderate ?? 0}, high=${vulnerabilities.high ?? 0}, critical=${vulnerabilities.critical ?? 0}`
);
NODE

echo "[4/7] Running frontend validation"
(
  cd "$ROOT_DIR/frontend"
  npm test
  npm run test:coverage
  npm run build
)

(
  cd "$ROOT_DIR/frontend"
  set +e
  npm audit --json > "$frontend_audit_file"
  exit 0
)

node - "$frontend_audit_file" <<'NODE'
const fs = require('node:fs');

const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const vulnerabilities = report.metadata?.vulnerabilities ?? {};

if ((vulnerabilities.high ?? 0) > 0 || (vulnerabilities.critical ?? 0) > 0) {
  console.error('Frontend audit found high or critical vulnerabilities.');
  process.exit(1);
}

console.log(
  `Frontend audit summary: moderate=${vulnerabilities.moderate ?? 0}, high=${vulnerabilities.high ?? 0}, critical=${vulnerabilities.critical ?? 0}`
);
NODE

echo "[5/7] Verifying monitoring assets"
for monitoring_path in \
  "$ROOT_DIR/ops/monitoring/README.md" \
  "$ROOT_DIR/ops/monitoring/prometheus.scrape.yml" \
  "$ROOT_DIR/ops/monitoring/alert.rules.yml"; do
  if [[ ! -f "$monitoring_path" ]]; then
    echo "Missing monitoring asset: $monitoring_path" >&2
    exit 1
  fi
done

echo "[6/7] Optional end-to-end validation"
if [[ "$RUN_E2E" == "true" ]]; then
  if ! command -v Xvfb >/dev/null 2>&1; then
    echo "RUN_E2E=true requires Xvfb to be installed on this machine." >&2
    exit 1
  fi

  (
    cd "$ROOT_DIR/frontend"
    npm run test:e2e
  )
else
  echo "Skipping Cypress run. Set RUN_E2E=true after installing Xvfb."
fi

echo "[7/7] Optional performance benchmark"
if [[ "$RUN_PERF_BENCHMARK" == "true" ]]; then
  (
    cd "$ROOT_DIR/backend"
    npm run perf:benchmark
  )
else
  echo "Skipping performance benchmark. Set RUN_PERF_BENCHMARK=true to enable."
fi

echo "Preflight checks completed successfully."
