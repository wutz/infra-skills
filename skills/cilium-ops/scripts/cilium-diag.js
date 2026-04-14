#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');

// --- CLI Argument Parsing ---

function parseArgs(argv) {
  const args = { namespace: 'kube-system', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--namespace' && argv[i + 1]) {
      args.namespace = argv[++i];
    } else if (argv[i].startsWith('--namespace=')) {
      args.namespace = argv[i].split('=')[1];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`Cilium Diagnostics Tool

Usage: node cilium-diag.js [options]

Options:
  --namespace <ns>   Cilium namespace (default: kube-system)
  --json             Output in JSON format
  -h, --help         Show this help`);
      process.exit(0);
    }
  }
  return args;
}

// --- kubectl helpers ---

function kubectl(cmd, opts = {}) {
  try {
    const result = execSync(`kubectl ${cmd}`, {
      encoding: 'utf-8',
      timeout: opts.timeout || 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: result.trim() };
  } catch (err) {
    return { ok: false, stderr: (err.stderr || err.message || '').trim() };
  }
}

function kubectlJSON(cmd, opts) {
  const res = kubectl(`${cmd} -o json`, opts);
  if (!res.ok) return { ok: false, data: null, stderr: res.stderr };
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    return { ok: false, data: null, stderr: 'Failed to parse JSON output' };
  }
}

// --- Check functions ---

function checkCRDs() {
  const expectedCRDs = [
    'ciliumnetworkpolicies.cilium.io',
    'ciliumclusterwidenetworkpolicies.cilium.io',
    'ciliumendpoints.cilium.io',
    'ciliumidentities.cilium.io',
    'ciliumnodes.cilium.io',
    'ciliumexternalworkloads.cilium.io',
    'ciliumloadbalancerippools.cilium.io',
    'ciliuml2announcementpolicies.cilium.io',
    'ciliumbgppeeringpolicies.cilium.io',
  ];
  const res = kubectl('get crd --no-headers -o custom-columns=NAME:.metadata.name');
  if (!res.ok) {
    return { status: 'error', message: 'Unable to query CRDs', found: [], missing: expectedCRDs };
  }
  const installedCRDs = res.stdout.split('\n').filter(Boolean);
  const found = expectedCRDs.filter(c => installedCRDs.includes(c));
  const missing = expectedCRDs.filter(c => !installedCRDs.includes(c));
  const coreRequired = [
    'ciliumnetworkpolicies.cilium.io',
    'ciliumendpoints.cilium.io',
    'ciliumnodes.cilium.io',
    'ciliumidentities.cilium.io',
  ];
  const coreMissing = coreRequired.filter(c => missing.includes(c));
  return {
    status: coreMissing.length > 0 ? 'critical' : missing.length > 0 ? 'warning' : 'ok',
    message: coreMissing.length > 0
      ? `Core CRDs missing: ${coreMissing.join(', ')}`
      : missing.length > 0
        ? `Optional CRDs missing: ${missing.join(', ')}. Core CRDs present.`
        : 'All Cilium CRDs installed',
    found,
    missing,
  };
}

