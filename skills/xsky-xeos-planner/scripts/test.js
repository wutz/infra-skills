#!/usr/bin/env node

/**
 * XSKY XEOS 规划工具测试用例
 */

const { planXEOS, formatResult } = require('./xsky-xeos-planner.js');

// 测试用例定义
const testCases = [
  {
    name: '10TiB 容量需求',
    input: { capacity: '10TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2', diskSize: 8 }
  },
  {
    name: '400TiB 容量需求',
    input: { capacity: '400TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2', diskSize: 10 }
  },
  {
    name: '700TiB 容量需求',
    input: { capacity: '700TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2', diskSize: 16 }
  },
  {
    name: '1200TiB 容量需求',
    input: { capacity: '1200TiB' },
    expected: { servers: 4, ecScheme: 'EC4+2', diskSize: 20 }
  },
  {
    name: '1600TiB 容量需求',
    input: { capacity: '1600TiB' },
    expected: { servers: 5, ecScheme: 'EC8+2', diskSize: 18 }
  },
  {
    name: '2200TiB 容量需求',
    input: { capacity: '2200TiB' },
    expected: { servers: 5, ecScheme: 'EC8+2', diskSize: 24 }
  },
  {
    name: '2300TiB 容量需求',
    input: { capacity: '2300TiB' },
    expected: { servers: 6, ecScheme: 'EC8+2', diskSize: 22 }
  },
  {
    name: '10TiB + 1000MiB/s 上传带宽',
    input: { capacity: '10TiB', uploadBandwidth: '1000MiB/s' },
    expected: { servers: 3, ecScheme: 'EC4+2', diskSize: 8 }
  },
  {
    name: '10TiB + 3000MiB/s 上传带宽',
    input: { capacity: '10TiB', uploadBandwidth: '3000MiB/s' },
    expected: { servers: 4, ecScheme: 'EC4+2', diskSize: 8 }
  },
  {
    name: '10TiB + 4500MiB/s 上传带宽',
    input: { capacity: '10TiB', uploadBandwidth: '4500MiB/s' },
    expected: { servers: 5, ecScheme: 'EC8+2', diskSize: 8 }
  },
  {
    name: '1600TiB + 4500MiB/s 上传带宽',
    input: { capacity: '1600TiB', uploadBandwidth: '4500MiB/s' },
    expected: { servers: 5, ecScheme: 'EC8+2', diskSize: 18 }
  },
  {
    name: '700TiB + 1000MiB/s 上传带宽',
    input: { capacity: '700TiB', uploadBandwidth: '1000MiB/s' },
    expected: { servers: 3, ecScheme: 'EC4+2', diskSize: 16 }
  }
];

// 运行测试
function runTests() {
  console.log('开始运行测试用例...\n');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.name}`);
    console.log(`  输入: ${JSON.stringify(testCase.input)}`);

    try {
      const result = planXEOS(testCase.input);
      const { serverCount, ecScheme, diskSize } = result;

      const match =
        serverCount === testCase.expected.servers &&
        ecScheme === testCase.expected.ecScheme &&
        diskSize === testCase.expected.diskSize;

      if (match) {
        console.log(`  ✓ 通过`);
        console.log(`    结果: ${serverCount} 台, ${ecScheme}, HDD ${diskSize}TB`);
        passed++;
      } else {
        console.log(`  ✗ 失败`);
        console.log(`    期望: ${testCase.expected.servers} 台, ${testCase.expected.ecScheme}, HDD ${testCase.expected.diskSize}TB`);
        console.log(`    实际: ${serverCount} 台, ${ecScheme}, HDD ${diskSize}TB`);
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
