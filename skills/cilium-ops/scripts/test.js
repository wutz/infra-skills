#!/usr/bin/env node

'use strict';

const { parseArgs, computeHealth, formatText } = require('./cilium-diag');

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
  const args = parseArgs(['node', 'cilium-diag.js']);
  assert(args.namespace === 'kube-system', 'default namespace is kube-system');
  assert(args.json === false, 'default json is false');
})();

(() => {
  const args = parseArgs(['node', 'cilium-diag.js', '--json']);
  assert(args.json === true, '--json flag sets json to true');
})();

(() => {
  const args = parseArgs(['node', 'cilium-diag.js', '--namespace', 'custom-ns']);
  assert(args.namespace === 'custom-ns', '--namespace sets namespace');
})();

(() => {
  const args = parseArgs(['node', 'cilium-diag.js', '--namespace=my-ns', '--json']);
  assert(args.namespace === 'my-ns', '--namespace=value syntax works');
  assert(args.json === true, 'combines with --json');
})();

// --- computeHealth tests ---

section('computeHealth');

(() => {
  const checks = {
    crds: { status: 'ok', message: 'All CRDs installed' },
    pods: { status: 'ok', message: 'All healthy' },
    ciliumNodes: { status: 'ok', message: '3 nodes registered' },
    endpoints: { status: 'ok', message: '10 endpoints ready' },
    networkPolicies: { status: 'info', message: 'No policies' },
    hubble: { status: 'ok', message: 'Relay ready' },
    services: { status: 'ok', message: '3 services' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'HEALTHY', 'all ok → HEALTHY');
  assert(h.issues.length === 0, 'no issues');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'warning', message: '1 agent unhealthy' },
    ciliumNodes: { status: 'ok', message: 'ok' },
    endpoints: { status: 'ok', message: 'ok' },
    networkPolicies: { status: 'ok', message: 'ok' },
    hubble: { status: 'ok', message: 'ok' },
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
    ciliumNodes: { status: 'critical', message: 'No nodes' },
    endpoints: { status: 'info', message: 'No endpoints' },
    networkPolicies: { status: 'info', message: 'No policies' },
    hubble: { status: 'info', message: 'Not deployed' },
    services: { status: 'warning', message: '1 pending' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'CRITICAL', 'critical checks → CRITICAL');
  assert(h.issues.length === 4, '4 issues (3 critical + 1 warning)');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'error', message: 'Unable to query' },
    ciliumNodes: { status: 'ok', message: 'ok' },
    endpoints: { status: 'ok', message: 'ok' },
    networkPolicies: { status: 'ok', message: 'ok' },
    hubble: { status: 'ok', message: 'ok' },
    services: { status: 'ok', message: 'ok' },
  };
  const h = computeHealth(checks);
  assert(h.overall === 'ERROR', 'error check → ERROR');
})();

(() => {
  const checks = {
    crds: { status: 'ok', message: 'ok' },
    pods: { status: 'warning', message: 'w1' },
    ciliumNodes: { status: 'ok', message: 'ok' },
    endpoints: { status: 'warning', message: 'w2' },
    networkPolicies: { status: 'ok', message: 'ok' },
    hubble: { status: 'warning', message: 'w3' },
    services: { status: 'ok', message: 'ok' },
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
      crds: { status: 'ok', message: 'All Cilium CRDs installed', found: ['ciliumnetworkpolicies.cilium.io'], missing: [] },
      pods: {
        status: 'ok',
        message: '3 agent(s) healthy, 2 operator(s) healthy',
        agents: [
          { name: 'cilium-abc', node: 'node-1', phase: 'Running', ready: true, restarts: 0 },
          { name: 'cilium-def', node: 'node-2', phase: 'Running', ready: true, restarts: 0 },
          { name: 'cilium-ghi', node: 'node-3', phase: 'Running', ready: true, restarts: 0 },
        ],
        operators: [
          { name: 'cilium-operator-abc', node: 'node-1', phase: 'Running', ready: true, restarts: 0 },
          { name: 'cilium-operator-def', node: 'node-2', phase: 'Running', ready: true, restarts: 0 },
        ],
      },
      ciliumNodes: { status: 'ok', message: '3 CiliumNode(s) registered', nodes: [
        { name: 'node-1', podCIDRs: ['10.244.0.0/24'], healthIP: '10.244.0.1' },
        { name: 'node-2', podCIDRs: ['10.244.1.0/24'], healthIP: '10.244.1.1' },
      ]},
      endpoints: { status: 'ok', message: '15 endpoint(s) all ready', total: 15, ready: 15, notReady: 0 },
      networkPolicies: { status: 'ok', message: '2 CNP + 1 CCNP network policy(ies) configured', cnp: [
        { name: 'allow-http', namespace: 'default' },
        { name: 'deny-egress', namespace: 'production' },
      ], ccnp: [
        { name: 'global-deny' },
      ]},
      hubble: { status: 'ok', message: 'Hubble Relay: 1/1 ready, UI: 1/1 ready', relay: { total: 1, ready: 1 }, ui: { total: 1, ready: 1 } },
      services: { status: 'ok', message: '2 service(s) with ExternalIP assigned', services: [
        { name: 'web', namespace: 'default', externalIP: '192.168.1.240', ports: ['80/TCP'], pending: false },
      ]},
    },
    namespace: 'kube-system',
  };
  const text = formatText(report);
  assert(text.includes('Cilium 诊断报告'), 'contains report title');
  assert(text.includes('HEALTHY'), 'contains HEALTHY status');
  assert(text.includes('3 healthy'), 'contains agent count');
  assert(text.includes('10.244.0.0/24'), 'contains pod CIDR');
  assert(text.includes('allow-http'), 'contains CNP name');
  assert(text.includes('global-deny'), 'contains CCNP name');
  assert(text.includes('Hubble'), 'contains Hubble section');
  assert(text.includes('web'), 'contains service name');
  assert(!text.includes('发现的问题'), 'no issues section for healthy');
})();

(() => {
  const report = {
    health: { overall: 'WARNING', issues: [{ check: 'endpoints', status: 'warning', message: '2 not ready' }] },
    checks: {
      crds: { status: 'ok', message: 'ok', found: [], missing: [] },
      pods: { status: 'ok', message: 'ok', agents: [], operators: [] },
      ciliumNodes: { status: 'ok', message: 'ok', nodes: [] },
      endpoints: { status: 'warning', message: '2/10 endpoint(s) not ready', total: 10, ready: 8, notReady: 2 },
      networkPolicies: { status: 'info', message: 'No policies', cnp: [], ccnp: [] },
      hubble: { status: 'info', message: 'Not deployed', relay: { total: 0, ready: 0 }, ui: { total: 0, ready: 0 } },
      services: { status: 'ok', message: 'ok', services: [] },
    },
    namespace: 'kube-system',
  };
  const text = formatText(report);
  assert(text.includes('WARNING'), 'contains WARNING');
  assert(text.includes('发现的问题'), 'includes issues section');
  assert(text.includes('2 not ready'), 'includes issue detail');
})();

// --- Summary ---

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
