#!/usr/bin/env node

/**
 * Weka 高性能文件系统容量和性能规划计算器
 * 根据容量和性能需求计算 Weka 集群配置方案（输出多个方案）
 */

// 常量配置
const CONSTANTS = {
  MIN_TOTAL_NODES: 6,          // 最小总节点数（数据节点+热备节点）
  NVME_OPTIONS: [12],
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

  // 网络带宽限制 (每节点，基于文档参考数据)
  NETWORK_BW_100GB: 22.5,            // GB/s per node (100Gb×2)
  NETWORK_BW_200GB: 45.0,            // GB/s per node (200Gb×2)
};

/**
 * 根据节点数和保护级别确定保护方案
 */
function getProtectionScheme(nodeCount, protectionLevel = 2) {
  let P;

  if (nodeCount >= 100) {
    P = 4;
  } else {
    P = Math.min(protectionLevel, nodeCount < 10 ? 2 : protectionLevel);
  }

  // 在满足约束条件下最大化条带宽度：D+P ≤ nodeCount, D+P ≤ 20, D > P
  const D = Math.min(nodeCount - P, 20 - P);

  if (D <= P) {
    throw new Error(`数据块 (D=${D}) 必须大于校验块 (P=${P})，节点数不足`);
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

  const minDataNodes = CONSTANTS.MIN_TOTAL_NODES - CONSTANTS.HOT_SPARE;
  for (let nodes = minDataNodes; ; nodes++) {
    const protection = getProtectionScheme(nodes, protectionLevel);

    // 保护方案条带宽度不能超过数据节点数
    if (protection.D + protection.P > nodes) continue;

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

        const rawCapacity = nodes * nvme * ssdSize * CONSTANTS.TB_TO_TIB;
        configs.push({ nodes, nvme, ssdSize, protection, actualCapacity, rawCapacity, performance });
      }
    }

    // 找到满足需求的最小节点数后停止搜索
    if (configs.length > 0) return configs;
  }
}

/**
 * 从可行配置中选出方案（最小节点数，不同磁盘规格）：
 * - cost: 推荐（最少节点 + 最小磁盘）
 * - capacity: 容量升级（同节点数，更大磁盘）
 */
function selectRepresentativeConfigs(feasible) {
  if (feasible.length === 0) return [];

  // 按资源升序排列：节点数 → NVMe数 → 磁盘大小
  feasible.sort((a, b) =>
    a.nodes !== b.nodes ? a.nodes - b.nodes :
    a.nvme !== b.nvme ? a.nvme - b.nvme :
    a.ssdSize - b.ssdSize
  );

  const selected = [];
  const seen = new Set();

  function addConfig(config, role) {
    if (!config) return;
    const key = `${config.nodes}-${config.nvme}-${config.ssdSize}`;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push({ ...config, role });
  }

  // cost: 第一个可行配置（最少节点 + 最小磁盘）
  const cost = feasible[0];
  addConfig(cost, 'cost');

  // capacity: 同节点数，更大磁盘（7.68→15.36）
  const capacity = feasible.find(c =>
    c.nodes === cost.nodes && c.nvme === cost.nvme && c.ssdSize > cost.ssdSize
  );
  addConfig(capacity, 'capacity');

  return selected;
}

/**
 * 基于角色生成优缺点说明
 */
