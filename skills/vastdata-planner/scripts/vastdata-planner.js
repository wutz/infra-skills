import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(dataDir, name), 'utf-8'));
}

const ebox15 = loadJson('ebox-15tb.json');
const ebox30 = loadJson('ebox-30tb.json');
const ebox60 = loadJson('ebox-60tb.json');
const eboxPerf = loadJson('ebox-performance.json');
const cnodeData = loadJson('cnode-configs.json');

let preferredCapacityUnit = null;

const EBOX_VARIANTS = [
  { key: '15tb', label: '15.36TB NVMe (2×800GB SCM + 8×15.36TB NVMe)', data: ebox15 },
  { key: '30tb', label: '30.72TB NVMe (2×1.6TB SCM + 8×30.72TB NVMe)', data: ebox30 },
  { key: '60tb', label: '61.44TB NVMe (3×1.6TB SCM + 7×61.44TB NVMe)', data: ebox60 },
];

function parseCapacity(str) {
  if (!str) return null;
  const s = String(str).trim().toUpperCase();
  const match = s.match(/^([\d.]+)\s*(PIB|TIB|GIB|PB|TB|GB)?$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2] || 'TB';
  if (unit === 'PIB') return num * (2 ** 50 / 1e12);  // 1 PiB = 1125.9 TB (SI)
  if (unit === 'TIB') return num * (2 ** 40 / 1e12);  // 1 TiB = 1.0995 TB (SI)
  if (unit === 'GIB') return num * (2 ** 30 / 1e12);  // 1 GiB = 0.001074 TB (SI)
  if (unit === 'PB') return num * 1024;
  if (unit === 'GB') return num / 1024;
  return num;
}

function extractCapacityUnit(str) {
  if (!str) return null;
  const s = String(str).trim().toUpperCase();
  const match = s.match(/^[\d.]+\s*(PIB|TIB|GIB|PB|TB|GB)?$/);
  return match ? (match[1] || 'TB') : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mode: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--capacity' && args[i+1]) { const raw = args[++i]; opts.capacity = parseCapacity(raw); opts.capacityUnit = extractCapacityUnit(raw); }
    else if (args[i] === '--read-bw' && args[i+1]) opts.readBw = parseFloat(args[++i]);
    else if (args[i] === '--write-bw' && args[i+1]) opts.writeBw = parseFloat(args[++i]);
    else if (args[i] === '--read-iops' && args[i+1]) opts.readIops = parseFloat(args[++i]);
    else if (args[i] === '--write-iops' && args[i+1]) opts.writeIops = parseFloat(args[++i]);
    else if (args[i] === '--mode' && args[i+1]) opts.mode = args[++i]; // ebox | cnode | all
    else if (args[i] === '--disk' && args[i+1]) opts.disk = args[++i]; // 15tb | 30tb | 60tb
    else if (args[i] === '--cnode-disk' && args[i+1]) opts.cnodeDisk = args[++i]; // 15tb | 30tb | 60tb
    else if (args[i] === '--help') opts.help = true;
  }
  return opts;
}

function findEboxConfig(variant, requirements) {
  const entries = variant.data.entries;
  const perfEntries = eboxPerf.entries;

  // Find minimum ebox count satisfying all requirements
  for (const entry of entries) {
    const n = entry.ebox_count;
    const perf = perfEntries.find(p => p.ebox_count === n);
    if (!perf) continue;

    const ok =
      (!requirements.capacity || entry.usable_tb >= requirements.capacity) &&
      (!requirements.readBw || perf.read_bw_gbs >= requirements.readBw) &&
      (!requirements.writeBw || perf.sustained_write_bw_gbs >= requirements.writeBw) &&
      (!requirements.readIops || perf.read_iops_k >= requirements.readIops) &&
      (!requirements.writeIops || perf.write_iops_k >= requirements.writeIops);

    if (ok) return { entry, perf };
  }
  return null;
}

function formatCapacity(tb) {
  const unit = preferredCapacityUnit;
  if (unit === 'PIB') return `${(tb / (2 ** 50 / 1e12)).toFixed(2)} PiB`;
  if (unit === 'TIB') return `${(tb / (2 ** 40 / 1e12)).toFixed(2)} TiB`;
  if (unit === 'GIB') return `${(tb / (2 ** 30 / 1e12)).toFixed(2)} GiB`;
  if (unit === 'PB') return `${(tb / 1024).toFixed(2)} PB`;
  if (unit === 'GB') return `${(tb * 1024).toFixed(2)} GB`;
  if (unit === 'TB') return `${tb.toFixed(2)} TB`;
  // No unit preference: use auto-scale
  if (tb >= 1024) return `${(tb / 1024).toFixed(2)} PB (${tb.toFixed(2)} TB)`;
  return `${tb.toFixed(2)} TB`;
}

