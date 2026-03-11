#!/usr/bin/env node

/**
 * XSKY XEOS 对象存储规划计算器
 * 根据容量和性能需求计算 XSKY XEOS 服务器配置方案
 */

// 常量配置
const CONSTANTS = {
  DISKS_PER_SERVER: 32,
  SPACE_OVERHEAD: 0.81, // 空间保留和损耗（预留 19%）
  EC8_2_EFFICIENCY: 0.8, // EC8+2 可用率
  EC4_2_EFFICIENCY: 0.6667, // EC4+2 可用率
  EC8_2_MIN_SERVERS: 5,
  EC4_2_MIN_SERVERS: 3,
  TB_TO_TIB: 0.909,
  // 单盘性能基准
  UPLOAD_BW_PER_DISK: 30, // MiB/s
  DOWNLOAD_BW_PER_DISK: 60, // MiB/s
  UPLOAD_OPS_PER_DISK: 100, // IOPS (4K)
  DOWNLOAD_OPS_PER_DISK: 300, // IOPS (4K)
  // 可选磁盘大小（TB，从大到小排序）
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8]
};

/**
 * 解析容量输入，统一转换为 TiB，并返回原始单位信息
 */
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

/**
 * 解析带宽输入，统一转换为 MiB/s，并返回原始单位信息
 */
