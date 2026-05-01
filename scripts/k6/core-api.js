import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// k6 run -e BASE_URL=http://127.0.0.1:9090 core-api.js
// Docker: -e BASE_URL=http://host.docker.internal:9090
// `http_req_failed` counts 4xx; /v1/games returns 429 when per-IP limit is hit — that is expected.
// All `check()` assertions pass when status is 200 (or 200|429 for games). See k6 output `checks_succeeded`.
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:9090'
const base = String(BASE).replace(/\/$/, '')

const pathByName = {
  health: '/health',
  ready: '/health/ready',
  operational: '/health/operational',
  games: '/v1/games',
}

const failUnexpected = new Rate('unexpected_failures')
const durHealth = new Trend('duration_ms_health', true)
const durReady = new Trend('duration_ms_ready', true)
const durOp = new Trend('duration_ms_operational', true)
const durGames = new Trend('duration_ms_games', true)

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '45s', target: 80 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    unexpected_failures: ['rate<0.05'],
    http_req_duration: ['p(95)<3000'],
  },
}

const paths = [
  { name: 'health', w: 4, expect: (s) => s === 200 },
  { name: 'ready', w: 2, expect: (s) => s === 200 },
  { name: 'operational', w: 1, expect: (s) => s === 200 },
  { name: 'games', w: 2, expect: (s) => s === 200 || s === 429 },
]

function pick() {
  const total = paths.reduce((a, p) => a + p.w, 0)
  let r = Math.random() * total
  for (const p of paths) {
    r -= p.w
    if (r <= 0) return p
  }
  return paths[0]
}

function recordDuration(name, ms) {
  switch (name) {
    case 'health':
      durHealth.add(ms)
      break
    case 'ready':
      durReady.add(ms)
      break
    case 'operational':
      durOp.add(ms)
      break
    case 'games':
      durGames.add(ms)
      break
  }
}

export default function () {
  const p = pick()
  const url = base + pathByName[p.name]
  const res = http.get(url, { tags: { endpoint: p.name } })
  recordDuration(p.name, res.timings.duration)
  const ok = p.expect(res.status)
  failUnexpected.add(ok ? 0 : 1)
  check(res, { [`${p.name} status ok`]: () => ok })
  sleep(0.05)
}
