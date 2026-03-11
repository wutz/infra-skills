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
 * 计算满足性能需求的最小服务器数
 */
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

/**
 * 评估配置优劣（返回分数，越小越好）
 */
function scoreConfig(config, capacityTiB) {
  // 不满足性能或容量：淘汰
  if (!config.perfCheck.passed || config.actualCapacity < capacityTiB) {
    return Infinity;
  }

  // 满足所有需求：计算容量过配比例（越接近1越好）
  const overProvisionRatio = config.actualCapacity / capacityTiB;

  // 如果节点数 >= 5，EC8+2 优先（磁盘利用率更高：80% vs 66.67%）
  // EC8+2 的磁盘利用率比 EC4+2 高 20%（0.8 / 0.6667 = 1.2）
  // 因此给 EC8+2 一个 0.83 的系数（约等于 1/1.2），抵消其容量优势带来的评分劣势
  const ecBonus = (config.serverCount >= 5 && config.ecScheme === 'EC8+2') ? 0.83 : 1.0;

  // 主评分：过配比例 * EC方案加成
  // 次评分：服务器数量（归一化到0-0.1范围，避免影响主评分）
  const primaryScore = overProvisionRatio * ecBonus;
  const secondaryScore = config.serverCount * 0.001; // 服务器数量作为微小的次要因素

  return primaryScore + secondaryScore;
}

/**
 * 主规划函数
 */
function planXEOS(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  // 解析性能需求
  const perfRequirements = {};
  let bandwidthUnitPreference = null;

  if (requirements.uploadBandwidth) {
    const bwInfo = parseBandwidth(requirements.uploadBandwidth);
    perfRequirements.uploadBandwidth = bwInfo.mibps;
    bandwidthUnitPreference = bandwidthUnitPreference || bwInfo.isBinary;
  }
  if (requirements.downloadBandwidth) {
    const bwInfo = parseBandwidth(requirements.downloadBandwidth);
    perfRequirements.downloadBandwidth = bwInfo.mibps;
    bandwidthUnitPreference = bandwidthUnitPreference || bwInfo.isBinary;
  }
  if (requirements.uploadOps) {
    perfRequirements.uploadOps = parseInt(requirements.uploadOps);
  }
  if (requirements.downloadOps) {
    perfRequirements.downloadOps = parseInt(requirements.downloadOps);
  }

  // 默认使用十进制单位
  if (bandwidthUnitPreference === null) {
    bandwidthUnitPreference = false;
  }

  // 计算性能需求的最小服务器数
  const minServersForPerf = calculateMinServersForPerf(perfRequirements);

  // 生成所有可能的配置
  const configs = [];
  for (const ecScheme of ['EC8+2', 'EC4+2']) {
    const minServers = ecScheme === 'EC8+2' ? CONSTANTS.EC8_2_MIN_SERVERS : CONSTANTS.EC4_2_MIN_SERVERS;

    for (const diskSize of CONSTANTS.DISK_SIZES) {
      // 计算服务器数：取容量、性能、最小要求的最大值
      const capacityServers = calculateServersForCapacity(capacityTiB, diskSize, ecScheme);
      const serverCount = Math.max(capacityServers, minServersForPerf, minServers);

      // 计算实际容量和性能
      const actualCapacity = calculateActualCapacity(serverCount, diskSize, ecScheme);
      const performance = calculatePerformance(serverCount);
      const perfCheck = checkPerformance(performance, perfRequirements);

      configs.push({
        serverCount,
        diskSize,
        ecScheme,
        actualCapacity,
        performance,
        perfCheck
      });
    }
  }

  // 选择最优配置：评分最低的
  const bestConfig = configs.reduce((best, current) => {
    const currentScore = scoreConfig(current, capacityTiB);
    const bestScore = scoreConfig(best, capacityTiB);
    return currentScore < bestScore ? current : best;
  });

  // 检查是否找到有效配置
  if (scoreConfig(bestConfig, capacityTiB) === Infinity) {
    throw new Error('无法找到满足所有需求的配置方案');
  }

  return {
    ...bestConfig,
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitPreference
  };
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
