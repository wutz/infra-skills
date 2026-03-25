#!/usr/bin/env node

/**
 * GPFS ECE 高性能文件存储规划计算器
 * 根据容量和性能需求计算 GPFS ECE 服务器配置方案
 */

// 常量配置
const CONSTANTS = {
  SSDS_PER_SERVER: 24,
  TB_TO_TIB: 0.909,
  METADATA_RESERVED: 0.9,          // 10% 元数据和系统保留
  SSD_SIZES: [7.68, 15.36],  // TB，从小到大

  // EC 方案效率
  EC4_2P_EFFICIENCY: 0.6667,       // 4/6
  EC8_3P_EFFICIENCY: 0.7273,       // 8/11
  EC8_2P_EFFICIENCY: 0.8,          // 8/10

  // 每节点性能 (800Gb RoCE/IB)
  WRITE_BW_PER_NODE: 21800,        // MiB/s
  READ_BW_BASE: 52000,             // MiB/s (3 节点时)
  READ_BW_DECAY: 636,              // 每增加一个节点减少的 MiB/s
  READ_BW_FLOOR: 38000,            // 每节点最低读带宽
  READ_IOPS_PER_NODE: 225000,
  WRITE_IOPS_PER_NODE: 225000,

  // 网络类型乘数
  NETWORK_MULTIPLIERS: { roce: 1.0, ib: 1.0, ethernet: 0.3 },

  // 基准网络带宽 (Gb)
  NETWORK_BANDWIDTH_BASE: 800
};

/**
 * 根据服务器台数和容错要求确定 EC 方案
 */
function getECScheme(serverCount, faultTolerance) {
  if (faultTolerance === 3) {
    // ft=3 强制 EC8+3P，需要至少 11 台
    return { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, tolerance: 3 };
  }

  if (serverCount <= 3) {
    return { scheme: 'EC4+2P', efficiency: CONSTANTS.EC4_2P_EFFICIENCY, tolerance: 1 };
  }
  if (serverCount === 4) {
    return { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, tolerance: 1 };
  }
  if (serverCount >= 5 && serverCount <= 9) {
    return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 1 };
  }
  // 10+
  if (faultTolerance === 2 || serverCount >= 10) {
    return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 2 };
  }
  return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 2 };
}

/**
 * 根据容错级别确定最小服务器台数
 */
function getMinServersForFT(faultTolerance) {
  if (faultTolerance === 3) return 11;
  if (faultTolerance === 2) return 10;
  return 3; // ft=1
}

/**
 * 计算给定台数和 SSD 规格下的可用容量 (TiB)
 */
function calculateCapacity(serverCount, ssdSizeTB, ecEfficiency) {
  return serverCount * CONSTANTS.SSDS_PER_SERVER * ssdSizeTB * CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.METADATA_RESERVED;
}

/**
 * 计算每节点读带宽 (MiB/s)
 */
function getReadBWPerNode(serverCount) {
  const bw = CONSTANTS.READ_BW_BASE - CONSTANTS.READ_BW_DECAY * (serverCount - 3);
  return Math.max(CONSTANTS.READ_BW_FLOOR, Math.min(CONSTANTS.READ_BW_BASE, bw));
}

/**
 * 计算集群性能
 * networkType: roce/ib/ethernet
 * networkMultiplier: 网络类型乘数 (roce/ib=1.0, ethernet=0.3)
 * bandwidthRatio: 实际带宽与基准800Gb的比值 (仅RoCE/IB的BW受影响)
 */
function calculatePerformance(serverCount, networkType, networkMultiplier, bandwidthRatio) {
  const readBWPerNode = getReadBWPerNode(serverCount);

  if (networkType === 'ethernet') {
    // 以太网：所有指标统一使用 0.3 乘数，不受带宽比例影响
    return {
      readBandwidth: serverCount * readBWPerNode * networkMultiplier,
      writeBandwidth: serverCount * CONSTANTS.WRITE_BW_PER_NODE * networkMultiplier,
      readIOPS: serverCount * CONSTANTS.READ_IOPS_PER_NODE * networkMultiplier,
      writeIOPS: serverCount * CONSTANTS.WRITE_IOPS_PER_NODE * networkMultiplier
    };
  }

  // RoCE/IB：BW 受带宽比例影响，IOPS 不受影响
  return {
    readBandwidth: serverCount * readBWPerNode * networkMultiplier * bandwidthRatio,
    writeBandwidth: serverCount * CONSTANTS.WRITE_BW_PER_NODE * networkMultiplier * bandwidthRatio,
    readIOPS: serverCount * CONSTANTS.READ_IOPS_PER_NODE * networkMultiplier,
    writeIOPS: serverCount * CONSTANTS.WRITE_IOPS_PER_NODE * networkMultiplier
  };
}

