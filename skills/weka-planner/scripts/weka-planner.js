#!/usr/bin/env node

/**
 * Weka 高性能文件系统容量和性能规划计算器
 * 根据容量和性能需求计算 Weka 集群配置方案
 */

// 常量配置
const CONSTANTS = {
  MIN_NODES: 6,
  NVME_OPTIONS: [4, 8, 12],
  SSD_SIZES_TB: [7.68, 15.36],
  TB_TO_TIB: 0.909,
  METADATA_RESERVED: 0.9,          // 10% 元数据和系统保留
  DEFAULT_NETWORK: '200gb',         // 默认使用更高规格的网络
  HOT_SPARE: 1,                     // 默认热备节点数（不参与容量计算，参与性能计算）

  // 性能公式系数
  WRITE_BW_PER_NVME_NODE: 0.6625,    // GB/s
  WRITE_IOPS_PER_NVME_NODE: 27000,
  READ_IOPS_PER_NVME_NODE: 225000,
  READ_BW_PER_NVME_NODE: 4.346,      // GB/s (无网络瓶颈时)

  // 网络带宽限制 (每节点，2 块双口网卡)
  NETWORK_BW_100GB: 45.0,            // GB/s per node (100Gb 双口×2 = 4×100Gb)
  NETWORK_BW_200GB: 90.0,            // GB/s per node (200Gb 双口×2 = 4×200Gb)
};

/**
 * 根据节点数和保护级别确定保护方案
 * @param {number} nodeCount - 节点数
 * @param {number} protectionLevel - 保护级别 (2, 3, 4)
 * @returns {object} - { D, P, stripeWidth, efficiency }
 */
function getProtectionScheme(nodeCount, protectionLevel = 2) {
  let D, P;

  if (nodeCount >= 100) {
    // 100+ 节点：推荐 N+4
    D = 8;
    P = 4;
  } else if (nodeCount >= 10) {
    // 10-99 节点：D=8
    D = 8;
    P = protectionLevel;
  } else {
    // 6-9 节点：D=5
    D = 5;
    P = Math.min(protectionLevel, 3);  // 6-9节点最多支持P=3，保证D>P
  }

  // 验证约束
  if (D <= P) {
    throw new Error(`数据块 (D=${D}) 必须大于校验块 (P=${P})`);
  }

  const stripeWidth = D + P;
  if (stripeWidth < 5 || stripeWidth > 20) {
    throw new Error(`条带宽度 (${stripeWidth}) 必须在 5-20 范围内`);
  }

  return {
    D,
    P,
    stripeWidth,
    efficiency: D / stripeWidth,
    scheme: `EC ${D}+${P}`
  };
}

/**
 * 计算给定配置下的可用容量 (TiB)
 * @param {number} nodes - 节点数
 * @param {number} nvme - 每节点 NVMe 数量
 * @param {number} ssdTB - 单盘容量 (TB)
 * @param {number} D - 数据块数
 * @param {number} P - 校验块数
 * @returns {number} - 可用容量 (TiB)
 */
function calculateCapacity(nodes, nvme, ssdTB, D, P) {
  const efficiency = D / (D + P);
  return nodes * nvme * ssdTB * CONSTANTS.TB_TO_TIB * efficiency * CONSTANTS.METADATA_RESERVED;
}

/**
 * 计算集群性能
 * @param {number} nodes - 节点数
 * @param {number} nvme - 每节点 NVMe 数量
 * @param {string} networkType - 网络类型 ('100gb' 或 '200gb')
 * @returns {object} - { readBW, writeBW, readIOPS, writeIOPS } (GB/s 和 IOPS)
 */
function calculatePerformance(nodes, nvme, networkType) {
  // 写性能（不受网络限制）
  const writeBW = nodes * nvme * CONSTANTS.WRITE_BW_PER_NVME_NODE;
  const writeIOPS = nodes * nvme * CONSTANTS.WRITE_IOPS_PER_NVME_NODE;

  // 读 IOPS（不受网络限制）
  const readIOPS = nodes * nvme * CONSTANTS.READ_IOPS_PER_NVME_NODE;

  // 读带宽（受网络带宽限制）
  const networkBWPerNode = networkType === '200gb' ? CONSTANTS.NETWORK_BW_200GB : CONSTANTS.NETWORK_BW_100GB;
  const networkCapacity = nodes * networkBWPerNode;
  const theoreticalReadBW = nodes * nvme * CONSTANTS.READ_BW_PER_NVME_NODE;
  const readBW = Math.min(theoreticalReadBW, networkCapacity);

  return {
    readBW,
    writeBW,
    readIOPS,
    writeIOPS
  };
}

