#!/usr/bin/env node

/**
 * Weka 高性能文件系统容量和性能规划计算器
 * 根据容量和性能需求计算 Weka 集群配置方案（输出多个方案）
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
 */
function getProtectionScheme(nodeCount, protectionLevel = 2) {
  let D, P;

  if (nodeCount >= 100) {
    D = 8;
    P = 4;
  } else if (nodeCount >= 10) {
    D = 8;
    P = protectionLevel;
  } else {
    D = 5;
    P = Math.min(protectionLevel, 3);
  }

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
 */
function calculateCapacity(nodes, nvme, ssdTB, D, P) {
  const efficiency = D / (D + P);
  return nodes * nvme * ssdTB * CONSTANTS.TB_TO_TIB * efficiency * CONSTANTS.METADATA_RESERVED;
}

/**
 * 计算集群性能
 */
function calculatePerformance(nodes, nvme, networkType) {
  const writeBW = nodes * nvme * CONSTANTS.WRITE_BW_PER_NVME_NODE;
  const writeIOPS = nodes * nvme * CONSTANTS.WRITE_IOPS_PER_NVME_NODE;
  const readIOPS = nodes * nvme * CONSTANTS.READ_IOPS_PER_NVME_NODE;

  const networkBWPerNode = networkType === '200gb' ? CONSTANTS.NETWORK_BW_200GB : CONSTANTS.NETWORK_BW_100GB;
  const networkCapacity = nodes * networkBWPerNode;
  const theoreticalReadBW = nodes * nvme * CONSTANTS.READ_BW_PER_NVME_NODE;
  const readBW = Math.min(theoreticalReadBW, networkCapacity);

  return { readBW, writeBW, readIOPS, writeIOPS };
}

/**
 * 查找所有满足需求的可行配置
 */
function findFeasibleConfigs(capacityTiB, perfRequirements, networkType, protectionLevel) {
  const configs = [];

  for (let nodes = CONSTANTS.MIN_NODES; nodes <= 100; nodes++) {
    const protection = getProtectionScheme(nodes, protectionLevel);

    for (const nvme of CONSTANTS.NVME_OPTIONS) {
      for (const ssdSize of CONSTANTS.SSD_SIZES_TB) {
        const actualCapacity = calculateCapacity(nodes, nvme, ssdSize, protection.D, protection.P);
        if (actualCapacity < capacityTiB) continue;

        const performance = calculatePerformance(nodes + CONSTANTS.HOT_SPARE, nvme, networkType);

        const perfOk =
          (!perfRequirements.readBW || performance.readBW >= perfRequirements.readBW) &&
          (!perfRequirements.writeBW || performance.writeBW >= perfRequirements.writeBW) &&
          (!perfRequirements.readIOPS || performance.readIOPS >= perfRequirements.readIOPS) &&
          (!perfRequirements.writeIOPS || performance.writeIOPS >= perfRequirements.writeIOPS);

        if (!perfOk) continue;

        configs.push({ nodes, nvme, ssdSize, protection, actualCapacity, performance });
      }
    }
  }

  return configs;
}

/**
 * 从可行配置中选出代表性方案（最多 4 个）
 * 推荐方案排第一（资源最少），其余方案体现不同权衡
 */
function selectRepresentativeConfigs(feasible) {
  if (feasible.length === 0) return [];

  // 按资源升序排列
  feasible.sort((a, b) =>
    a.nodes !== b.nodes ? a.nodes - b.nodes :
    a.nvme !== b.nvme ? a.nvme - b.nvme :
    a.ssdSize - b.ssdSize
  );

  const min = feasible[0];
  const selected = [min];
  const added = new Set([`${min.nodes}-${min.nvme}-${min.ssdSize}`]);

  function tryAdd(candidate) {
    if (!candidate) return;
    const key = `${candidate.nodes}-${candidate.nvme}-${candidate.ssdSize}`;
    if (added.has(key)) return;
    added.add(key);
    selected.push(candidate);
  }

  // 方案 B：同节点数，更多 NVMe（提升性能）
  const nvmeIdx = CONSTANTS.NVME_OPTIONS.indexOf(min.nvme);
  if (nvmeIdx + 1 < CONSTANTS.NVME_OPTIONS.length) {
    tryAdd(feasible.find(c =>
      c.nodes === min.nodes &&
      c.nvme === CONSTANTS.NVME_OPTIONS[nvmeIdx + 1] &&
      c.ssdSize === min.ssdSize
    ));
  }

  // 方案 C：同节点数，更大 SSD（提升容量余量）
  const ssdIdx = CONSTANTS.SSD_SIZES_TB.indexOf(min.ssdSize);
  if (ssdIdx + 1 < CONSTANTS.SSD_SIZES_TB.length) {
    tryAdd(feasible.find(c =>
      c.nodes === min.nodes &&
      c.nvme === min.nvme &&
      c.ssdSize === CONSTANTS.SSD_SIZES_TB[ssdIdx + 1]
    ));
  }

  // 方案 D：更多节点（横向扩展），优先选择触发新保护等级的节点数（EC 5+P → EC 8+P 边界为 10 节点）
  if (selected.length < 4) {
    const moreNodes = feasible.filter(c => c.nodes > min.nodes);
    if (moreNodes.length > 0) {
      // 优先跨保护等级（EC 5+P → EC 8+P）
      const tierChange = moreNodes.find(c => c.protection.D !== min.protection.D);
      tryAdd(tierChange || moreNodes[0]);
    }
  }

  return selected;
}

/**
 * 为每个方案生成优缺点说明
 */
function generateProsAndCons(config, allSelected, capacityTiB) {
  const pros = [];
  const cons = [];

  const recommended = allSelected[0]; // 推荐方案（资源最少）
  const isRecommended = config === recommended;

  const minNodes = Math.min(...allSelected.map(c => c.nodes));
  const maxNodes = Math.max(...allSelected.map(c => c.nodes));
  const maxNvme = Math.max(...allSelected.map(c => c.nvme));
  const minSsd = Math.min(...allSelected.map(c => c.ssdSize));
  const maxSsd = Math.max(...allSelected.map(c => c.ssdSize));

  const headroomPct = Math.round((config.actualCapacity / capacityTiB - 1) * 100);
  const hasMultipleSchemes = allSelected.some(c => c.protection.scheme !== config.protection.scheme);

  // 推荐方案
  if (isRecommended) {
    pros.push('成本最低');
    pros.push('运维简单');
    if (headroomPct < 20) cons.push(`容量余量小（超配${headroomPct}%）`);
    if (minNodes !== maxNodes) cons.push('扩展需增加节点');
  } else if (config.nodes === minNodes) {
    // 同节点数但更多磁盘
    pros.push('机房占用与推荐方案相同');
    cons.push('磁盘更多，成本高于推荐方案');
  } else {
    // 更多节点
    pros.push(`并行度高，单节点故障影响小`);
    cons.push('节点多，采购和机房成本更高');
  }

  // NVMe 数量
  if (config.nvme === maxNvme && !isRecommended) {
    pros.push(`性能翻倍（${config.nvme}盘/节点）`);
  }
  if (config.nvme < maxNvme && !isRecommended) {
    cons.push('性能余量相对有限');
  }

  // SSD 尺寸
  if (config.ssdSize === maxSsd && !isRecommended) {
    pros.push(`容量余量大（超配${headroomPct}%）`);
    pros.push('存储密度高');
    cons.push(`大盘单价较高`);
  } else if (config.ssdSize === minSsd && headroomPct >= 20 && !isRecommended) {
    pros.push(`容量余量充裕（超配${headroomPct}%）`);
  }

  // 保护方案差异
  if (hasMultipleSchemes) {
    if (config.protection.D === 8) {
      pros.push(`存储效率更高（${(config.protection.efficiency * 100).toFixed(1)}%）`);
    } else {
      cons.push(`存储效率较低（${(config.protection.efficiency * 100).toFixed(1)}%）`);
    }
  }

  // 唯一方案时
  if (allSelected.length === 1) {
    pros.push('满足所有容量和性能需求');
    pros.push('配置紧凑，初始投入最优');
  }

  return { pros, cons };
}

/**
 * 主规划函数：返回多个方案数组，第一个为推荐方案
 */
function planWeka(requirements) {
  const capacityInfo = parseCapacity(requirements.capacity);
  const capacityTiB = capacityInfo.tib;

  const networkType = requirements.networkType ? requirements.networkType.toLowerCase() : CONSTANTS.DEFAULT_NETWORK;
  if (!['100gb', '200gb'].includes(networkType)) {
    throw new Error(`不支持的网络类型: ${requirements.networkType}，请使用 100gb 或 200gb`);
  }

  const protectionLevel = requirements.protectionLevel ? parseInt(requirements.protectionLevel) : 2;
  if (![2, 3, 4].includes(protectionLevel)) {
    throw new Error(`无效的保护级别: ${protectionLevel}，请使用 2、3 或 4`);
  }

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
  if (bandwidthUnitPreference === null) bandwidthUnitPreference = false;

  const feasible = findFeasibleConfigs(capacityTiB, perfRequirements, networkType, protectionLevel);
  if (feasible.length === 0) {
    throw new Error('无法找到满足所有需求的配置方案（最大支持 100 节点）');
  }

  const selected = selectRepresentativeConfigs(feasible);

  return selected.map((config, idx) => {
    const { pros, cons } = generateProsAndCons(config, selected, capacityTiB);
    return {
      ...config,
      recommended: idx === 0,
      pros,
      cons,
      networkType,
      protectionLevel,
      capacityUnitPreference: capacityInfo.isBinary,
      bandwidthUnitPreference
    };
  });
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
    case 'TB':  tib = value * CONSTANTS.TB_TO_TIB; break;
    case 'PB':  tib = value * 1000 * CONSTANTS.TB_TO_TIB; break;
    case 'TIB': tib = value; break;
    case 'PIB': tib = value * 1024; break;
    default: throw new Error(`不支持的单位: ${unit}`);
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
    gbps = value * 1.024 / 1000;
  } else if (unitLower === 'gib/s') {
    gbps = value * 1.024;
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
    if (tib >= 1024) return `${(tib / 1024).toFixed(2)} PiB`;
    return `${tib.toFixed(2)} TiB`;
  } else {
    const tb = tib / CONSTANTS.TB_TO_TIB;
    if (tb >= 1000) return `${(tb / 1000).toFixed(2)} PB`;
    return `${tb.toFixed(2)} TB`;
  }
}