function checkPods(namespace) {
  const agentRes = kubectlJSON(`get pods -n ${namespace} -l k8s-app=cilium`);
  const operatorRes = kubectlJSON(`get pods -n ${namespace} -l app.kubernetes.io/name=cilium-operator`);

  // Fallback: some installs use io.cilium/app=operator label
  let operatorPods = operatorRes.ok ? (operatorRes.data.items || []) : [];
  if (operatorPods.length === 0) {
    const fallback = kubectlJSON(`get pods -n ${namespace} -l io.cilium/app=operator`);
    if (fallback.ok) operatorPods = fallback.data.items || [];
  }

  const agentPods = agentRes.ok ? (agentRes.data.items || []) : [];

  if (!agentRes.ok && !operatorRes.ok) {
    return {
      status: 'error',
      message: `Unable to query Cilium pods in ${namespace}`,
      agents: [],
      operators: [],
    };
  }

  if (agentPods.length === 0 && operatorPods.length === 0) {
    return {
      status: 'critical',
      message: `No Cilium pods found in ${namespace}`,
      agents: [],
      operators: [],
    };
  }

  const podSummary = (p) => {
    const phase = p.status.phase;
    const ready = (p.status.conditions || []).find(c => c.type === 'Ready');
    const restarts = (p.status.containerStatuses || []).reduce((s, c) => s + c.restartCount, 0);
    return {
      name: p.metadata.name,
      node: p.spec.nodeName,
      phase,
      ready: ready ? ready.status === 'True' : false,
      restarts,
    };
  };

  const agentSummaries = agentPods.map(podSummary);
  const operatorSummaries = operatorPods.map(podSummary);
  const unhealthyAgents = agentSummaries.filter(s => !s.ready || s.phase !== 'Running');
  const unhealthyOperators = operatorSummaries.filter(s => !s.ready || s.phase !== 'Running');

  let status = 'ok';
  let message = '';

  if (agentSummaries.length === 0) {
    status = 'critical';
    message = 'No cilium-agent pods found';
  } else if (operatorSummaries.length === 0) {
    status = 'critical';
    message = 'No cilium-operator pods found';
  } else if (unhealthyOperators.length === operatorSummaries.length) {
    status = 'critical';
    message = 'All cilium-operator pods unhealthy';
  } else if (unhealthyAgents.length > 0) {
    status = unhealthyAgents.length === agentSummaries.length ? 'critical' : 'warning';
    message = `${unhealthyAgents.length}/${agentSummaries.length} agent(s) unhealthy`;
  } else {
    message = `${agentSummaries.length} agent(s) healthy, ${operatorSummaries.length} operator(s) healthy`;
  }

  return { status, message, agents: agentSummaries, operators: operatorSummaries };
}

function checkCiliumNodes() {
  const res = kubectlJSON('get ciliumnodes');
  if (!res.ok) {
    return { status: 'error', message: `Unable to query CiliumNodes: ${res.stderr}`, nodes: [] };
  }
  const nodes = (res.data.items || []).map(n => {
    const allocCIDRs = (n.spec.ipam || {}).podCIDRs || [];
    const healthIP = ((n.spec.health || {}).ipv4) || null;
    return {
      name: n.metadata.name,
      podCIDRs: allocCIDRs,
      healthIP,
    };
  });

  if (nodes.length === 0) {
    return { status: 'critical', message: 'No CiliumNodes found', nodes: [] };
  }
  return { status: 'ok', message: `${nodes.length} CiliumNode(s) registered`, nodes };
}

function checkEndpoints(namespace) {
  const res = kubectlJSON('get ciliumendpoints -A');
  if (!res.ok) {
    return { status: 'error', message: `Unable to query CiliumEndpoints: ${res.stderr}`, total: 0, ready: 0, notReady: 0 };
  }
  const endpoints = res.data.items || [];
  const total = endpoints.length;
  const ready = endpoints.filter(e => {
    const state = ((e.status || {}).state);
    return state === 'ready';
  }).length;
  const notReady = total - ready;

  if (total === 0) {
    return { status: 'info', message: 'No CiliumEndpoints found', total: 0, ready: 0, notReady: 0 };
  }
  if (notReady > 0) {
    return {
      status: 'warning',
      message: `${notReady}/${total} endpoint(s) not ready`,
      total,
      ready,
      notReady,
    };
  }
  return { status: 'ok', message: `${total} endpoint(s) all ready`, total, ready, notReady: 0 };
}

function checkNetworkPolicies() {
  const cnpRes = kubectlJSON('get ciliumnetworkpolicies -A');
  const ccnpRes = kubectlJSON('get ciliumclusterwidenetworkpolicies');

  const cnps = cnpRes.ok ? (cnpRes.data.items || []) : [];
  const ccnps = ccnpRes.ok ? (ccnpRes.data.items || []) : [];

  const cnpSummaries = cnps.map(p => ({
    name: p.metadata.name,
    namespace: p.metadata.namespace,
  }));
  const ccnpSummaries = ccnps.map(p => ({
    name: p.metadata.name,
  }));

  const total = cnps.length + ccnps.length;
  if (total === 0) {
    return {
      status: 'info',
      message: 'No CiliumNetworkPolicies configured (default-allow)',
      cnp: cnpSummaries,
      ccnp: ccnpSummaries,
    };
  }

  const parts = [];
  if (cnps.length > 0) parts.push(`${cnps.length} CNP`);
  if (ccnps.length > 0) parts.push(`${ccnps.length} CCNP`);
  return {
    status: 'ok',
    message: `${parts.join(' + ')} network policy(ies) configured`,
    cnp: cnpSummaries,
    ccnp: ccnpSummaries,
  };
}