/**
 * 主规划函数：查找满足所有需求的最优配置
 * @param {object} requirements - 需求参数
 * @returns {object} - 最优配置方案
 */
function planWeka(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  // 解析网络类型（未指定时默认使用高规格 200gb）
  const networkType = requirements.networkType ? requirements.networkType.toLowerCase() : CONSTANTS.DEFAULT_NETWORK;
  if (!['100gb', '200gb'].includes(networkType)) {
    throw new Error(`不支持的网络类型: ${requirements.networkType}，请使用 100gb 或 200gb`);
  }

  // 解析保护级别
  const protectionLevel = requirements.protectionLevel ? parseInt(requirements.protectionLevel) : 2;
  if (![2, 3, 4].includes(protectionLevel)) {
    throw new Error(`无效的保护级别: ${protectionLevel}，请使用 2、3 或 4`);
  }

  // 解析性能需求
  const perfRequirements = {};
  let bandwidthUnitPreference = null;

  if (requirements.readBandwidth) {
    const bwInfo = parseBandwidth(requirements.readBandwidth);
    perfRequirements.readBW = bwInfo.gbps;
    bandwidthUnitPreference = bandwidthUnitPreference || bwInfo.isBinary;
  }
  if (requirements.writeBandwidth) {
    const bwInfo = parseBandwidth(requirements.writeBandwidth);
    perfRequirements.writeBW = bwInfo.gbps;
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

  // 搜索最优配置
  let bestConfig = null;

  for (let nodes = CONSTANTS.MIN_NODES; nodes <= 100; nodes++) {
    // 确定保护方案
    const protection = getProtectionScheme(nodes, protectionLevel);

    for (const nvme of CONSTANTS.NVME_OPTIONS) {
      for (const ssdSize of CONSTANTS.SSD_SIZES_TB) {
        // 计算容量
        const actualCapacity = calculateCapacity(nodes, nvme, ssdSize, protection.D, protection.P);
        if (actualCapacity < capacityTiB) continue;

        // 计算性能（热备节点参与性能计算）
        const performance = calculatePerformance(nodes + CONSTANTS.HOT_SPARE, nvme, networkType);

        // 验证性能满足
        const perfSatisfied =
          (!perfRequirements.readBW || performance.readBW >= perfRequirements.readBW) &&
          (!perfRequirements.writeBW || performance.writeBW >= perfRequirements.writeBW) &&
          (!perfRequirements.readIOPS || performance.readIOPS >= perfRequirements.readIOPS) &&
          (!perfRequirements.writeIOPS || performance.writeIOPS >= perfRequirements.writeIOPS);

        if (!perfSatisfied) continue;

        const config = {
          nodes,
      nvme,
       ssdSize,
          protection,
          actualCapacity,
          performance
        };

        // 选择标准：节点最少 → NVMe 最少 → SSD 最小
        if (!bestConfig ||
            nodes < bestConfig.nodes ||
            (nodes === bestConfig.nodes && nvme < bestConfig.nvme) ||
            (nodes === bestConfig.nodes && nvme === bestConfig.nvme && ssdSize < bestConfig.ssdSize)) {
          bestConfig = config;
    }
      }
    }

    // 如果找到满足条件的配置，不再增加节点数
    if (bestConfig && bestConfig.nodes === nodes) {
    break;
    }
  }

  if (!bestConfig) {
    throw new Error('无法找到满足所有需求的配置方案（最大支持 100 节点）');
  }

  return {
    ...bestConfig,
    networkType,
    protectionLevel,
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitPreference
  };
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
 * 解析带宽输入，统一转换为 GB/s
 */
function parseBandwidth(input) {
  const match = input.match(/^([\d.]+)\s*(MB\/s|GB\/s|MiB\/s|GiB\/s)$/i);
  if (!match) {
    throw new Error(`无效的带宽格式: ${input}，请使用格式如 "100GB/s" 或 "1GiB/s"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];
  const unitLower = unit.toLowerCase();
  const isBinary = unitLower.includes('i');

  let gbps;
  if (unitLower === 'mb/s') {
    gbps = value / 1000;
  } else if (unitLower === 'gb/s') {
    gbps = value;
  } else if (unitLower === 'mib/s') {
    gbps = value / 1024 * 1.024;  // MiB/s to GB/s: MiB/s * 1.024 / 1000 * 1000 = MiB/s * 1.024 / 1000
    gbps = value * 1.024 / 1000;
  } else if (unitLower === 'gib/s') {
    gbps = value * 1.024;  // GiB/s to GB/s: GiB/s * 1024 MiB/GiB * 1.024 MB/MiB / 1000 MB/GB
  } else {
    throw new Error(`不支持的带宽单位: ${unit}`);
  }

  return { gbps, unit, isBinary };
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
function formatBandwidth(gbps, preferBinary = true) {
  if (preferBinary) {
    const gibps = gbps * 1000 / 1024;
    if (gibps >= 1) {
      return `${gibps.toFixed(2)} GiB/s`;
    }
    return `${(gibps * 1024).toFixed(2)} MiB/s`;
  } else {
    if (gbps >= 1) {
      return `${gbps.toFixed(2)} GB/s`;
    }
    return `${(gbps * 1000).toFixed(2)} MB/s`;
  }
}

/**
 * 格式化输出结果
 */
function formatResult(config) {
  const totalNodes = config.nodes + CONSTANTS.HOT_SPARE;
  const result = {
    configuration: {
      nodeCount: totalNodes,
      dataNodeCount: config.nodes,
      hotSpareCount: CONSTANTS.HOT_SPARE,
      cpuModel: 'Intel 5418Y',
      memory: '32GB',
      nvmePerNode: config.nvme,
      ssdSize: `${config.ssdSize}TB`,
      networkType: config.networkType === '100gb' ? '100Gb 双口×2' : '200Gb 双口×2',
      protectionScheme: config.protection.scheme,
      diskConfig: `每节点 ${config.nvme} × ${config.ssdSize}TB NVMe SSD`
    },
    capacity: {
      available: formatCapacity(config.actualCapacity, config.capacityUnitPreference),
      efficiency: `${(config.protection.efficiency * 100).toFixed(1)}%`
    },
    performance: {
      readBandwidth: formatBandwidth(config.performance.readBW, config.bandwidthUnitPreference),
      writeBandwidth: formatBandwidth(config.performance.writeBW, config.bandwidthUnitPreference),
      readIOPS: `${Math.floor(config.performance.readIOPS).toLocaleString()} IOPS`,
      writeIOPS: `${Math.floor(config.performance.writeIOPS).toLocaleString()} IOPS`
    },
    performanceStatus: '所有性能指标满足需求'
  };

  return result;
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Weka 高性能文件系统容量和性能规划工具

用法:
  node weka-planner.js --capacity <容量> [选项]

必需参数:
  --capacity <容量>          容量需求，如 "500TiB", "1.5PiB"

可选参数:
  --read-bw <带宽>               读带宽需求，如 "200GB/s", "1GiB/s"
  --write-bw <带宽>           写带宽需求，如 "50GB/s", "500MiB/s"
  --read-iops <IOPS>             读 IOPS 需求
  --write-iops <IOPS>         写 IOPS 需求
  --network-type <类型>        网络类型：100gb|200gb（默认 200gb）
  --protection-level <级别>      保护级别：2|3|4（默认 2）
  --json                以 JSON 格式输出

示例:
  node weka-planner.js --capacity 500TiB
  node weka-planner.js --capacity 500TiB --read-bw 200GB/s --network-type 200gb
  node weka-planner.js --capacity 1PiB --protection-level 4 --json
  node weka-planner.js --capacity 100TiB --read-bw 200GB/s --write-bw 50GB/s --json
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
      case '--protection-level':
        requirements.protectionLevel = args[++i];
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
    const config = planWeka(requirements);
    const result = formatResult(config);

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
    console.log('\n=== Weka 高性能文件系统规划方案 ===\n');
      console.log('配置方案:');
      console.log(`  节点数: ${result.configuration.nodeCount} 节点（${result.configuration.dataNodeCount} 数据节点 + ${result.configuration.hotSpareCount} 热备节点）`);
      console.log(`  CPU: ${result.configuration.cpuModel}`);
      console.log(`  内存: ${result.configuration.memory}`);
      console.log(`  网络: ${result.configuration.networkType}`);
      console.log(`  磁盘配置: ${result.configuration.diskConfig}`);
      console.log(`  保护方案: ${result.configuration.protectionScheme}`);
      console.log('\n容量:');
      console.log(`  可用容量: ${result.capacity.available}`);
      console.log(`  存储效率: ${result.capacity.efficiency}`);
      console.log('\n性能:');
      console.log(`  读带宽: ${result.performance.readBandwidth}`);
      console.log(`  写带宽: ${result.performance.writeBandwidth}`);
      console.log(`  读 IOPS: ${result.performance.readIOPS}`);
      console.log(`  写 IOPS: ${result.performance.writeIOPS}`);
      console.log(`\n性能状态: ${result.performanceStatus}`);
      console.log();
    }
  } catch (error) {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  }
}

// 导出函数供其他模块使用
module.exports = {
  planWeka,
  formatResult,
  parseCapacity,
  parseBandwidth,
  getProtectionScheme,
  calculateCapacity,
  calculatePerformance,
  CONSTANTS
};