function printEboxResults(requirements, diskFilter) {
  const variants = diskFilter
    ? EBOX_VARIANTS.filter(v => v.key === diskFilter)
    : EBOX_VARIANTS;

  console.log('\n## EBox 硬件方案（全闪 NVMe）\n');
  console.log('最小 EBox 数：11，最大：250，性能线性扩展\n');

  const hasReqs = requirements.capacity || requirements.readBw || requirements.writeBw ||
    requirements.readIops || requirements.writeIops;

  if (hasReqs) {
    const DISK_LABELS = { '15tb': '15.36TB', '30tb': '30.72TB', '60tb': '61.44TB' };
    console.log('| 磁盘规格 | EBox数 | 可用容量 | 裸容量 | 读带宽 | 持续写带宽 | 峰值写带宽 | 读 IOPS | 写 IOPS |');
    console.log('|---------|-------|--------|-------|-------|---------|---------|--------|--------|');
    for (const variant of variants) {
      const result = findEboxConfig(variant, requirements);
      const diskLabel = DISK_LABELS[variant.key] || variant.key;
      if (!result) {
        console.log(`| ${diskLabel} | ❌ 超出 250 EBox | - | - | - | - | - | - | - |`);
      } else {
        const { entry, perf } = result;
        console.log(`| ${diskLabel} | ${entry.ebox_count} | ${formatCapacity(entry.usable_tb)} | ${formatCapacity(entry.ebox_count * entry.raw_per_ebox_tb)} | ${+perf.read_bw_gbs.toFixed(1)} GB/s | ${+perf.sustained_write_bw_gbs.toFixed(1)} GB/s | ${+perf.burst_write_bw_gbs.toFixed(1)} GB/s | ${perf.read_iops_k}K | ${perf.write_iops_k}K |`);
      }
    }
    console.log();
  } else {
    // Show typical configs per variant as markdown tables
    const sample = [11, 22, 44, 88, 176, 250];
    for (const variant of variants) {
      console.log(`### ${variant.label}\n`);
      console.log('| EBox数 | 可用容量 | 裸容量 | 读带宽 | 持续写带宽 | 峰值写带宽 | 读 IOPS | 写 IOPS |');
      console.log('|-------|--------|-------|-------|---------|---------|--------|--------|');
      for (const n of sample) {
        const entry = variant.data.entries.find(e => e.ebox_count === n);
        const perf = eboxPerf.entries.find(p => p.ebox_count === n);
        if (!entry || !perf) continue;
        console.log(`| ${n} | ${formatCapacity(entry.usable_tb)} | ${formatCapacity(entry.ebox_count * entry.raw_per_ebox_tb)} | ${perf.read_bw_gbs} GB/s | ${perf.sustained_write_bw_gbs} GB/s | ${perf.burst_write_bw_gbs} GB/s | ${perf.read_iops_k}K | ${perf.write_iops_k}K |`);
      }
      console.log();
    }
  }
}

const DISK_TB_MAP = { '15tb': 15.36, '30tb': 30.72, '60tb': 61.44 };

function parseDiskTb(diskKey) {
  return diskKey ? (DISK_TB_MAP[diskKey.toLowerCase()] ?? null) : null;
}

function findCnodeConfigs(requirements, diskTb) {
  const configs = cnodeData.configs;
  return configs.filter(c => {
    return (
      (!diskTb || c.disk_tb === diskTb) &&
      (!requirements.capacity || c.usable_tb >= requirements.capacity) &&
      (!requirements.readBw || c.read_bw_gbs >= requirements.readBw) &&
      (!requirements.writeBw || c.sustained_write_bw_gbs >= requirements.writeBw) &&
      (!requirements.readIops || c.read_iops_k >= requirements.readIops) &&
      (!requirements.writeIops || c.write_iops_k >= requirements.writeIops)
    );
  });
}

function printCnodeTable(configs) {
  console.log('| 配置 | 可用容量 | 裸容量 | 读带宽 | 持续写带宽 | 峰值写带宽 | 读 IOPS | 写 IOPS | 备注 |');
  console.log('|-----|--------|-------|-------|---------|---------|--------|--------|-----|');
  for (const c of configs) {
    const label = `${c.cnode_count} CNode (${c.cnode_model}) + ${c.dbox_count} DBox (${c.dbox_model}, ${c.disk_tb}TB盘)`;
    console.log(`| ${label} | ${formatCapacity(c.usable_tb)} | ${formatCapacity(c.raw_tb)} | ${c.read_bw_gbs} GB/s | ${c.sustained_write_bw_gbs} GB/s | ${c.burst_write_bw_gbs} GB/s | ${c.read_iops_k}K | ${c.write_iops_k}K | ${c.notes || ''} |`);
  }
  console.log();
}