function checkHubble(namespace) {
  const relayRes = kubectlJSON(`get pods -n ${namespace} -l app.kubernetes.io/name=hubble-relay`);
  // Fallback label
  let relayPods = relayRes.ok ? (relayRes.data.items || []) : [];
  if (relayPods.length === 0) {
    const fallback = kubectlJSON(`get pods -n ${namespace} -l k8s-app=hubble-relay`);
    if (fallback.ok) relayPods = fallback.data.items || [];
  }

  const uiRes = kubectlJSON(`get pods -n ${namespace} -l app.kubernetes.io/name=hubble-ui`);
  let uiPods = uiRes.ok ? (uiRes.data.items || []) : [];
  if (uiPods.length === 0) {
    const fallback = kubectlJSON(`get pods -n ${namespace} -l k8s-app=hubble-ui`);
    if (fallback.ok) uiPods = fallback.data.items || [];
  }

  const relayReady = relayPods.filter(p => {
    const ready = (p.status.conditions || []).find(c => c.type === 'Ready');
    return ready && ready.status === 'True';
  }).length;

  const uiReady = uiPods.filter(p => {
    const ready = (p.status.conditions || []).find(c => c.type === 'Ready');
    return ready && ready.status === 'True';
  }).length;

  if (relayPods.length === 0) {
    return {
      status: 'info',
      message: 'Hubble Relay not deployed (observability disabled or built-in only)',
      relay: { total: 0, ready: 0 },
      ui: { total: uiPods.length, ready: uiReady },
    };
  }

  let status = 'ok';
  let message = `Hubble Relay: ${relayReady}/${relayPods.length} ready`;
  if (uiPods.length > 0) message += `, UI: ${uiReady}/${uiPods.length} ready`;

  if (relayReady === 0) {
    status = 'warning';
    message = 'Hubble Relay deployed but not ready';
  }

  return {
    status,
    message,
    relay: { total: relayPods.length, ready: relayReady },
    ui: { total: uiPods.length, ready: uiReady },
  };
}

function checkServices() {
  const res = kubectlJSON('get svc -A --field-selector spec.type=LoadBalancer');
  if (!res.ok) {
    return { status: 'error', message: `Unable to query Services: ${res.stderr}`, services: [] };
  }
  const services = (res.data.items || []).map(s => {
    const ingress = (s.status.loadBalancer.ingress || []);
    const externalIP = ingress.length > 0 ? ingress[0].ip : null;
    return {
      name: s.metadata.name,
      namespace: s.metadata.namespace,
      externalIP,
      ports: (s.spec.ports || []).map(p => `${p.port}/${p.protocol}`),
      pending: !externalIP,
    };
  });

  const pending = services.filter(s => s.pending);
  if (services.length === 0) {
    return { status: 'info', message: 'No LoadBalancer services found', services: [] };
  }
  if (pending.length > 0) {
    return {
      status: 'warning',
      message: `${pending.length}/${services.length} service(s) pending ExternalIP`,
      services,
    };
  }
  return {
    status: 'ok',
    message: `${services.length} service(s) with ExternalIP assigned`,
    services,
  };
}

// --- Aggregate health ---

function computeHealth(checks) {
  const statusWeight = { critical: 3, error: 2, warning: 1, info: 0, ok: 0 };
  let maxWeight = 0;
  const issues = [];

  for (const [name, check] of Object.entries(checks)) {
    const w = statusWeight[check.status] || 0;
    if (w > maxWeight) maxWeight = w;
    if (w > 0) {
      issues.push({ check: name, status: check.status, message: check.message });
    }
  }

  const overall = maxWeight >= 3 ? 'CRITICAL' : maxWeight >= 2 ? 'ERROR' : maxWeight >= 1 ? 'WARNING' : 'HEALTHY';
  return { overall, issues };
}

