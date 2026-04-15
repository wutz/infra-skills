#!/usr/bin/env node

'use strict';

const { parseArgs, computeHealth, formatText } = require('./metallb-diag');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// --- parseArgs tests ---

section('parseArgs');

(() => {
  const args = parseArgs(['node', 'metallb-diag.js']);
  assert(args.namespace === 'metallb-system', 'default namespace is metallb-system');
  assert(args.json === false, 'default json is false');
})();

(() => {
  const args = parseArgs(['node', 'metallb-diag.js', '--json']);
  assert(args.json === true, '--json flag sets json to true');
})();

(() => {
  const args = parseArgs(['node', 'metallb-diag.js', '--namespace', 'custom-ns']);
  assert(args.namespace === 'custom-ns', '--namespace sets namespace');
})();

(() => {
  const args = parseArgs(['node', 'metallb-diag.js', '--namespace=my-ns', '--json']);
  assert(args.namespace === 'my-ns', '--namespace=value syntax works');
  assert(args.json === true, 'combines with --json');
})();

// --- computeHealth tests ---

section('computeHealth');

(() => {
  const checks = {
    crds: { status: 'ok', message: 'All CRDs installed' },
    pods: { status: 'ok', message: 'All healthy' },
    ipPools: { status: 'ok', message: '1 pool configured' },
    advertisements: { status: 'ok', message: '1 L2 advertisement' },
    bgpPeers: { status: 'info', message: 'No BGP peers (L2 only)' },
    services: { status: 'ok', message: '3 services' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'HEALTHY', 'all ok → HEALTHY');
  assert(h.issues.length === 0, 'no issues');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'warning', message: '1 speaker unhealthy' },
    ipPools: { status: 'ok', message: 'ok' },
    advertisements: { status: 'ok', message: 'ok' },
    bgpPeers: { status: 'ok', message: 'ok' },
    services: { status: 'ok', message: 'ok' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'WARNING', 'one warning → WARNING');
  assert(h.issues.length === 1, '1 issue found');
  assert(h.issues[0].check === 'pods', 'issue is from pods check');
})();

(() => {
  const checks = {
    crds: { status: 'critical', message: 'Core CRDs missing' },
    pods: { status: 'critical', message: 'No pods' },
    ipPools: { status: 'critical', message: 'No pools' },
    advertisements: { status: 'critical', message: 'No ads' },
    bgpPeers: { status: 'info', message: 'none' },
    services: { status: 'warning', message: '1 pending' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'CRITICAL', 'critical checks → CRITICAL');
  assert(h.issues.length === 5, '5 issues (4 critical + 1 warning)');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'error', message: 'Unable to query' },
    ipPools: { status: 'ok', message: 'ok' },
    advertisements: { status: 'ok', message: 'ok' },
    bgpPeers: { status: 'ok', message: 'ok' },
    services: { status: 'ok', message: 'ok' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'ERROR', 'error check → ERROR');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'warning', message: 'w1' },
    ipPools: { status: 'ok', message: 'ok' },
    advertisements: { status: 'warning', message: 'w2' },
    bgpPeers: { status: 'ok', message: 'ok' },
    services: { status: 'warning', message: 'w3' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'WARNING', 'multiple warnings → WARNING');
  assert(h.issues.length === 3, '3 warning issues');
})();

// --- formatText tests ---

section('formatText');

(() => {
  const report = {
    health: { overall: 'HEALTHY', issues: [] },
    checks: {
      crds: { status: 'ok', message: 'All CRDs installed', found: ['ipaddresspools.metallb.io'], missing: [] },
      pods: {
        status: 'ok',
        message: 'Controller ready, 3 speakers healthy',
        controller: { name: 'controller-abc', node: 'node-1', phase: 'Running', ready: true, restarts: 0 },
        speakers: [
          { name: 'speaker-1', node: 'node-1', phase: 'Running', ready: true, restarts: 0 },
          { name: 'speaker-2', node: 'node-2', phase: 'Running', ready: true, restarts: 0 },
        ],
      },
      ipPools: { status: 'ok', message: '1 pool configured', pools: [{ name: 'default', addresses: ['192.168.1.240-192.168.1.250'], autoAssign: true }] },
      advertisements: { status: 'ok', message: '1 L2 advertisement', l2: [{ name: 'l2adv', ipAddressPools: ['default'] }], bgp: [] },
      bgpPeers: { status: 'info', message: 'No BGP peers', peers: [] },
      services: { status: 'ok', message: '2 services', services: [
        { name: 'web', namespace: 'default', externalIP: '192.168.1.240', ports: ['80/TCP'], pool: 'default', pending: false },
      ]},
    },
    namespace: 'metallb-system',
  };
  const text = formatText(report);
  assert(text.includes('MetalLB 诊断报告'), 'contains report title');
  assert(text.includes('HEALTHY'), 'contains HEALTHY status');
  assert(text.includes('controller-abc'), 'contains controller name');
  assert(text.includes('speaker-1'), 'contains speaker name');
  assert(text.includes('192.168.1.240-192.168.1.250'), 'contains IP range');
  assert(text.includes('web'), 'contains service name');
  assert(!text.includes('发现的问题'), 'no issues section for healthy');
})();

(() => {
  const report = {
    health: { overall: 'WARNING', issues: [{ check: 'services', status: 'warning', message: '1 pending' }] },
    checks: {
      crds: { status: 'ok', message: 'ok', found: [], missing: [] },
      pods: { status: 'ok', message: 'ok', controller: null, speakers: [] },
      ipPools: { status: 'ok', message: 'ok', pools: [] },
      advertisements: { status: 'ok', message: 'ok', l2: [], bgp: [] },
      bgpPeers: { status: 'ok', message: 'ok', peers: [] },
      services: { status: 'warning', message: '1 pending', services: [] },
    },
    namespace: 'metallb-system',
  };
  const text = formatText(report);
  assert(text.includes('WARNING'), 'contains WARNING');
  assert(text.includes('发现的问题'), 'includes issues section');
  assert(text.includes('1 pending'), 'includes issue detail');
})();

// --- Summary ---

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