/**
 * 查找满足容量需求的最小服务器台数（迭代搜索，因 EC 方案随台数变化）
 */
function findMinServersForCapacity(capacityTiB, ssdSizeTB, faultTolerance) {
  const minFT = getMinServersForFT(faultTolerance);

  for (let n = Math.max(3, minFT); n <= 200; n++) {
    const ec = getECScheme(n, faultTolerance);
    const capacity = calculateCapacity(n, ssdSizeTB, ec.efficiency);
    if (capacity >= capacityTiB) {
      return n;
    }
  }
  return null; // 无法满足
}

/**
 * 查找满足性能需求的最小服务器台数（迭代搜索，因读带宽非线性）
 */
function findMinServersForPerformance(perfRequirements, networkType, networkMultiplier, bandwidthRatio) {
  if (Object.keys(perfRequirements).length === 0) return 0;

  for (let n = 3; n <= 200; n++) {
    const perf = calculatePerformance(n, networkType, networkMultiplier, bandwidthRatio);
    const satisfied =
      (!perfRequirements.readBandwidth || perf.readBandwidth >= perfRequirements.readBandwidth) &&
      (!perfRequirements.writeBandwidth || perf.writeBandwidth >= perfRequirements.writeBandwidth) &&
      (!perfRequirements.readIOPS || perf.readIOPS >= perfRequirements.readIOPS) &&
      (!perfRequirements.writeIOPS || perf.writeIOPS >= perfRequirements.writeIOPS);

    if (satisfied) return n;
  }
  return 200;
}

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
 * 解析带宽输入，统一转换为 MiB/s
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
 * 解析网络类型
 */
function parseNetworkType(input) {
  const normalized = input.toLowerCase().trim();
  if (['roce', 'rdma', 'rocev2'].includes(normalized)) return 'roce';
  if (['ib', 'infiniband'].includes(normalized)) return 'ib';
  if (['ethernet', 'eth', 'tcp'].includes(normalized)) return 'ethernet';
  throw new Error(`不支持的网络类型: ${input}，请使用 roce、ib 或 ethernet`);
}

/**
 * 解析容错级别
 */
function parseFaultTolerance(input) {
  const ft = parseInt(input);
  if (![1, 2, 3].includes(ft)) {
    throw new Error(`无效的容错级别: ${input}，请使用 1、2 或 3`);
  }
  return ft;
}

/**
 * 格式化容量输出
 */
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

/**
 * 格式化带宽输出
 */
function formatBandwidth(mibps, preferBinary = true) {
  if (preferBinary) {
    if (mibps >= 1024) {
      return `${(mibps / 1024).toFixed(2)} GiB/s`;
    }
    return `${mibps.toFixed(2)} MiB/s`;
  } else {
    const mbs = mibps * 1.024;
    if (mbs >= 1000) {
      return `${(mbs / 1000).toFixed(2)} GB/s`;
    }
    return `${mbs.toFixed(2)} MB/s`;
  }
}

/**
 * 主规划函数 - 生成多个方案
 */