// --- Output formatting ---

function formatText(report) {
  const lines = [];
  const icon = { HEALTHY: '✅', WARNING: '⚠️', ERROR: '❌', CRITICAL: '🔴' };
  lines.push(`\n=== Cilium 诊断报告 ===\n`);
  lines.push(`状态: ${icon[report.health.overall] || ''} ${report.health.overall}\n`);

  // CRDs
  const c = report.checks.crds;
  lines.push(`[CRDs] ${c.message}`);
  if (c.missing.length > 0) lines.push(`  缺失: ${c.missing.join(', ')}`);

  // Pods
  const p = report.checks.pods;
  lines.push(`[Pods] ${p.message}`);
  if (p.operators && p.operators.length > 0) {
    for (const op of p.operators) {
      const mark = op.ready ? '✓' : '✗';
      lines.push(`  Operator: ${mark} ${op.name} on ${op.node} (${op.phase}, restarts=${op.restarts})`);
    }
  }
  if (p.agents && p.agents.length > 0) {
    const healthy = p.agents.filter(a => a.ready).length;
    const unhealthy = p.agents.length - healthy;
    lines.push(`  Agents: ${healthy} healthy, ${unhealthy} unhealthy (${p.agents.length} total)`);
    // Only show unhealthy agents in detail
    for (const a of p.agents.filter(a => !a.ready)) {
      lines.push(`    ✗ ${a.name} on ${a.node} (${a.phase}, restarts=${a.restarts})`);
    }
  }

  // CiliumNodes
  const cn = report.checks.ciliumNodes;
  lines.push(`[CiliumNodes] ${cn.message}`);
  if (cn.nodes && cn.nodes.length > 0 && cn.nodes.length <= 20) {
    for (const n of cn.nodes) {
      lines.push(`  ${n.name}: podCIDRs=[${n.podCIDRs.join(', ')}]`);
    }
  }

  // Endpoints
  const ep = report.checks.endpoints;
  lines.push(`[Endpoints] ${ep.message}`);

  // Network Policies
  const np = report.checks.networkPolicies;
  lines.push(`[NetworkPolicies] ${np.message}`);
  if (np.cnp && np.cnp.length > 0) {
    for (const pol of np.cnp) {
      lines.push(`  CNP: ${pol.namespace}/${pol.name}`);
    }
  }
  if (np.ccnp && np.ccnp.length > 0) {
    for (const pol of np.ccnp) {
      lines.push(`  CCNP: ${pol.name}`);
    }
  }

  // Hubble
  const hub = report.checks.hubble;
  lines.push(`[Hubble] ${hub.message}`);

  // Services
  const svc = report.checks.services;
  lines.push(`[Services] ${svc.message}`);
  for (const s of (svc.services || [])) {
    const ip = s.externalIP || 'PENDING';
    lines.push(`  ${s.namespace}/${s.name}: ${ip} [${s.ports.join(', ')}]`);
  }

  // Issues
  if (report.health.issues.length > 0) {
    lines.push(`\n--- 发现的问题 ---`);
    for (const issue of report.health.issues) {
      lines.push(`  [${issue.status.toUpperCase()}] ${issue.check}: ${issue.message}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// --- Main ---

function main() {
  const args = parseArgs(process.argv);
  const ns = args.namespace;

  const checks = {
    crds: checkCRDs(),
    pods: checkPods(ns),
    ciliumNodes: checkCiliumNodes(),
    endpoints: checkEndpoints(ns),
    networkPolicies: checkNetworkPolicies(),
    hubble: checkHubble(ns),
    services: checkServices(),
  };

  const health = computeHealth(checks);
  const report = { health, checks, namespace: ns };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatText(report));
  }

  // Exit code: 0=healthy, 1=warning, 2=error/critical
  const exitCode = health.overall === 'HEALTHY' ? 0 : health.overall === 'WARNING' ? 1 : 2;
  process.exit(exitCode);
}

// Export for testing
module.exports = { parseArgs, computeHealth, formatText };

if (require.main === module) {
  main();
}
