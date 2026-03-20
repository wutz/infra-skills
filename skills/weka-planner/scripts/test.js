#!/usr/bin/env node

/**
 * Weka 规划器测试套件
 */

const {
  planWeka,
  parseCapacity,
  parseBandwidth,
  getProtectionScheme,
  calculateCapacity,
  calculatePerformance,
  CONSTANTS
} = require('./weka-planner.js');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    testsPassed++;
    console.log(`✓ ${message}`);
  } else {
    testsFailed++;
    console.error(`✗ ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  const percentDiff = (diff / expected) * 100;
  if (percentDiff <= tolerance) {
    testsPassed++;
    console.log(`✓ ${message} (实际: ${actual.toFixed(2)}, 期望: ${expected.toFixed(2)}, 误差: ${percentDiff.toFixed(2)}%)`);
  } else {
    testsFailed++;
    console.error(`✗ ${message} (实际: ${actual.toFixed(2)}, 期望: ${expected.toFixed(2)}, 误差: ${percentDiff.toFixed(2)}%)`);
  }
}

console.log('=== Weka 规划器测试 ===\n');

// 测试 1: 容量解析
console.log('测试 1: 容量解析');
try {
  const cap1 = parseCapacity('500TB');
  assert(Math.abs(cap1.tib - 454.5) < 1, '500TB 转换为 TiB');
  assert(cap1.isBinary === false, '500TB 识别为十进制单位');

  const cap2 = parseCapacity('1.5PiB');
  assert(cap2.tib === 1536, '1.5PiB 转换为 TiB');
  assert(cap2.isBinary === true, '1.5PiB 识别为二进制单位');

  const cap3 = parseCapacity('100TiB');
  assert(cap3.tib === 100, '100TiB 保持不变');
} catch (e) {
  console.error(`✗ 容量解析失败: ${e.message}`);
  testsFailed++;
}

// 测试 2: 带宽解析
console.log('\n测试 2: 带宽解析');
try {
  const bw1 = parseBandwidth('100GB/s');
  assert(bw1.gbps === 100, '100GB/s 转换为 GB/s');
  assert(bw1.isBinary === false, '100GB/s 识别为十进制单位');

  const bw2 = parseBandwidth('1GiB/s');
  assertApprox(bw2.gbps, 1.024, 1, '1GiB/s 转换为 GB/s');
  assert(bw2.isBinary === true, '1GiB/s 识别为二进制单位');

  const bw3 = parseBandwidth('500MiB/s');
  assertApprox(bw3.gbps, 0.512, 1, '500MiB/s 转换为 GB/s');
} catch (e) {
  console.error(`✗ 带宽解析失败: ${e.message}`);
  testsFailed++;
}

// 测试 3: 保护方案选择
console.log('\n测试 3: 保护方案选择');
try {
  const p1 = getProtectionScheme(6, 2);
  assert(p1.D === 5 && p1.P === 2, '6 节点 N+2: EC 5+2');
  assert(p1.stripeWidth === 7, '6 节点条带宽度为 7');
  assertApprox(p1.efficiency, 5/7, 0.1, '6 节点效率约 71.4%');

  const p2 = getProtectionScheme(10, 2);
  assert(p2.D === 8 && p2.P === 2, '10 节点 N+2: EC 8+2');
  assert(p2.stripeWidth === 10, '10 节点条带宽度为 10');
  assertApprox(p2.efficiency, 0.8, 0.1, '10 节点效率为 80%');

  const p3 = getProtectionScheme(100, 2);
  assert(p3.D === 8 && p3.P === 4, '100 节点推荐 N+4: EC 8+4');
  assert(p3.stripeWidth === 12, '100 节点条带宽度为 12');
  assertApprox(p3.efficiency, 8/12, 0.1, '100 节点效率约 66.7%');

  const p4 = getProtectionScheme(10, 3);
  assert(p4.D === 8 && p4.P === 3, '10 节点 N+3: EC 8+3');

  const p5 = getProtectionScheme(6, 3);
  assert(p5.D === 5 && p5.P === 3, '6 节点 N+3: EC 5+3（P被限制为3）');
} catch (e) {
  console.error(`✗ 保护方案选择失败: ${e.message}`);
  testsFailed++;
}

// 测试 4: 容量计算
console.log('\n测试 4: 容量计算');
try {
  // 6 节点 × 8 NVMe × 15.36TB × 0.909 × (5/7) × 0.9
  const cap1 = calculateCapacity(6, 8, 15.36, 5, 2);
  assertApprox(cap1, 430.8, 1, '6 节点 8×15.36TB EC 5+2 容量');

  // 10 节点 × 12 NVMe × 7.68TB × 0.909 × (8/10) × 0.9
  const cap2 = calculateCapacity(10, 12, 7.68, 8, 2);
  assertApprox(cap2, 603.2, 1, '10 节点 12×7.68TB EC 8+2 容量');

  // 6 节点 × 4 NVMe × 7.68TB × 0.909 × (5/7) × 0.9
  const cap3 = calculateCapacity(6, 4, 7.68, 5, 2);
  assertApprox(cap3, 107.7, 1, '6 节点 4×7.68TB EC 5+2 容量');
} catch (e) {
  console.error(`✗ 容量计算失败: ${e.message}`);
  testsFailed++;
}

// 测试 5: 性能计算（验证文档数据）
console.log('\n测试 5: 性能计算（验证文档数据）');
try {
  // 6 节点，100Gb×2，8 NVMe
  const perf1 = calculatePerformance(6, 8, '100gb');
  assertApprox(perf1.writeBW, 31.8, 5, '6 节点 8 NVMe 写带宽 (文档: 31.9 GB/s)');
  assertApprox(perf1.writeIOPS, 1296000, 1, '6 节点 8 NVMe 写 IOPS (文档: 1,296,000)');
  assertApprox(perf1.readIOPS, 10800000, 1, '6 节点 8 NVMe 读 IOPS (文档: 10,800,000)');
  assertApprox(perf1.readBW, 135, 5, '6 节点 8 NVMe 100Gb 读带宽 (文档: 135.0 GB/s)');

  // 6 节点，200Gb×2，8 NVMe
  const perf2 = calculatePerformance(6, 8, '200gb');
  assertApprox(perf2.readBW, 208.6, 5, '6 节点 8 NVMe 200Gb 读带宽 (文档: 208.7 GB/s)');

  // 6 节点，100Gb×2，4 NVMe
  const perf3 = calculatePerformance(6, 4, '100gb');
  assertApprox(perf3.writeBW, 15.9, 5, '6 节点 4 NVMe 写带宽 (文档: 15.9 GB/s)');
  assertApprox(perf3.writeIOPS, 648000, 1, '6 节点 4 NVMe 写 IOPS (文档: 648,000)');
  assertApprox(perf3.readIOPS, 5400000, 1, '6 节点 4 NVMe 读 IOPS (文档: 5,400,000)');
  assertApprox(perf3.readBW, 104.3, 5, '6 节点 4 NVMe 读带宽 (文档: 104.3 GB/s)');

  // 6 节点，200Gb×2，12 NVMe
  const perf4 = calculatePerformance(6, 12, '200gb');
  assertApprox(perf4.writeBW, 47.7, 5, '6 节点 12 NVMe 写带宽 (文档: 47.8 GB/s)');
  assertApprox(perf4.readBW, 270, 5, '6 节点 12 NVMe 200Gb 读带宽 (文档: 270.0 GB/s)');

  // 8 节点，100Gb×2，8 NVMe
  const perf5 = calculatePerformance(8, 8, '100gb');
  assertApprox(perf5.readBW, 180, 5, '8 节点 8 NVMe 100Gb 读带宽 (文档: 180.0 GB/s)');
  assertApprox(perf5.readIOPS, 14400000, 1, '8 节点 8 NVMe 读 IOPS (文档: 14,400,000)');
} catch (e) {
  console.error(`✗ 性能计算失败: ${e.message}`);
  testsFailed++;
}

// 测试 6: 网络瓶颈验证
console.log('\n测试 6: 网络瓶颈验证');
try {
  // 6 节点 × 12 NVMe，100Gb 网络应该触发瓶颈
  const perf1 = calculatePerformance(6, 12, '100gb');
  const theoretical1 = 6 * 12 * CONSTANTS.READ_BW_PER_NVME_NODE;
  const networkCap1 = 6 * CONSTANTS.NETWORK_BW_100GB;
  assert(perf1.readBW === Math.min(theoretical1, networkCap1), '100Gb 网络瓶颈生效');
  assert(perf1.readBW < theoretical1, '读带宽受 100Gb 网络限制');

  // 6 节点 × 4 NVMe，200Gb 网络不应触发瓶颈
  const perf2 = calculatePerformance(6, 4, '200gb');
  const theoretical2 = 6 * 4 * CONSTANTS.READ_BW_PER_NVME_NODE;
  const networkCap2 = 6 * CONSTANTS.NETWORK_BW_200GB;
  assert(perf2.readBW === Math.min(theoretical2, networkCap2), '200Gb 网络容量充足');
  assert(perf2.readBW === theoretical2, '读带宽未受 200Gb 网络限制');
} catch (e) {
  console.error(`✗ 网络瓶颈验证失败: ${e.message}`);
  testsFailed++;
}

// 测试 7: 完整规划场景
console.log('\n测试 7: 完整规划场景');
try {
  // 场景 1: 仅容量需求
  const plan1 = planWeka({ capacity: '100TiB' });
  assert(plan1.nodes >= CONSTANTS.MIN_NODES, '满足最小节点数要求');
  assert(plan1.actualCapacity >= 100, '满足容量需求');
  assert(CONSTANTS.NVME_OPTIONS.includes(plan1.nvme), 'NVMe 数量在可选范围内');
  assert(CONSTANTS.SSD_SIZES_TB.includes(plan1.ssdSize), 'SSD 容量在可选范围内');

  // 场景 2: 容量 + 性能需求
  const plan2 = planWeka({
  capacity: '500TiB',
    readBandwidth: '200GB/s',
    networkType: '200gb'
  });
  assert(plan2.actualCapacity >= 454.5, '满足 500TiB 容量需求');
  assert(plan2.performance.readBW >= 200, '满足 200GB/s 读带宽需求');
  assert(plan2.networkType === '200gb', '使用 200Gb 网络');
  // 场景 3: 高性能需求
  const plan3 = planWeka({
    capacity: '100TiB',
    readIOPS: '10000000',
    writeIOPS: '1000000'
  });
  assert(plan3.performance.readIOPS >= 10000, '满足读 IOPS 需求');
  assert(plan3.performance.writeIOPS >= 1000000, '满足写 IOPS 需求');
  // 场景 4: 高保护级别
  const plan4 = planWeka({
    capacity: '200TiB',
    protectionLevel: '3'
  });
  assert(plan4.protection.P === 3, '使用 N+3 保护级别');
} catch (e) {
  console.error(`✗ 完整规划场景失败: ${e.message}`);
  testsFailed++;
}

// 测试 8: 边界条件
console.log('\n测试 8: 边界条件');
try {
  // 最小配置
  const plan1 = planWeka({ capacity: '50TiB' });
  assert(plan1.nodes === CONSTANTS.MIN_NODES, '最小节点数为 6');
  assert(plan1.nvme === 4, '最小 NVMe 数为 4');
  assert(plan1.ssdSize === 7.68, '优先选择最小 SSD');

  // 大容量需求
  const plan2 = planWeka({ capacity: '2PiB' });
  assert(plan2.actualCapacity >= 2048, '满足 2PiB 容量需求');
  assert(plan2.nodes <= 100, '节点数不超过 100');
} catch (e) {
  console.error(`✗ 边界条件测试失败: ${e.message}`);
  testsFailed++;
}
// 测试 9: 错误处理
console.log('\n测试 9: 错误处理');
try {
  let errorCaught = false;
  try {
    parseCapacity('invalid');
  } catch (e) {
    errorCaught = true;
  }
  assert(errorCaught, '无效容量格式抛出错误');

  errorCaught = false;
  try {
    parseBandwidth('100XB/s');
  } catch (e) {
    errorCaught = true;
  }
  assert(errorCaught, '无效带宽格式抛出错误');

  errorCaught = false;
  try {
    planWeka({ capacity: '100TiB', networkType: 'invalid' });
  } catch (e) {
    errorCaught = true;
  }
  assert(errorCaught, '无效网络类型抛出错误');

  errorCaught = false;
  try {
    planWeka({ capacity: '100TiB', protectionLevel: '5' });
  } catch (e) {
    errorCaught = true;
  }
  assert(errorCaught, '无效保护级别抛出错误');
} catch (e) {
  console.error(`✗ 错误处理测试失败: ${e.message}`);
  testsFailed++;
}

// 测试 10: 成本优化验证
console.log('\n测试 10: 成本优化验证');
try {
  // 验证选择最小配置
  const plan1 = planWeka({ capacity: '200TiB' });

  // 手动验证是否存在更小的配置也能满足需求
  let foundSmaller = false;
  for (let nodes = CONSTANTS.MIN_NODES; nodes < plan1.nodes; nodes++) {
    const protection = getProtectionScheme(nodes, 2);
    for (const nvme of CONSTANTS.NVME_OPTIONS) {
      for (const ssdSize of CONSTANTS.SSD_SIZES_TB) {
        const cap = calculateCapacity(nodes, nvme, ssdSize, protection.D, protection.P);
        if (cap >= 200) {
       foundSmaller = true;
          break;
        }
      }
      if (foundSmaller) break;
    }
    if (foundSmaller) break;
  }

  assert(!foundSmaller, '选择了最小节点数配置');
} catch (e) {
  console.error(`✗ 成本优化验证失败: ${e.message}`);
  testsFailed++;
}

// 总结
console.log('\n=== 测试总结 ===');
console.log(`通过: ${testsPassed}`);
console.log(`失败: ${testsFailed}`);
console.log(`总计: ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log('\n✓ 所有测试通过！');
  process.exit(0);
} else {
  console.log(`\n✗ ${testsFailed} 个测试失败`);
  process.exit(1);
}