/**
 * 格式化带宽输出
 */
function formatBandwidth(gbps, preferBinary = true) {
  if (preferBinary) {
    const gibps = gbps * 1000 / 1024;
    if (gibps >= 1) return `${gibps.toFixed(2)} GiB/s`;
    return `${(gibps * 1024).toFixed(2)} MiB/s`;
  } else {
    if (gbps >= 1) return `${gbps.toFixed(2)} GB/s`;
    return `${(gbps * 1000).toFixed(2)} MB/s`;
  }
}

/**
 * 将单个内部 config 格式化为输出结构
 */
function formatPlan(config) {
  const totalNodes = config.nodes + CONSTANTS.HOT_SPARE;
  return {
    recommended: config.recommended,
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
    pros: config.pros,
    cons: config.cons
  };
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
  --read-bw <带宽>           读带宽需求，如 "200GB/s", "1GiB/s"
  --write-bw <带宽>          写带宽需求，如 "50GB/s", "500MiB/s"
  --read-iops <IOPS>         读 IOPS 需求
  --write-iops <IOPS>        写 IOPS 需求
  --network-type <类型>      网络类型：100gb|200gb（默认 200gb）
  --protection-level <级别>  保护级别：2|3|4（默认 2）
  --json                     以 JSON 格式输出

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
      case '--capacity':          requirements.capacity = args[++i]; break;
      case '--read-bw':           requirements.readBandwidth = args[++i]; break;
      case '--write-bw':          requirements.writeBandwidth = args[++i]; break;
      case '--read-iops':         requirements.readIOPS = args[++i]; break;
      case '--write-iops':        requirements.writeIOPS = args[++i]; break;
      case '--network-type':      requirements.networkType = args[++i]; break;
      case '--protection-level':  requirements.protectionLevel = args[++i]; break;
      case '--json':              jsonOutput = true; break;
    }
  }

  if (!requirements.capacity) {
    console.error('错误: 必须指定 --capacity 参数');
    process.exit(1);
  }

  try {
    const plans = planWeka(requirements);
    const formatted = plans.map(formatPlan);

    if (jsonOutput) {
      console.log(JSON.stringify(formatted, null, 2));
    } else {
      console.log('\n=== Weka 高性能文件系统规划方案 ===\n');
      formatted.forEach((plan, idx) => {
        const label = plan.recommended ? `方案一（推荐）` : `方案${idx + 1}`;
        console.log(`--- ${label} ---`);
        console.log(`节点数: ${plan.configuration.nodeCount} 节点（${plan.configuration.dataNodeCount} 数据 + ${plan.configuration.hotSpareCount} 热备）`);
        console.log(`磁盘: ${plan.configuration.diskConfig}`);
        console.log(`保护: ${plan.configuration.protectionScheme}  效率: ${plan.capacity.efficiency}`);
        console.log(`容量: ${plan.capacity.available}`);
        console.log(`读带宽: ${plan.performance.readBandwidth}  写带宽: ${plan.performance.writeBandwidth}`);
        console.log(`读IOPS: ${plan.performance.readIOPS}  写IOPS: ${plan.performance.writeIOPS}`);
        if (plan.pros.length > 0) console.log(`优点: ${plan.pros.join('；')}`);
        if (plan.cons.length > 0) console.log(`缺点: ${plan.cons.join('；')}`);
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
  planWeka,
  formatPlan,
  parseCapacity,
  parseBandwidth,
  getProtectionScheme,
  calculateCapacity,
  calculatePerformance,
  findFeasibleConfigs,
  selectRepresentativeConfigs,
  generateProsAndCons,
  CONSTANTS
};
