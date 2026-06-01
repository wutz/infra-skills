#!/usr/bin/env node

const { planXEOS, formatResult, getEcScheme } = require('./xsky-xeos-planner.js');

const testCases = [
  {
    name: '10TiB 容量需求 (3节点 → EC4+2:1)',
    input: { capacity: '10TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2:1', diskSize: 8 }
  },
  {
    name: '400TiB 容量需求 (3节点 → EC4+2:1)',
    input: { capacity: '400TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2:1', diskSize: 10 }
  },
  {
    name: '700TiB 容量需求 (3节点 → EC4+2:1)',
    input: { capacity: '700TiB' },
    expected: { servers: 3, ecScheme: 'EC4+2:1', diskSize: 16 }
  },
  {
    name: '1200TiB 容量需求 (4节点 → EC4+2:1)',
    input: { capacity: '1200TiB' },
    expected: { servers: 4, ecScheme: 'EC4+2:1', diskSize: 20 }
  },
  {
    name: '1600TiB 容量需求 (5节点 → EC8+2:1)',
    input: { capacity: '1600TiB' },
    expected: { servers: 5, ecScheme: 'EC8+2:1', diskSize: 18 }
  },
  {
    name: '2200TiB 容量需求 (5节点 → EC8+2:1)',
    input: { capacity: '2200TiB' },
    expected: { servers: 5, ecScheme: 'EC8+2:1', diskSize: 24 }
  },
  {
    name: '2300TiB 容量需求 (7节点 → EC4+2)',
    input: { capacity: '2300TiB' },
    expected: { servers: 7, ecScheme: 'EC4+2', diskSize: 22 }
  },
  {
    name: '5000TiB 容量需求 (10+节点 → EC8+2)',
    input: { capacity: '5000TiB' },
    expected: { ecScheme: 'EC8+2' }
  },
  {
    name: '10TiB + 1000MiB/s 上传带宽',
    input: { capacity: '10TiB', uploadBandwidth: '1000MiB/s' },
    expected: { servers: 3, ecScheme: 'EC4+2:1', diskSize: 8 }
  },
  {
    name: '10TiB + 3000MiB/s 上传带宽 (4节点 → EC4+2:1)',
    input: { capacity: '10TiB', uploadBandwidth: '3000MiB/s' },
    expected: { servers: 4, ecScheme: 'EC4+2:1', diskSize: 8 }
  },
  {
    name: '10TiB + 4500MiB/s 上传带宽 (5节点 → EC8+2:1)',
    input: { capacity: '10TiB', uploadBandwidth: '4500MiB/s' },
    expected: { servers: 5, ecScheme: 'EC8+2:1', diskSize: 8 }
  },
  {
    name: '1600TiB + 4500MiB/s 上传带宽 (5节点 → EC8+2:1)',
    input: { capacity: '1600TiB', uploadBandwidth: '4500MiB/s' },
    expected: { servers: 5, ecScheme: 'EC8+2:1', diskSize: 18 }
  },
  {
    name: '700TiB + 1000MiB/s 上传带宽 (3节点 → EC4+2:1)',
    input: { capacity: '700TiB', uploadBandwidth: '1000MiB/s' },
    expected: { servers: 3, ecScheme: 'EC4+2:1', diskSize: 16 }
  },
  {
    name: 'EC 方案选择: 3节点',
    input: null,
    testFn: () => {
      const ec = getEcScheme(3);
      return ec.scheme === 'EC4+2:1' && ec.tolerance === 1;
    }
  },
  {
    name: 'EC 方案选择: 5节点',
    input: null,
    testFn: () => {
      const ec = getEcScheme(5);
      return ec.scheme === 'EC8+2:1' && ec.tolerance === 1;
    }
  },
  {
    name: 'EC 方案选择: 7节点',
    input: null,
    testFn: () => {
      const ec = getEcScheme(7);
      return ec.scheme === 'EC4+2' && ec.tolerance === 2;
    }
  },
  {
    name: 'EC 方案选择: 10节点',
    input: null,
    testFn: () => {
      const ec = getEcScheme(10);
      return ec.scheme === 'EC8+2' && ec.tolerance === 2;
    }
  },
  {
    name: '带宽输出默认使用 Mbps/Gbps',
    input: { capacity: '10TiB' },
    testFn: (result) => {
      const formatted = formatResult(result);
      return formatted.performance.uploadBandwidth.includes('Gbps') ||
             formatted.performance.uploadBandwidth.includes('Mbps');
    }
  },
  {
    name: 'OPS 输出无 IOPS 单位',
    input: { capacity: '10TiB' },
    testFn: (result) => {
      const formatted = formatResult(result);
      return !formatted.performance.uploadOps.includes('IOPS') &&
             formatted.performance.uploadOps.includes('(4KiB)');
    }
  },
  {
    name: '带宽输出带 (4MiB) 标识',
    input: { capacity: '10TiB' },
    testFn: (result) => {
      const formatted = formatResult(result);
      return formatted.performance.uploadBandwidth.includes('(4MiB)') &&
             formatted.performance.downloadBandwidth.includes('(4MiB)');
    }
  }
];

function runTests() {
  console.log('开始运行测试用例...\n');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.name}`);

    try {
      if (testCase.testFn && !testCase.input) {
        // Pure function test
        if (testCase.testFn()) {
          console.log(`  ✓ 通过`);
          passed++;
        } else {
          console.log(`  ✗ 失败`);
          failed++;
        }
      } else if (testCase.testFn && testCase.input) {
        // Result-based function test
        console.log(`  输入: ${JSON.stringify(testCase.input)}`);
        const result = planXEOS(testCase.input);
        if (testCase.testFn(result)) {
          console.log(`  ✓ 通过`);
          passed++;
        } else {
          console.log(`  ✗ 失败`);
          const formatted = formatResult(result);
          console.log(`    实际输出: ${JSON.stringify(formatted.performance, null, 2)}`);
          failed++;
        }
      } else {
        console.log(`  输入: ${JSON.stringify(testCase.input)}`);
        const result = planXEOS(testCase.input);
        const { serverCount, ecScheme, diskSize } = result;

        let match = true;
        if (testCase.expected.servers !== undefined) match = match && serverCount === testCase.expected.servers;
        if (testCase.expected.ecScheme !== undefined) match = match && ecScheme === testCase.expected.ecScheme;
        if (testCase.expected.diskSize !== undefined) match = match && diskSize === testCase.expected.diskSize;

        if (match) {
          console.log(`  ✓ 通过`);
          console.log(`    结果: ${serverCount} 台, ${ecScheme}, HDD ${diskSize}TB`);
          passed++;
        } else {
          console.log(`  ✗ 失败`);
          if (testCase.expected.servers !== undefined) {
            console.log(`    期望: ${testCase.expected.servers} 台, ${testCase.expected.ecScheme}, HDD ${testCase.expected.diskSize}TB`);
          } else {
            console.log(`    期望 EC: ${testCase.expected.ecScheme}`);
          }
          console.log(`    实际: ${serverCount} 台, ${ecScheme}, HDD ${diskSize}TB`);
          failed++;
        }
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

runTests();
