#!/usr/bin/env node

const CONSTANTS = {
  DISKS_PER_SERVER: 32,
  SPACE_OVERHEAD: 0.81,
  EC8_2_EFFICIENCY: 0.8,
  EC4_2_EFFICIENCY: 0.6667,
  TB_TO_TIB: 0.909,
  UPLOAD_BW_PER_DISK: 30, // MiB/s (4MiB object)
  DOWNLOAD_BW_PER_DISK: 60, // MiB/s (4MiB object)
  UPLOAD_OPS_PER_DISK: 100, // OPS (4KiB object)
  DOWNLOAD_OPS_PER_DISK: 300, // OPS (4KiB object)
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8],
  MIBS_TO_MBPS: 8.388608 // 1 MiB/s = 8.388608 Mbps
};

function getEcScheme(serverCount) {
  if (serverCount <= 4) return { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1 };
  if (serverCount === 5) return { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1 };
  if (serverCount <= 9) return { scheme: 'EC4+2', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 2 };
  return { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2 };
}

function parseCapacity(input) {
  const match = input.match(/^([\d.]+)\s*(TB|PB|TiB|PiB)$/i);
  if (!match) {
    throw new Error(`无效的容量格式: ${input}，请使用格式如 "500TB" 或 "1.5PiB"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const isBinary = unit.endsWith('IB');

  let tib;
  switch (unit) {
    case 'TB':
      tib = value * CONSTANTS.TB_TO_TIB;
      break;
    case 'PB':
      tib = value * 1000 * CONSTANTS.TB_TO_TIB;
      break;
    case 'TIB':
      tib = value;
      break;
    case 'PIB':
      tib = value * 1024;
      break;
    default:
      throw new Error(`不支持的单位: ${unit}`);
  }

  return { tib, unit, isBinary };
}

function parseBandwidth(input) {
  const match = input.match(/^([\d.]+)\s*(MB\/s|GB\/s|MiB\/s|GiB\/s|Mbps|Gbps)$/i);
  if (!match) {
    throw new Error(`无效的带宽格式: ${input}，请使用格式如 "100MB/s"、"1GiB/s"、"800Mbps" 或 "10Gbps"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];
  const unitLower = unit.toLowerCase();

  let mibps;
  let unitType; // 'binary', 'decimal-byte', 'decimal-bit'

  if (unitLower === 'mb/s') {
    mibps = value / 1.024;
    unitType = 'decimal-byte';
  } else if (unitLower === 'gb/s') {
    mibps = value * 1000 / 1.024;
    unitType = 'decimal-byte';
  } else if (unitLower === 'mib/s') {
    mibps = value;
    unitType = 'binary';
  } else if (unitLower === 'gib/s') {
    mibps = value * 1024;
    unitType = 'binary';
  } else if (unitLower === 'mbps') {
    mibps = value / CONSTANTS.MIBS_TO_MBPS;
    unitType = 'decimal-bit';
  } else if (unitLower === 'gbps') {
    mibps = value * 1000 / CONSTANTS.MIBS_TO_MBPS;
    unitType = 'decimal-bit';
  } else {
    throw new Error(`不支持的带宽单位: ${unit}`);
  }

  return { mibps, unit, unitType };
}

function calculatePerformance(serverCount) {
  const totalDisks = serverCount * CONSTANTS.DISKS_PER_SERVER;

  return {
    uploadBandwidth: totalDisks * CONSTANTS.UPLOAD_BW_PER_DISK,
    downloadBandwidth: totalDisks * CONSTANTS.DOWNLOAD_BW_PER_DISK,
    uploadOps: totalDisks * CONSTANTS.UPLOAD_OPS_PER_DISK,
    downloadOps: totalDisks * CONSTANTS.DOWNLOAD_OPS_PER_DISK
  };
}

function calculateActualCapacity(serverCount, diskSizeTB, efficiency) {
  const diskSizeTiB = diskSizeTB * CONSTANTS.TB_TO_TIB;
  return serverCount * CONSTANTS.DISKS_PER_SERVER * diskSizeTiB * CONSTANTS.SPACE_OVERHEAD * efficiency;
}

function checkPerformance(actual, required) {
  const checks = {
    uploadBandwidth: !required.uploadBandwidth || actual.uploadBandwidth >= required.uploadBandwidth,
    downloadBandwidth: !required.downloadBandwidth || actual.downloadBandwidth >= required.downloadBandwidth,
    uploadOps: !required.uploadOps || actual.uploadOps >= required.uploadOps,
    downloadOps: !required.downloadOps || actual.downloadOps >= required.downloadOps
  };

  return {
    passed: Object.values(checks).every(v => v),
    checks
  };
}

function formatCapacity(tib, preferBinary = true) {
  if (preferBinary) {
    if (tib >= 1024) {
      return `${(tib / 1024).toFixed(2)} PiB`;
    }
    return `${tib.toFixed(2)} TiB`;
  } else {
    const tb = tib / CONSTANTS.TB_TO_TIB;
    if (tb >= 1000) {
      return `${(tb / 1000).toFixed(2)} PB`;
    }
    return `${tb.toFixed(2)} TB`;
  }
}

function formatBandwidth(mibps, unitType = 'decimal-bit') {
  if (unitType === 'binary') {
    if (mibps >= 1024) {
      return `${(mibps / 1024).toFixed(2)} GiB/s`;
    }
    return `${mibps.toFixed(2)} MiB/s`;
  } else if (unitType === 'decimal-byte') {
    const mbs = mibps * 1.024;
    if (mbs >= 1000) {
      return `${(mbs / 1000).toFixed(2)} GB/s`;
    }
    return `${mbs.toFixed(2)} MB/s`;
  } else {
    // decimal-bit: Mbps/Gbps (default when no unit specified)
    const mbps = mibps * CONSTANTS.MIBS_TO_MBPS;
    if (mbps >= 1000) {
      return `${(mbps / 1000).toFixed(2)} Gbps`;
    }
    return `${mbps.toFixed(2)} Mbps`;
  }
}

function calculateMinServersForPerf(perfRequirements) {
  if (Object.keys(perfRequirements).length === 0) return 0;

  const needs = [
    perfRequirements.uploadBandwidth ? perfRequirements.uploadBandwidth / CONSTANTS.UPLOAD_BW_PER_DISK : 0,
    perfRequirements.downloadBandwidth ? perfRequirements.downloadBandwidth / CONSTANTS.DOWNLOAD_BW_PER_DISK : 0,
    perfRequirements.uploadOps ? perfRequirements.uploadOps / CONSTANTS.UPLOAD_OPS_PER_DISK : 0,
    perfRequirements.downloadOps ? perfRequirements.downloadOps / CONSTANTS.DOWNLOAD_OPS_PER_DISK : 0
  ];

  return Math.ceil(Math.max(...needs) / CONSTANTS.DISKS_PER_SERVER);
}

function planXEOS(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  const perfRequirements = {};
  let bandwidthUnitType = null;

  if (requirements.uploadBandwidth) {
    const bwInfo = parseBandwidth(requirements.uploadBandwidth);
    perfRequirements.uploadBandwidth = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (requirements.downloadBandwidth) {
    const bwInfo = parseBandwidth(requirements.downloadBandwidth);
    perfRequirements.downloadBandwidth = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (requirements.uploadOps) {
    perfRequirements.uploadOps = parseInt(requirements.uploadOps);
  }
  if (requirements.downloadOps) {
    perfRequirements.downloadOps = parseInt(requirements.downloadOps);
  }

  // Default to decimal-bit (Mbps/Gbps) when no bandwidth unit specified
  if (bandwidthUnitType === null) {
    bandwidthUnitType = 'decimal-bit';
  }

  const minServersForPerf = calculateMinServersForPerf(perfRequirements);

  const configs = [];

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    // Find minimum servers needed by trying from 3 upward
    for (let servers = 3; servers <= 50; servers++) {
      const ec = getEcScheme(servers);
      const actualCapacity = calculateActualCapacity(servers, diskSize, ec.efficiency);

      if (actualCapacity >= capacityTiB && servers >= minServersForPerf) {
        const performance = calculatePerformance(servers);
        const perfCheck = checkPerformance(performance, perfRequirements);

        if (perfCheck.passed) {
          configs.push({
            serverCount: servers,
            diskSize,
            ecScheme: ec.scheme,
            ecEfficiency: ec.efficiency,
            tolerance: ec.tolerance,
            actualCapacity,
            performance,
            perfCheck
          });
          break; // Found minimum servers for this disk size
        }
      }
    }
  }

  if (configs.length === 0) {
    throw new Error('无法找到满足所有需求的配置方案');
  }

  // Score configs: prefer fewer servers, then less over-provisioning
  const bestConfig = configs.reduce((best, current) => {
    const currentScore = scoreConfig(current, capacityTiB);
    const bestScore = scoreConfig(best, capacityTiB);
    return currentScore < bestScore ? current : best;
  });

  return {
    ...bestConfig,
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitType
  };
}

function scoreConfig(config, capacityTiB) {
  const overProvisionRatio = config.actualCapacity / capacityTiB;
  // Prefer: fewer servers > higher EC efficiency > less over-provisioning
  return config.serverCount * 1000 + (1 - config.ecEfficiency) * 100 + overProvisionRatio;
}

function formatResult(config) {
  const result = {
    configuration: {
      serverCount: config.serverCount,
      ecScheme: config.ecScheme,
      tolerance: `容忍 ${config.tolerance} 节点离线`,
      diskConfig: `每台服务器 ${CONSTANTS.DISKS_PER_SERVER} × ${config.diskSize}TB HDD`
    },
    capacity: {
      available: formatCapacity(config.actualCapacity, config.capacityUnitPreference)
    },
    performance: {
      uploadBandwidth: formatBandwidth(config.performance.uploadBandwidth, config.bandwidthUnitType) + ' (4MiB)',
      downloadBandwidth: formatBandwidth(config.performance.downloadBandwidth, config.bandwidthUnitType) + ' (4MiB)',
      uploadOps: `${config.performance.uploadOps.toLocaleString()} (4KiB)`,
      downloadOps: `${config.performance.downloadOps.toLocaleString()} (4KiB)`
    }
  };

  if (config.warning) {
    result.warning = config.warning;
  }

  if (!config.perfCheck.passed) {
    result.performanceStatus = '部分性能指标未达标';
    result.performanceChecks = config.perfCheck.checks;
  } else {
    result.performanceStatus = '所有性能指标满足需求';
  }

  return result;
}

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
XSKY XEOS 对象存储规划工具

用法:
  node xsky-xeos-planner.js --capacity <容量> [选项]

必需参数:
  --capacity <容量>          容量需求，如 "500TB", "1.5PiB"

可选参数:
  --upload-bw <带宽>         上传带宽需求，如 "100MB/s", "1GiB/s", "10Gbps"
  --download-bw <带宽>       下载带宽需求，如 "200MB/s", "2GiB/s", "20Gbps"
  --upload-ops <OPS>         上传 OPS 需求（4KiB 对象）
  --download-ops <OPS>       下载 OPS 需求（4KiB 对象）
  --json                     以 JSON 格式输出

纠删码方案（根据节点数自动选择）:
  3-4 节点: EC4+2:1  容忍 1 节点离线
  5 节点:   EC8+2:1  容忍 1 节点离线
  6-9 节点: EC4+2    容忍 2 节点离线
  ≥10 节点: EC8+2    容忍 2 节点离线

示例:
  node xsky-xeos-planner.js --capacity 500TiB
  node xsky-xeos-planner.js --capacity 2PB --upload-bw 10Gbps --download-bw 20Gbps
  node xsky-xeos-planner.js --capacity 1PiB --upload-ops 50000 --json
`);
    process.exit(0);
  }

  const requirements = {};
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--capacity':
        requirements.capacity = args[++i];
        break;
      case '--upload-bw':
        requirements.uploadBandwidth = args[++i];
        break;
      case '--download-bw':
        requirements.downloadBandwidth = args[++i];
        break;
      case '--upload-ops':
        requirements.uploadOps = args[++i];
        break;
      case '--download-ops':
        requirements.downloadOps = args[++i];
        break;
      case '--json':
        jsonOutput = true;
        break;
    }
  }

  if (!requirements.capacity) {
    console.error('错误: 必须指定 --capacity 参数');
    process.exit(1);
  }

  try {
    const config = planXEOS(requirements);
    const result = formatResult(config);

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n=== XSKY XEOS 对象存储规划方案 ===\n');
      console.log('配置方案:');
      console.log(`  服务器台数: ${result.configuration.serverCount} 台`);
      console.log(`  纠删码方案: ${result.configuration.ecScheme}（${result.configuration.tolerance}）`);
      console.log(`  磁盘配置: ${result.configuration.diskConfig}`);
      console.log('\n容量:');
      console.log(`  可用容量: ${result.capacity.available}`);
      console.log('\n性能:');
      console.log(`  上传带宽: ${result.performance.uploadBandwidth}`);
      console.log(`  下载带宽: ${result.performance.downloadBandwidth}`);
      console.log(`  上传 OPS: ${result.performance.uploadOps}`);
      console.log(`  下载 OPS: ${result.performance.downloadOps}`);
      console.log(`\n性能状态: ${result.performanceStatus}`);

      if (result.warning) {
        console.log(`\n⚠️  警告: ${result.warning}`);
      }
      console.log();
    }
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  planXEOS,
  formatResult,
  parseCapacity,
  parseBandwidth,
  getEcScheme
};