function parseBandwidth(input) {
  const match = input.match(/^([\d.]+)\s*(MB\/s|GB\/s|MiB\/s|GiB\/s)$/i);
  if (!match) {
    throw new Error(`无效的带宽格式: ${input}，请使用格式如 "100MB/s" 或 "1GiB/s"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];
  const unitLower = unit.toLowerCase();
  const isBinary = unitLower.includes('i');

  let mibps;
  if (unitLower === 'mb/s') {
    mibps = value / 1.024; // MB to MiB
  } else if (unitLower === 'gb/s') {
    mibps = value * 1000 / 1.024; // GB to MiB
  } else if (unitLower === 'mib/s') {
    mibps = value;
  } else if (unitLower === 'gib/s') {
    mibps = value * 1024;
  } else {
    throw new Error(`不支持的带宽单位: ${unit}`);
  }

  return { mibps, unit, isBinary };
}

/**
 * 计算满足容量需求的服务器台数
 */
function calculateServersForCapacity(capacityTiB, diskSizeTB, ecScheme) {
  const diskSizeTiB = diskSizeTB * CONSTANTS.TB_TO_TIB;
  const efficiency = ecScheme === 'EC8+2' ? CONSTANTS.EC8_2_EFFICIENCY : CONSTANTS.EC4_2_EFFICIENCY;

  const servers = capacityTiB / diskSizeTiB / CONSTANTS.DISKS_PER_SERVER / CONSTANTS.SPACE_OVERHEAD / efficiency;
  return Math.ceil(servers);
}

/**
 * 计算集群性能
 */
function calculatePerformance(serverCount) {
  const totalDisks = serverCount * CONSTANTS.DISKS_PER_SERVER;

  return {
    uploadBandwidth: totalDisks * CONSTANTS.UPLOAD_BW_PER_DISK,
    downloadBandwidth: totalDisks * CONSTANTS.DOWNLOAD_BW_PER_DISK,
    uploadOps: totalDisks * CONSTANTS.UPLOAD_OPS_PER_DISK,
    downloadOps: totalDisks * CONSTANTS.DOWNLOAD_OPS_PER_DISK
  };
}

/**
 * 计算实际可用容量
 */
function calculateActualCapacity(serverCount, diskSizeTB, ecScheme) {
  const diskSizeTiB = diskSizeTB * CONSTANTS.TB_TO_TIB;
  const efficiency = ecScheme === 'EC8+2' ? CONSTANTS.EC8_2_EFFICIENCY : CONSTANTS.EC4_2_EFFICIENCY;

  return serverCount * CONSTANTS.DISKS_PER_SERVER * diskSizeTiB * CONSTANTS.SPACE_OVERHEAD * efficiency;
}

/**
 * 检查性能是否满足需求
 */
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

/**
 * 格式化容量输出，根据用户输入单位选择输出格式
 */
function formatCapacity(tib, preferBinary = true) {
  if (preferBinary) {
    // 二进制单位优先
    if (tib >= 1024) {
      return `${(tib / 1024).toFixed(2)} PiB`;
    }
    return `${tib.toFixed(2)} TiB`;
  } else {
    // 十进制单位优先
    const tb = tib / CONSTANTS.TB_TO_TIB;
    if (tb >= 1000) {
      return `${(tb / 1000).toFixed(2)} PB`;
    }
    return `${tb.toFixed(2)} TB`;
  }
}

/**
 * 格式化带宽输出，根据用户输入单位选择输出格式
 */
function formatBandwidth(mibps, preferBinary = true) {
  if (preferBinary) {
    // 二进制单位优先
    if (mibps >= 1024) {
      return `${(mibps / 1024).toFixed(2)} GiB/s`;
    }
    return `${mibps.toFixed(2)} MiB/s`;
  } else {
    // 十进制单位优先
    const mbs = mibps * 1.024;
    if (mbs >= 1000) {
      return `${(mbs / 1000).toFixed(2)} GB/s`;
    }
    return `${mbs.toFixed(2)} MB/s`;
  }
}

/**
 * 智能选择最优 HDD 规格
 * 根据容量需求和服务器数量，选择最接近需求的磁盘规格
 */
function selectOptimalDiskSize(capacityTiB, serverCount, ecScheme) {
  const efficiency = ecScheme === 'EC8+2' ? CONSTANTS.EC8_2_EFFICIENCY : CONSTANTS.EC4_2_EFFICIENCY;

  // 计算理想的单盘容量（TiB）
  const idealDiskSizeTiB = capacityTiB / serverCount / CONSTANTS.DISKS_PER_SERVER / CONSTANTS.SPACE_OVERHEAD / efficiency;
  const idealDiskSizeTB = idealDiskSizeTiB / CONSTANTS.TB_TO_TIB;

  // 找到最接近理想容量的磁盘规格
  let bestDiskSize = CONSTANTS.DISK_SIZES[0];
  let minDiff = Math.abs(CONSTANTS.DISK_SIZES[0] - idealDiskSizeTB);

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    const diff = Math.abs(diskSize - idealDiskSizeTB);
    if (diff < minDiff) {
      minDiff = diff;
      bestDiskSize = diskSize;
    }
  }

  return bestDiskSize;
}

/**
 * 主规划函数
 */
function planXEOS(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  // 解析性能需求（如果有）
  const perfRequirements = {};
  let bandwidthUnitPreference = null; // 记录用户带宽单位偏好

  if (requirements.uploadBandwidth) {
    const bwInfo = parseBandwidth(requirements.uploadBandwidth);
    perfRequirements.uploadBandwidth = bwInfo.mibps;
    if (!bandwidthUnitPreference) {
      bandwidthUnitPreference = bwInfo.isBinary;
    }
  }
  if (requirements.downloadBandwidth) {
    const bwInfo = parseBandwidth(requirements.downloadBandwidth);
    perfRequirements.downloadBandwidth = bwInfo.mibps;
    if (!bandwidthUnitPreference) {
      bandwidthUnitPreference = bwInfo.isBinary;
    }
  }
  if (requirements.uploadOps) {
    perfRequirements.uploadOps = parseInt(requirements.uploadOps);
  }
  if (requirements.downloadOps) {
    perfRequirements.downloadOps = parseInt(requirements.downloadOps);
  }

  // 如果没有性能需求，默认使用十进制单位
  if (bandwidthUnitPreference === null) {
    bandwidthUnitPreference = false;
  }

  let bestConfig = null;

  // 第一轮：使用最大磁盘规格估算服务器数量
  const largestDisk = CONSTANTS.DISK_SIZES[0];
  let initialServerCount = calculateServersForCapacity(capacityTiB, largestDisk, 'EC8+2');
  let ecScheme = 'EC8+2';

  // 如果不足 5 台，降级到 EC4+2
  if (initialServerCount < CONSTANTS.EC8_2_MIN_SERVERS) {
    initialServerCount = calculateServersForCapacity(capacityTiB, largestDisk, 'EC4+2');
    ecScheme = 'EC4+2';

    // EC4+2 最少 3 台
    if (initialServerCount < CONSTANTS.EC4_2_MIN_SERVERS) {
      initialServerCount = CONSTANTS.EC4_2_MIN_SERVERS;
    }
  }

  // 第二轮：根据初步估算的服务器数量，选择最优磁盘规格
  const optimalDiskSize = selectOptimalDiskSize(capacityTiB, initialServerCount, ecScheme);

  // 第三轮：使用最优磁盘规格重新计算配置
  for (const diskSize of CONSTANTS.DISK_SIZES) {
    // 优先尝试最优磁盘规格
    const priority = diskSize === optimalDiskSize ? 0 : Math.abs(diskSize - optimalDiskSize);

    let serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC8+2');
    let currentEcScheme = 'EC8+2';

    // 如果不足 5 台，降级到 EC4+2
    if (serverCount < CONSTANTS.EC8_2_MIN_SERVERS) {
      serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC4+2');
      currentEcScheme = 'EC4+2';

      // EC4+2 最少 3 台
      if (serverCount < CONSTANTS.EC4_2_MIN_SERVERS) {
        serverCount = CONSTANTS.EC4_2_MIN_SERVERS;
      }
    }

    // 计算性能
    const performance = calculatePerformance(serverCount);
    const actualCapacity = calculateActualCapacity(serverCount, diskSize, currentEcScheme);

    // 检查是否满足性能需求
    const perfCheck = checkPerformance(performance, perfRequirements);

    const config = {
      serverCount,
      ecScheme: currentEcScheme,
      diskSize,
      actualCapacity,
      performance,
      perfCheck,
      priority,
      capacityUnitPreference: capacityInfo.isBinary,
      bandwidthUnitPreference
    };

    // 如果满足所有需求，保存配置
    if (perfCheck.passed) {
      // 优先选择最优磁盘规格，其次选择更大的磁盘（更少的服务器）
      if (!bestConfig || config.priority < bestConfig.priority ||
          (config.priority === bestConfig.priority && diskSize > bestConfig.diskSize)) {
        bestConfig = config;
      }
    }
  }

  // 如果没有找到满足性能的配置，返回最优磁盘规格的配置
  if (!bestConfig) {
    let serverCount = calculateServersForCapacity(capacityTiB, optimalDiskSize, 'EC8+2');
    let currentEcScheme = 'EC8+2';

    if (serverCount < CONSTANTS.EC8_2_MIN_SERVERS) {
      serverCount = calculateServersForCapacity(capacityTiB, optimalDiskSize, 'EC4+2');
      currentEcScheme = 'EC4+2';
      if (serverCount < CONSTANTS.EC4_2_MIN_SERVERS) {
        serverCount = CONSTANTS.EC4_2_MIN_SERVERS;
      }
    }

    const performance = calculatePerformance(serverCount);
    const actualCapacity = calculateActualCapacity(serverCount, optimalDiskSize, currentEcScheme);
    const perfCheck = checkPerformance(performance, perfRequirements);

    bestConfig = {
      serverCount,
      ecScheme: currentEcScheme,
      diskSize: optimalDiskSize,
      actualCapacity,
      performance,
      perfCheck,
      capacityUnitPreference: capacityInfo.isBinary,
      bandwidthUnitPreference,
      warning: '无法满足所有性能需求，建议增加服务器数量或调整需求'
    };
  }

  // 优化纠删码方案：如果使用 EC4+2 但服务器数 >= 5，切换到 EC8+2
  if (bestConfig.ecScheme === 'EC4+2' && bestConfig.serverCount >= CONSTANTS.EC8_2_MIN_SERVERS) {
    bestConfig.ecScheme = 'EC8+2';
    bestConfig.actualCapacity = calculateActualCapacity(bestConfig.serverCount, bestConfig.diskSize, 'EC8+2');
  }

  return bestConfig;
}

/**
 * 格式化输出结果
 */
function formatResult(config) {
  const result = {
    configuration: {
      serverCount: config.serverCount,
      ecScheme: config.ecScheme,
      diskConfig: `每台服务器 ${CONSTANTS.DISKS_PER_SERVER} × ${config.diskSize}TB HDD`
    },
    capacity: {
      available: formatCapacity(config.actualCapacity, config.capacityUnitPreference)
    },
    performance: {
      uploadBandwidth: formatBandwidth(config.performance.uploadBandwidth, config.bandwidthUnitPreference),
      downloadBandwidth: formatBandwidth(config.performance.downloadBandwidth, config.bandwidthUnitPreference),
      uploadOps: `${config.performance.uploadOps.toLocaleString()} IOPS`,
      downloadOps: `${config.performance.downloadOps.toLocaleString()} IOPS`
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

// CLI 入口
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
  --upload-bw <带宽>         上传带宽需求，如 "100MB/s", "1GiB/s"
  --download-bw <带宽>       下载带宽需求，如 "200MB/s", "2GiB/s"
  --upload-ops <IOPS>        上传 OPS 需求（4K 对象）
  --download-ops <IOPS>      下载 OPS 需求（4K 对象）
  --json                     以 JSON 格式输出

示例:
  node xsky-xeos-planner.js --capacity 500TiB
  node xsky-xeos-planner.js --capacity 2PB --upload-bw 10GB/s --download-bw 20GB/s
  node xsky-xeos-planner.js --capacity 1PiB --upload-ops 50000 --json
`);
    process.exit(0);
  }

  // 解析命令行参数
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
      console.log(`  纠删码方案: ${result.configuration.ecScheme}`);
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

// 导出函数供其他模块使用
module.exports = {
  planXEOS,
  formatResult,
  parseCapacity,
  parseBandwidth
};