function generateProsAndCons(config, role, capacityTiB) {
  const pros = [];
  const cons = [];
  const headroomPct = Math.round((config.actualCapacity / capacityTiB - 1) * 100);

  switch (role) {
    case 'cost':
      pros.push('成本最低，初始投入最小');
      pros.push('运维简单');
      if (headroomPct < 20) cons.push(`容量余量小（超配${headroomPct}%）`);
      break;

    case 'capacity':
      pros.push('机房占用与推荐方案相同');
      pros.push(`容量余量大（超配${headroomPct}%）`);
      pros.push('存储密度高');
      cons.push('大盘单价较高');
      break;
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
    throw new Error('无法找到满足所有需求的配置方案');
  }

  const selected = selectRepresentativeConfigs(feasible);

  return selected.map((config, idx) => {
    const { pros, cons } = generateProsAndCons(config, config.role, capacityTiB);
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
    role: config.role,
    configuration: {
      nodeCount: totalNodes,
      dataNodeCount: config.nodes,
      hotSpareCount: CONSTANTS.HOT_SPARE,
      cpuModel: 'Intel 5418Y',
      memory: '32GB DDR4 × 12',
      nvmePerNode: config.nvme,
      ssdSize: `${config.ssdSize}TB`,
      networkType: config.networkType === '100gb' ? '2×100Gb × 2' : '2×200Gb × 2',
      protectionScheme: config.protection.scheme,
      diskConfig: `每节点 ${config.nvme} × ${config.ssdSize}TB NVMe SSD`
    },
    capacity: {
      available: formatCapacity(config.actualCapacity, config.capacityUnitPreference),
      raw: formatCapacity(config.rawCapacity, config.capacityUnitPreference),
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

每节点固定 12 × NVMe SSD（7.68TB 或 15.36TB），最少 6 节点，默认 1 热备节点，无节点上限

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
      console.log('# Weka 存储规划报告\n');

      // 需求摘要
      console.log('## 需求摘要');
      console.log(`  - 可用容量 ≥ ${requirements.capacity}`);
      if (requirements.readBandwidth)  console.log(`  - 读带宽 ≥ ${requirements.readBandwidth}`);
      if (requirements.writeBandwidth) console.log(`  - 写带宽 ≥ ${requirements.writeBandwidth}`);
      if (requirements.readIOPS)       console.log(`  - 读 IOPS ≥ ${parseInt(requirements.readIOPS).toLocaleString()}`);
      if (requirements.writeIOPS)      console.log(`  - 写 IOPS ≥ ${parseInt(requirements.writeIOPS).toLocaleString()}`);
      console.log();

      // 通用硬件配置（从第一个方案取，所有方案相同）
      const commonConfig = formatted[0].configuration;
      console.log('## 通用硬件配置\n');
      console.log(`| 项目 | 配置 |`);
      console.log(`| --- | --- |`);
      console.log(`| CPU | ${commonConfig.cpuModel} |`);
      console.log(`| 内存 | ${commonConfig.memory} |`);
      console.log(`| 网络 | ${commonConfig.networkType} |`);
      console.log(`| 热备节点 | ${commonConfig.hotSpareCount} |`);
      console.log();

      console.log('## 硬件方案对比\n');

      const roleLabels = {
        cost: '★ 推荐',
        capacity: '容量升级',
      };

      const headers = ['方案', '节点数', '磁盘配置', '保护方案', '可用容量', '裸容量', '读带宽', '写带宽', '读 IOPS', '写 IOPS'];
      const rows = formatted.map((plan, idx) => {
        const c = plan.configuration;
        const label = `方案${idx + 1} ${roleLabels[plan.role] || ''}`;
        return [
          label,
          `${c.nodeCount}（${c.dataNodeCount}数据+${c.hotSpareCount}热备）`,
          `${c.nvmePerNode} × ${c.ssdSize}`,
       c.protectionScheme,
          plan.capacity.available,
          plan.capacity.raw,
          plan.performance.readBandwidth,
          plan.performance.writeBandwidth,
          plan.performance.readIOPS.replace(' IOPS', ''),
          plan.performance.writeIOPS.replace(' IOPS', '')
        ];
      });

      const sep = headers.map(() => '---');
      console.log('| ' + headers.join(' | ') + ' |');
      console.log('| ' + sep.join(' | ') + ' |');
      rows.forEach(r => console.log('| ' + r.join(' | ') + ' |'));
      console.log();

      // 方案说明独立成节
      console.log('### 方案说明\n');
      formatted.forEach((plan, idx) => {
        const label = `方案${idx + 1} ${roleLabels[plan.role] || ''}`;
        console.log(`**${label}**`);
        if (plan.pros.length > 0) console.log(`- 优点：${plan.pros.join('；')}`);
        if (plan.cons.length > 0) console.log(`- 缺点：${plan.cons.join('；')}`);
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