function planGPFSECE(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  // 解析网络类型
  const networkType = requirements.networkType ? parseNetworkType(requirements.networkType) : 'roce';
  const networkMultiplier = CONSTANTS.NETWORK_MULTIPLIERS[networkType];

  // 解析网络带宽，计算带宽比例（仅影响 RoCE/IB 的 BW）
  const networkBandwidth = requirements.networkBandwidth ? parseInt(requirements.networkBandwidth) : CONSTANTS.NETWORK_BANDWIDTH_BASE;
  const bandwidthRatio = networkBandwidth / CONSTANTS.NETWORK_BANDWIDTH_BASE;

  // 解析容错级别
  const faultTolerance = requirements.faultTolerance ? parseFaultTolerance(requirements.faultTolerance) : 1;

  // 解析性能需求
  const perfRequirements = {};
  let bandwidthUnitPreference = null;

  if (requirements.readBandwidth) {
    const bwInfo = parseBandwidth(requirements.readBandwidth);
    perfRequirements.readBandwidth = bwInfo.mibps;
    bandwidthUnitPreference = bandwidthUnitPreference || bwInfo.isBinary;
  }
  if (requirements.writeBandwidth) {
    const bwInfo = parseBandwidth(requirements.writeBandwidth);
    perfRequirements.writeBandwidth = bwInfo.mibps;
    bandwidthUnitPreference = bandwidthUnitPreference || bwInfo.isBinary;
  }
  if (requirements.readIOPS) {
    perfRequirements.readIOPS = parseInt(requirements.readIOPS);
  }
  if (requirements.writeIOPS) {
    perfRequirements.writeIOPS = parseInt(requirements.writeIOPS);
  }

  if (bandwidthUnitPreference === null) {
    bandwidthUnitPreference = false;
  }

  // 最小性能服务器数
  const minServersForPerf = findMinServersForPerformance(perfRequirements, networkType, networkMultiplier, bandwidthRatio);
  // 最小容错服务器数
  const minServersForFT = getMinServersForFT(faultTolerance);

  // 收集所有满足需求的方案
  const allConfigs = [];

  for (const ssdSize of CONSTANTS.SSD_SIZES) {
    // 查找满足容量的最小台数
    const minServersForCap = findMinServersForCapacity(capacityTiB, ssdSize, faultTolerance);
    if (minServersForCap === null) continue;

    // 取三者最大值
    const serverCount = Math.max(minServersForCap, minServersForPerf, minServersForFT);

    // 确定 EC 方案
    const ec = getECScheme(serverCount, faultTolerance);

    // 计算实际容量和性能
    const actualCapacity = calculateCapacity(serverCount, ssdSize, ec.efficiency);
    const performance = calculatePerformance(serverCount, networkType, networkMultiplier, bandwidthRatio);

    // 验证性能满足
    const perfSatisfied =
      (!perfRequirements.readBandwidth || performance.readBandwidth >= perfRequirements.readBandwidth) &&
      (!perfRequirements.writeBandwidth || performance.writeBandwidth >= perfRequirements.writeBandwidth) &&
      (!perfRequirements.readIOPS || performance.readIOPS >= perfRequirements.readIOPS) &&
      (!perfRequirements.writeIOPS || performance.writeIOPS >= perfRequirements.writeIOPS);

    if (actualCapacity < capacityTiB || !perfSatisfied) continue;

    allConfigs.push({
      serverCount,
      ssdSize,
      ecScheme: ec.scheme,
      ecEfficiency: ec.efficiency,
      faultTolerance: ec.tolerance,
      actualCapacity,
      performance
    });
  }

  // 如果没有 ft=2 的方案，为第二个方案生成 ft=2 版本
  const hasFt2 = allConfigs.some(c => c.faultTolerance === 2);

  if (!requirements.faultTolerance && !hasFt2 && allConfigs.length >= 1) {
    const firstConfig = allConfigs[0];
    const ft2MinServers = 10;

    if (firstConfig.serverCount < ft2MinServers) {
      // 使用相同 SSD 规格，但增加到 10 台以支持 ft=2
      const ec = getECScheme(ft2MinServers, 2);
      const actualCapacity = calculateCapacity(ft2MinServers, firstConfig.ssdSize, ec.efficiency);
      const performance = calculatePerformance(ft2MinServers, networkType, networkMultiplier, bandwidthRatio);

      if (actualCapacity >= capacityTiB) {
        allConfigs.push({
          serverCount: ft2MinServers,
          ssdSize: firstConfig.ssdSize,
          ecScheme: ec.scheme,
          ecEfficiency: ec.efficiency,
          faultTolerance: 2,
          actualCapacity,
          performance
        });
      }
    }
  }

  // 按台数排序，台数相同按 SSD 大小排序
  allConfigs.sort((a, b) => {
    if (a.serverCount !== b.serverCount) return a.serverCount - b.serverCount;
    return a.ssdSize - b.ssdSize;
  });

  // 推荐方案：台数最少的第一个
  const bestConfig = allConfigs.length > 0 ? allConfigs[0] : null;

  if (!bestConfig) {
    throw new Error('无法找到满足所有需求的配置方案');
  }

  return {
    allConfigs,
    bestConfig,
    networkType,
    networkMultiplier,
    networkBandwidth,
    bandwidthRatio,
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitPreference
  };
}