function printCboxResults(requirements, cnodeDiskKey) {
  console.log('\n## CNode+DBox 硬件方案（算力+存储分离）\n');
  console.log('预定义配置组合，CNode 为计算节点，DBox 为存储节点\n');

  const diskTb = parseDiskTb(cnodeDiskKey);
  if (cnodeDiskKey && !diskTb) {
    console.log(`  ⚠️  未知磁盘规格 "${cnodeDiskKey}"，支持：15tb, 30tb, 60tb\n`);
    return;
  }

  const hasReqs = requirements.capacity || requirements.readBw || requirements.writeBw ||
    requirements.readIops || requirements.writeIops;

  const allConfigs = cnodeData.configs
    .filter(c => !diskTb || c.disk_tb === diskTb)
    .sort((a, b) => {
      // Sort by total hardware count (cnode + dbox), then by disk size
      const aTotal = a.cnode_count + a.dbox_count;
      const bTotal = b.cnode_count + b.dbox_count;
      return aTotal - bTotal || a.disk_tb - b.disk_tb;
    });

  if (hasReqs) {
    // For each disk size, pick the smallest config that satisfies all requirements
    const diskGroups = new Map();
    for (const c of allConfigs) {
      if (!diskGroups.has(c.disk_tb)) {
        const satisfies =
          (!requirements.capacity || c.usable_tb >= requirements.capacity) &&
          (!requirements.readBw || c.read_bw_gbs >= requirements.readBw) &&
          (!requirements.writeBw || c.sustained_write_bw_gbs >= requirements.writeBw) &&
          (!requirements.readIops || c.read_iops_k >= requirements.readIops) &&
          (!requirements.writeIops || c.write_iops_k >= requirements.writeIops);
        if (satisfies) diskGroups.set(c.disk_tb, c);
      }
    }
    if (diskGroups.size === 0) {
      console.log('  ❌ 无预定义配置满足需求\n');
      return;
    }
    console.log('每种磁盘规格的最小满足需求配置：\n');
    printCnodeTable([...diskGroups.values()]);
  } else {
    printCnodeTable(allConfigs);
  }
}

function printHelp() {
  console.log(`
VastData 存储规划工具

用法：
  node vastdata-planner.js [选项]

选项：
  --capacity <值>    所需可用容量（例：500TB, 2PB）
  --read-bw <GB/s>   所需读带宽
  --write-bw <GB/s>  所需持续写带宽
  --read-iops <K>    所需读 IOPS（单位：K）
  --write-iops <K>   所需写 IOPS（单位：K）
  --mode <模式>      ebox | cnode | all（默认：all）
  --disk <规格>      15tb | 30tb | 60tb（EBox；cnode 模式下也适用）
  --cnode-disk <规格> 15tb | 30tb | 60tb（仅限 CNode+DBox 过滤）
  --help             显示帮助

示例：
  node vastdata-planner.js --capacity 2PB
  node vastdata-planner.js --capacity 500TB --read-bw 200 --mode ebox --disk 30tb
  node vastdata-planner.js --mode cnode --capacity 1PB
`);
}

function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    return;
  }

  preferredCapacityUnit = opts.capacityUnit || null;

  const requirements = {
    capacity: opts.capacity,
    readBw: opts.readBw,
    writeBw: opts.writeBw,
    readIops: opts.readIops,
    writeIops: opts.writeIops,
  };

  console.log('# VastData 存储规划报告\n');

  if (requirements.capacity || requirements.readBw || requirements.writeBw ||
      requirements.readIops || requirements.writeIops) {
    console.log('## 需求摘要');
    if (requirements.capacity) console.log(`  - 可用容量 ≥ ${formatCapacity(requirements.capacity)}`);
    if (requirements.readBw) console.log(`  - 读带宽 ≥ ${requirements.readBw} GB/s`);
    if (requirements.writeBw) console.log(`  - 持续写带宽 ≥ ${requirements.writeBw} GB/s`);
    if (requirements.readIops) console.log(`  - 读 IOPS ≥ ${requirements.readIops}K`);
    if (requirements.writeIops) console.log(`  - 写 IOPS ≥ ${requirements.writeIops}K`);
  }

  if (opts.mode === 'all' || opts.mode === 'ebox') {
    printEboxResults(requirements, opts.disk);
  }
  if (opts.mode === 'all' || opts.mode === 'cnode') {
    // --cnode-disk overrides --disk for CNode; --disk applies to both if --cnode-disk not set
    const cnodeDiskKey = opts.cnodeDisk ?? (opts.mode === 'cnode' ? opts.disk : null);
    printCboxResults(requirements, cnodeDiskKey);
  }
}

main();
