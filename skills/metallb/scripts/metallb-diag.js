#!/usr/bin/env node

'use strict';

const { execSync } = require('child_process');

// --- CLI Argument Parsing ---

function parseArgs(argv) {
  const args = { namespace: 'metallb-system', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--namespace' && argv[i + 1]) {
      args.namespace = argv[++i];
    } else if (argv[i].startsWith('--namespace=')) {
      args.namespace = argv[i].split('=')[1];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`MetalLB Diagnostics Tool

Usage: node metallb-diag.js [options]

Options:
  --namespace <ns>   MetalLB namespace (default: metallb-system)
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
    'ipaddresspools.metallb.io',
    'l2advertisements.metallb.io',
    'bgpadvertisements.metallb.io',
    'bgppeers.metallb.io',
    'bfdprofiles.metallb.io',
    'communities.metallb.io',
  ];
  const res = kubectl('get crd --no-headers -o custom-columns=NAME:.metadata.name');
  if (!res.ok) {
    return { status: 'error', message: 'Unable to query CRDs', found: [], missing: expectedCRDs };
  }
  const installedCRDs = res.stdout.split('\n').filter(Boolean);
  const found = expectedCRDs.filter(c => installedCRDs.includes(c));
  const missing = expectedCRDs.filter(c => !installedCRDs.includes(c));
  const coreRequired = ['ipaddresspools.metallb.io', 'l2advertisements.metallb.io', 'bgpadvertisements.metallb.io'];
  const coreMissing = coreRequired.filter(c => missing.includes(c));
  return {
    status: coreMissing.length > 0 ? 'critical' : missing.length > 0 ? 'warning' : 'ok',
    message: coreMissing.length > 0
      ? `Core CRDs missing: ${coreMissing.join(', ')}`
      : missing.length > 0
        ? `Optional CRDs missing: ${missing.join(', ')}`
        : 'All MetalLB CRDs installed',
    found,
    missing,
  };
}

function checkPods(namespace) {
  const res = kubectlJSON(`get pods -n ${namespace} -l app.kubernetes.io/name=metallb`);
  if (!res.ok) {
    return {
      status: 'error',
      message: `Unable to query pods in ${namespace}: ${res.stderr}`,
      controller: null,
      speakers: [],
    };
  }
  const pods = (res.data.items || []);
  if (pods.length === 0) {
    return {
      status: 'critical',
      message: `No MetalLB pods found in ${namespace}`,
      controller: null,
      speakers: [],
    };
  }

  const controller = pods.find(p =>
    (p.metadata.labels || {})['app.kubernetes.io/component'] === 'controller'
  );
  const speakers = pods.filter(p =>
    (p.metadata.labels || {})['app.kubernetes.io/component'] === 'speaker'
  );

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

  const controllerSummary = controller ? podSummary(controller) : null;
  const speakerSummaries = speakers.map(podSummary);
  const unhealthySpeakers = speakerSummaries.filter(s => !s.ready || s.phase !== 'Running');

  let status = 'ok';
  let message = '';
  if (!controllerSummary) {
    status = 'critical';
    message = 'Controller pod not found';
  } else if (!controllerSummary.ready) {
    status = 'critical';
    message = 'Controller pod not ready';
  } else if (speakerSummaries.length === 0) {
    status = 'critical';
    message = 'No speaker pods found';
  } else if (unhealthySpeakers.length > 0) {
    status = 'warning';
    message = `${unhealthySpeakers.length}/${speakerSummaries.length} speaker(s) unhealthy`;
  } else {
    message = `Controller ready, ${speakerSummaries.length} speaker(s) healthy`;
  }

  return { status, message, controller: controllerSummary, speakers: speakerSummaries };
}

function checkIPPools(namespace) {
  const res = kubectlJSON(`get ipaddresspools -n ${namespace}`);
  if (!res.ok) {
    return { status: 'error', message: `Unable to query IPAddressPools: ${res.stderr}`, pools: [] };
  }
  const pools = (res.data.items || []).map(p => ({
    name: p.metadata.name,
    addresses: (p.spec.addresses || []),
    autoAssign: p.spec.autoAssign !== false,
    avoidBuggyIPs: p.spec.avoidBuggyIPs || false,
  }));

  if (pools.length === 0) {
    return { status: 'critical', message: 'No IPAddressPools configured', pools: [] };
  }
  return { status: 'ok', message: `${pools.length} pool(s) configured`, pools };
}

function checkAdvertisements(namespace) {
  const l2Res = kubectlJSON(`get l2advertisements -n ${namespace}`);
  const bgpRes = kubectlJSON(`get bgpadvertisements -n ${namespace}`);

  const l2Advs = l2Res.ok ? (l2Res.data.items || []).map(a => ({
    name: a.metadata.name,
    ipAddressPools: a.spec.ipAddressPools || [],
    nodeSelectors: a.spec.nodeSelectors || [],
    interfaces: a.spec.interfaces || [],
  })) : [];

  const bgpAdvs = bgpRes.ok ? (bgpRes.data.items || []).map(a => ({
    name: a.metadata.name,
    ipAddressPools: a.spec.ipAddressPools || [],
    aggregationLength: a.spec.aggregationLength,
    localPref: a.spec.localPref,
    communities: a.spec.communities || [],
  })) : [];

  if (l2Advs.length === 0 && bgpAdvs.length === 0) {
    return {
      status: 'critical',
      message: 'No L2Advertisement or BGPAdvertisement configured — IPs will NOT be announced',
      l2: l2Advs,
      bgp: bgpAdvs,
    };
  }

  const parts = [];
  if (l2Advs.length > 0) parts.push(`${l2Advs.length} L2`);
  if (bgpAdvs.length > 0) parts.push(`${bgpAdvs.length} BGP`);
  return {
    status: 'ok',
    message: `${parts.join(' + ')} advertisement(s) configured`,
    l2: l2Advs,
    bgp: bgpAdvs,
  };
}

function checkBGPPeers(namespace) {
  const res = kubectlJSON(`get bgppeers -n ${namespace}`);
  if (!res.ok) {
    return { status: 'info', message: 'Unable to query BGPPeers (may not be configured)', peers: [] };
  }
  const peers = (res.data.items || []).map(p => ({
    name: p.metadata.name,
    peerAddress: p.spec.peerAddress,
    peerASN: p.spec.peerASN,
    myASN: p.spec.myASN,
    peerPort: p.spec.peerPort || 179,
    holdTime: p.spec.holdTime,
    bfdProfile: p.spec.bfdProfile || null,
    nodeSelectors: p.spec.nodeSelectors || [],
  }));

  if (peers.length === 0) {
    return { status: 'info', message: 'No BGPPeers configured (L2-only mode)', peers: [] };
  }
  return { status: 'ok', message: `${peers.length} BGP peer(s) configured`, peers };
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
      pool: (s.metadata.annotations || {})['metallb.universe.tf/address-pool'] || null,
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
  lines.push(`\n=== MetalLB 诊断报告 ===\n`);
  lines.push(`状态: ${icon[report.health.overall] || ''} ${report.health.overall}\n`);

  // CRDs
  const c = report.checks.crds;
  lines.push(`[CRDs] ${c.message}`);
  if (c.missing.length > 0) lines.push(`  缺失: ${c.missing.join(', ')}`);

  // Pods
  const p = report.checks.pods;
  lines.push(`[Pods] ${p.message}`);
  if (p.controller) {
    lines.push(`  Controller: ${p.controller.name} (${p.controller.phase}, ready=${p.controller.ready}, restarts=${p.controller.restarts})`);
  }
  if (p.speakers.length > 0) {
    for (const s of p.speakers) {
      const mark = s.ready ? '✓' : '✗';
      lines.push(`  Speaker: ${mark} ${s.name} on ${s.node} (${s.phase}, restarts=${s.restarts})`);
    }
  }

  // IP Pools
  const ip = report.checks.ipPools;
  lines.push(`[IP Pools] ${ip.message}`);
  for (const pool of ip.pools) {
    lines.push(`  ${pool.name}: ${pool.addresses.join(', ')} (autoAssign=${pool.autoAssign})`);
  }

  // Advertisements
  const adv = report.checks.advertisements;
  lines.push(`[Advertisements] ${adv.message}`);
  for (const a of adv.l2) {
    lines.push(`  L2: ${a.name} → pools=[${a.ipAddressPools.join(', ')}]`);
  }
  for (const a of adv.bgp) {
    lines.push(`  BGP: ${a.name} → pools=[${a.ipAddressPools.join(', ')}]`);
  }

  // BGP Peers
  const bgp = report.checks.bgpPeers;
  lines.push(`[BGP Peers] ${bgp.message}`);
  for (const peer of bgp.peers) {
    lines.push(`  ${peer.name}: ${peer.peerAddress}:${peer.peerPort} (myASN=${peer.myASN}, peerASN=${peer.peerASN}${peer.bfdProfile ? ', bfd=' + peer.bfdProfile : ''})`);
  }

  // Services
  const svc = report.checks.services;
  lines.push(`[Services] ${svc.message}`);
  for (const s of svc.services) {
    const ip = s.externalIP || 'PENDING';
    lines.push(`  ${s.namespace}/${s.name}: ${ip} [${s.ports.join(', ')}]${s.pool ? ' pool=' + s.pool : ''}`);
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
    ipPools: checkIPPools(ns),
    advertisements: checkAdvertisements(ns),
    bgpPeers: checkBGPPeers(ns),
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