/**
 * 格式化输出结果
 */
function formatResult(planResult) {
  const { allConfigs, bestConfig, capacityUnitPreference, bandwidthUnitPreference } = planResult;

  const solutions = allConfigs.map((config, index) => ({
    solutionId: index + 1,
    isRecommended: config === bestConfig,
    configuration: {
      serverCount: config.serverCount,
      ecScheme: config.ecScheme,
      diskConfig: `每台服务器 ${CONSTANTS.SSDS_PER_SERVER} × ${config.ssdSize}TB NVMe SSD`
    },
    capacity: {
      available: formatCapacity(config.actualCapacity, capacityUnitPreference)
    },
    performance: {
      readBandwidth: formatBandwidth(config.performance.readBandwidth, bandwidthUnitPreference),
      writeBandwidth: formatBandwidth(config.performance.writeBandwidth, bandwidthUnitPreference),
      readIOPS: `${Math.floor(config.performance.readIOPS).toLocaleString()} IOPS`,
      writeIOPS: `${Math.floor(config.performance.writeIOPS).toLocaleString()} IOPS`
    }
  }));

  return {
    solutions,
    recommendedSolution: 1
  };
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
GPFS ECE 高性能文件存储规划工具

用法:
  node gpfs-ece-planner.js --capacity <容量> [选项]

必需参数:
  --capacity <容量>              容量需求，如 "500TiB", "1.5PiB"

可选参数:
  --read-bw <带宽>               读带宽需求，如 "100GB/s", "1GiB/s"
  --write-bw <带宽>              写带宽需求，如 "50GB/s", "500MiB/s"
  --read-iops <IOPS>             读 IOPS 需求
  --write-iops <IOPS>            写 IOPS 需求
  --network-type <类型>          网络类型：roce|ib|ethernet（默认 roce）
  --network-bandwidth <Gb>       网络总带宽，如 400、800（默认 800）
  --fault-tolerance <级别>       容错级别：1|2|3（默认 1）
  --json                         以 JSON 格式输出

示例:
  node gpfs-ece-planner.js --capacity 500TiB
  node gpfs-ece-planner.js --capacity 500TiB --read-bw 100GB/s --write-bw 50GB/s
  node gpfs-ece-planner.js --capacity 1PiB --fault-tolerance 2 --json
  node gpfs-ece-planner.js --capacity 1PiB --network-type roce --network-bandwidth 400 --json
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
      case '--read-bw':
        requirements.readBandwidth = args[++i];
        break;
      case '--write-bw':
        requirements.writeBandwidth = args[++i];
        break;
      case '--read-iops':
        requirements.readIOPS = args[++i];
        break;
      case '--write-iops':
        requirements.writeIOPS = args[++i];
        break;
      case '--network-type':
        requirements.networkType = args[++i];
        break;
      case '--network-bandwidth':
        requirements.networkBandwidth = args[++i];
        break;
      case '--fault-tolerance':
        requirements.faultTolerance = args[++i];
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
    const planResult = planGPFSECE(requirements);
    const result = formatResult(planResult);

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('\n=== GPFS ECE 高性能文件存储规划方案 ===\n');
      console.log(`共找到 ${result.solutions.length} 个满足需求的方案\n`);

      result.solutions.forEach((solution) => {
        const prefix = solution.isRecommended ? '【推荐】' : '        ';
        console.log(`${prefix}方案 ${solution.solutionId}:`);
        console.log(`  服务器台数: ${solution.configuration.serverCount} 台`);
        console.log(`  纠删码方案: ${solution.configuration.ecScheme}`);
        console.log(`  磁盘配置: ${solution.configuration.diskConfig}`);
        console.log(`  可用容量: ${solution.capacity.available}`);
        console.log(`  读带宽: ${solution.performance.readBandwidth}`);
        console.log(`  写带宽: ${solution.performance.writeBandwidth}`);
        console.log(`  读 IOPS: ${solution.performance.readIOPS}`);
        console.log(`  写 IOPS: ${solution.performance.writeIOPS}`);
        console.log();
      });
    }
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

// 导出函数供其他模块使用
module.exports = {
  planGPFSECE,
  formatResult,
  parseCapacity,
  parseBandwidth,
  getECScheme,
  calculateCapacity,
  calculatePerformance,
  getReadBWPerNode,
  CONSTANTS
};
