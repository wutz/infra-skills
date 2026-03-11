#!/usr/bin/env node

/**
 * XSKY XEOS 对象存储规划计算器
 * 根据容量和性能需求计算服务器配置方案
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
  MB_TO_MIB: 0.9536,
  // 单盘性能基准
  UPLOAD_BW_PER_DISK: 30, // MiB/s
  DOWNLOAD_BW_PER_DISK: 60, // MiB/s
  UPLOAD_OPS_PER_DISK: 100, // IOPS (4K)
  DOWNLOAD_OPS_PER_DISK: 300, // IOPS (4K)
  // 可选磁盘大小（TB）
  DISK_SIZES: [16, 12, 10, 8]
};

/**
 * 解析容量输入，统一转换为 TiB
 */
function parseCapacity(input) {
  const match = input.match(/^([\d.]+)\s*(TB|PB|TiB|PiB)$/i);
  if (!match) {
    throw new Error(`无效的容量格式: ${input}，请使用格式如 "500TB" 或 "1.5PiB"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  switch (unit) {
    case 'TB':
      return value * CONSTANTS.TB_TO_TIB;
    case 'PB':
      return value * 1000 * CONSTANTS.TB_TO_TIB;
    case 'TIB':
      return value;
    case 'PIB':
      return value * 1024;
    default:
      throw new Error(`不支持的单位: ${unit}`);
  }
}

/**
 * 解析带宽输入，统一转换为 MiB/s
 */
function parseBandwidth(input) {
  const match = input.match(/^([\d.]+)\s*(Mbps|Gbps|MB\/s|GB\/s)$/i);
  if (!match) {
    throw new Error(`无效的带宽格式: ${input}`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit.toLowerCase() === 'mbps') {
    return value / 8 * CONSTANTS.MB_TO_MIB;
  } else if (unit.toLowerCase() === 'gbps') {
    return value * 1000 / 8 * CONSTANTS.MB_TO_MIB;
  } else if (unit.toLowerCase() === 'mb/s') {
    return value * CONSTANTS.MB_TO_MIB;
  } else if (unit.toLowerCase() === 'gb/s') {
    return value * 1000 * CONSTANTS.MB_TO_MIB;
  }

  throw new Error(`不支持的带宽单位: ${unit}`);
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
 * 格式化容量输出
 */
function formatCapacity(tib) {
  if (tib >= 1024) {
    return `${(tib / 1024).toFixed(2)} PiB (${(tib / CONSTANTS.TB_TO_TIB / 1000).toFixed(2)} PB)`;
  }
  return `${tib.toFixed(2)} TiB (${(tib / CONSTANTS.TB_TO_TIB).toFixed(2)} TB)`;
}

/**
 * 格式化带宽输出
 */
function formatBandwidth(mibps) {
  const gbps = mibps / CONSTANTS.MB_TO_MIB * 8 / 1000;
  const gbs = mibps / CONSTANTS.MB_TO_MIB / 1000;
  return `${mibps.toFixed(2)} MiB/s (${gbps.toFixed(2)} Gbps / ${gbs.toFixed(2)} GB/s)`;
}

/**
 * 主规划函数
 */
function planXEOS(requirements) {
  const capacityTiB = parseCapacity(requirements.capacity);

  // 解析性能需求（如果有）
  const perfRequirements = {};
  if (requirements.uploadBandwidth) {
    perfRequirements.uploadBandwidth = parseBandwidth(requirements.uploadBandwidth);
  }
  if (requirements.downloadBandwidth) {
    perfRequirements.downloadBandwidth = parseBandwidth(requirements.downloadBandwidth);
  }
  if (requirements.uploadOps) {
    perfRequirements.uploadOps = parseInt(requirements.uploadOps);
  }
  if (requirements.downloadOps) {
    perfRequirements.downloadOps = parseInt(requirements.downloadOps);
  }

  let bestConfig = null;

  // 遍历磁盘大小
  for (const diskSize of CONSTANTS.DISK_SIZES) {
    // 先尝试 EC8+2
    let serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC8+2');
    let ecScheme = 'EC8+2';

    // 如果不足 5 台，降级到 EC4+2
    if (serverCount < CONSTANTS.EC8_2_MIN_SERVERS) {
      serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC4+2');
      ecScheme = 'EC4+2';

      // EC4+2 最少 3 台
      if (serverCount < CONSTANTS.EC4_2_MIN_SERVERS) {
        serverCount = CONSTANTS.EC4_2_MIN_SERVERS;
      }
    }

    // 计算性能
    const performance = calculatePerformance(serverCount);
    const actualCapacity = calculateActualCapacity(serverCount, diskSize, ecScheme);

    // 检查是否满足性能需求
    const perfCheck = checkPerformance(performance, perfRequirements);

    const config = {
      serverCount,
      ecScheme,
      diskSize,
      actualCapacity,
      performance,
      perfCheck
    };

    // 如果满足所有需求，保存配置
    if (perfCheck.passed) {
      // 优先选择更大的磁盘（更少的服务器）
      if (!bestConfig || diskSize > bestConfig.diskSize) {
        bestConfig = config;
      }
    }
  }

  // 如果没有找到满足性能的配置，返回默认的 16TB 配置
  if (!bestConfig) {
    const diskSize = 16;
    let serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC8+2');
    let ecScheme = 'EC8+2';

    if (serverCount < CONSTANTS.EC8_2_MIN_SERVERS) {
      serverCount = calculateServersForCapacity(capacityTiB, diskSize, 'EC4+2');
      ecScheme = 'EC4+2';
      if (serverCount < CONSTANTS.EC4_2_MIN_SERVERS) {
        serverCount = CONSTANTS.EC4_2_MIN_SERVERS;
      }
    }

    const performance = calculatePerformance(serverCount);
    const actualCapacity = calculateActualCapacity(serverCount, diskSize, ecScheme);
    const perfCheck = checkPerformance(performance, perfRequirements);

    bestConfig = {
      serverCount,
      ecScheme,
      diskSize,
      actualCapacity,
      performance,
      perfCheck,
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
      available: formatCapacity(config.actualCapacity)
    },
    performance: {
      uploadBandwidth: formatBandwidth(config.performance.uploadBandwidth),
      downloadBandwidth: formatBandwidth(config.performance.downloadBandwidth),
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
  node xeos-planner.js --capacity <容量> [选项]

必需参数:
  --capacity <容量>          容量需求，如 "500TB", "1.5PiB"

可选参数:
  --upload-bw <带宽>         上传带宽需求，如 "1Gbps", "100MB/s"
  --download-bw <带宽>       下载带宽需求，如 "2Gbps", "200MB/s"
  --upload-ops <IOPS>        上传 OPS 需求（4K 对象）
  --download-ops <IOPS>      下载 OPS 需求（4K 对象）
  --json                     以 JSON 格式输出

示例:
  node xeos-planner.js --capacity 500TiB
  node xeos-planner.js --capacity 2PB --upload-bw 10Gbps --download-bw 20Gbps
  node xeos-planner.js --capacity 1PiB --upload-ops 50000 --json
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
      console.log('\n=== XEOS 对象存储规划方案 ===\n');
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
