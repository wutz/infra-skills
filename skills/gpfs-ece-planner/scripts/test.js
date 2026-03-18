#!/usr/bin/env node

/**
 * GPFS ECE 规划工具测试用例
 */

const { planGPFSECE, formatResult } = require('./gpfs-ece-planner.js');

// 测试用例定义
const testCases = [
  {
    name: '小容量 50TiB',
    input: { capacity: '50TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 1.92 }
  },
  {
    name: '中容量 100TiB',
    input: { capacity: '100TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 3.84 }
  },
  {
    name: '触发 7.68TB SSD',
    input: { capacity: '300TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 7.68 }
  },
  {
    name: '大容量 3 台极限',
    input: { capacity: '500TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 15.36 }
  },
  {
    name: '跨越 4 台 EC8+3P',
    input: { capacity: '610TiB' },
    expected: { servers: 4, ecScheme: 'EC8+3P', ssdSize: 15.36 }
  },
  {
    name: '跨越 5 台 EC8+2P',
    input: { capacity: '1000TiB' },
    expected: { servers: 5, ecScheme: 'EC8+2P', ssdSize: 15.36 }
  },
  {
    name: '1PiB 二进制单位',
    input: { capacity: '1PiB' },
    expected: { servers: 5, ecScheme: 'EC8+2P', ssdSize: 15.36 }
  },
  {
    name: '十进制单位 500TB',
    input: { capacity: '500TB' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 15.36 }
  },
  {
    name: '性能驱动增台 (read-bw 200GB/s)',
    input: { capacity: '100TiB', readBandwidth: '200GB/s' },
    expected: { servers: 4, ecScheme: 'EC8+3P', ssdSize: 1.92 }
  },
  {
    name: 'ft=2 容错要求',
    input: { capacity: '100TiB', faultTolerance: '2' },
    expected: { servers: 10, ecScheme: 'EC8+2P', ssdSize: 1.92 }
  },
  {
    name: 'ft=3 强制 EC8+3P',
    input: { capacity: '100TiB', faultTolerance: '3' },
    expected: { servers: 11, ecScheme: 'EC8+3P', ssdSize: 1.92 }
  },
  {
    name: '以太网 (容量不变、性能降低)',
    input: { capacity: '100TiB', networkType: 'ethernet' },
    expected: { servers: 3, ecScheme: 'EC4+2P', ssdSize: 3.84 }
  },
  {
    name: '以太网 + 性能 (30% 惩罚)',
    input: { capacity: '100TiB', readBandwidth: '200GB/s', networkType: 'ethernet' },
    expected: { servers: 15, ecScheme: 'EC8+2P', ssdSize: 1.92 }
  },
  {
    name: '写带宽 100GB/s',
    input: { capacity: '100TiB', writeBandwidth: '100GB/s' },
    expected: { servers: 5, ecScheme: 'EC8+2P', ssdSize: 1.92 }
  },
  {
    name: '读 IOPS 1000000',
    input: { capacity: '100TiB', readIOPS: '1000000' },
    expected: { servers: 5, ecScheme: 'EC8+2P', ssdSize: 1.92 }
  }
];

// 运行测试
function runTests() {
  console.log('开始运行 GPFS ECE 规划工具测试用例...\n');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.name}`);
    console.log(`  输入: ${JSON.stringify(testCase.input)}`);

    try {
      const result = planGPFSECE(testCase.input);
      const { serverCount, ecScheme, ssdSize } = result;

      const match =
        serverCount === testCase.expected.servers &&
        ecScheme === testCase.expected.ecScheme &&
        ssdSize === testCase.expected.ssdSize;

      if (match) {
        console.log(`  ✓ 通过`);
        console.log(`    结果: ${serverCount} 台, ${ecScheme}, SSD ${ssdSize}TB`);
        passed++;
      } else {
        console.log(`  ✗ 失败`);
        console.log(`    期望: ${testCase.expected.servers} 台, ${testCase.expected.ecScheme}, SSD ${testCase.expected.ssdSize}TB`);
        console.log(`    实际: ${serverCount} 台, ${ecScheme}, SSD ${ssdSize}TB`);
        failed++;
      }
    } catch (error) {
      console.log(`  ✗ 错误: ${error.message}`);
      failed++;
    }

    console.log();
  });

  console.log('='.repeat(50));
  console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

// 运行测试
runTests();
