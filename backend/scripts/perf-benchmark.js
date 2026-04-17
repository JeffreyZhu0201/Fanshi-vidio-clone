const DEFAULT_BASE_URL = 'http://127.0.0.1:5000';
const DEFAULT_ENDPOINTS = ['/', '/api/health', '/api/metrics'];

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseEndpoints = (value) => {
  if (!value) {
    return DEFAULT_ENDPOINTS;
  }

  const endpoints = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return endpoints.length > 0 ? endpoints : DEFAULT_ENDPOINTS;
};

const percentile = (values, ratio) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));

  return sorted[index];
};

const benchmarkRequest = async (url, timeoutMs) => {
  const abortController = new AbortController();
  const startedAt = performance.now();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: abortController.signal
    });

    await response.arrayBuffer();

    return {
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - startedAt
    };
  } finally {
    clearTimeout(timeout);
  }
};

const benchmarkEndpoint = async ({
  baseUrl,
  pathname,
  requests,
  concurrency,
  timeoutMs
}) => {
  const targetUrl = new URL(pathname, baseUrl).toString();
  const results = [];

  for (let completed = 0; completed < requests; completed += concurrency) {
    const batchSize = Math.min(concurrency, requests - completed);
    const batch = Array.from({ length: batchSize }, () => benchmarkRequest(targetUrl, timeoutMs));
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }

  const durations = results.map((result) => Number(result.durationMs.toFixed(2)));
  const failedRequests = results.filter((result) => !result.ok).length;
  const averageMs =
    durations.reduce((total, value) => total + value, 0) / Math.max(durations.length, 1);

  return {
    endpoint: pathname,
    requests,
    failedRequests,
    averageMs: Number(averageMs.toFixed(2)),
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    p95Ms: Number(percentile(durations, 0.95).toFixed(2))
  };
};

const printSummary = (summary) => {
  console.log(`\nBenchmark target: ${summary.baseUrl}`);
  console.log(
    `Requests per endpoint: ${summary.requests}, concurrency: ${summary.concurrency}, threshold: ${summary.thresholdMs}ms`
  );

  summary.results.forEach((result) => {
    console.log(
      [
        `- ${result.endpoint}`,
        `avg=${result.averageMs}ms`,
        `p95=${result.p95Ms}ms`,
        `min=${result.minMs}ms`,
        `max=${result.maxMs}ms`,
        `failed=${result.failedRequests}`
      ].join(' | ')
    );
  });
};

const main = async () => {
  const baseUrl = process.env.BENCHMARK_BASE_URL || DEFAULT_BASE_URL;
  const requests = parsePositiveInteger(process.env.BENCHMARK_REQUESTS, 20);
  const concurrency = parsePositiveInteger(process.env.BENCHMARK_CONCURRENCY, 5);
  const thresholdMs = parsePositiveInteger(process.env.BENCHMARK_THRESHOLD_MS, 500);
  const timeoutMs = parsePositiveInteger(process.env.BENCHMARK_TIMEOUT_MS, 5000);
  const endpoints = parseEndpoints(process.env.BENCHMARK_ENDPOINTS);

  try {
    const results = [];

    for (const endpoint of endpoints) {
      results.push(
        await benchmarkEndpoint({
          baseUrl,
          pathname: endpoint,
          requests,
          concurrency,
          timeoutMs
        })
      );
    }

    printSummary({
      baseUrl,
      concurrency,
      requests,
      thresholdMs,
      results
    });

    const hasFailedRequests = results.some((result) => result.failedRequests > 0);
    const exceedsThreshold = results.some((result) => result.averageMs > thresholdMs);

    if (hasFailedRequests || exceedsThreshold) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `Benchmark failed against ${baseUrl}. Make sure the backend is running before retrying.`
    );
    console.error(error.message);
    process.exitCode = 1;
  }
};

await main();
