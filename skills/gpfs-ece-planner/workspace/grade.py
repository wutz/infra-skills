#!/usr/bin/env python3
import json
import sys
import re

def grade_eval_1(output_text):
    results = []

    # Check multiple solutions
    match = re.search(r'共找到 (\d+) 个满足需求的方案', output_text)
    solution_count = int(match.group(1)) if match else 0
    results.append({
        "text": "multiple_solutions",
        "passed": solution_count >= 2,
        "evidence": f"找到 {solution_count} 个方案"
    })

    # Check recommended marked
    has_recommended = '【推荐】' in output_text
    results.append({
        "text": "recommended_marked",
        "passed": has_recommended,
        "evidence": "找到推荐标记" if has_recommended else "未找到推荐标记"
    })

    # Check capacity satisfied (all >= 1 PiB)
    capacities = re.findall(r'可用容量: ([\d.]+) PiB', output_text)
    all_satisfied = all(float(c) >= 1.0 for c in capacities)
    results.append({
        "text": "capacity_satisfied",
        "passed": all_satisfied,
        "evidence": f"容量: {', '.join(capacities)} PiB"
    })

    # Check performance included
    has_perf = '读带宽:' in output_text and '写带宽:' in output_text and 'IOPS' in output_text
    results.append({
        "text": "performance_included",
        "passed": has_perf,
        "evidence": "包含完整性能指标" if has_perf else "缺少性能指标"
    })

    # Check config details
    has_config = '服务器台数:' in output_text and '纠删码方案:' in output_text and '磁盘配置:' in output_text
    results.append({
        "text": "config_details",
        "passed": has_config,
        "evidence": "包含完整配置信息" if has_config else "缺少配置信息"
    })

    return results

def grade_eval_2(output_text):
    results = []

    # Multiple solutions
    match = re.search(r'共找到 (\d+) 个满足需求的方案', output_text)
    solution_count = int(match.group(1)) if match else 0
    results.append({
        "text": "multiple_solutions",
        "passed": solution_count >= 2,
        "evidence": f"找到 {solution_count} 个方案"
    })

    # Capacity satisfied
    capacities = re.findall(r'可用容量: ([\d.]+) TiB', output_text)
    all_satisfied = all(float(c) >= 500 for c in capacities)
    results.append({
        "text": "capacity_satisfied",
        "passed": all_satisfied,
        "evidence": f"容量: {', '.join(capacities)} TiB"
    })

    # Performance satisfied (>= 150 GB/s)
    read_bws = re.findall(r'读带宽: ([\d.]+) GB/s', output_text)
    perf_satisfied = all(float(bw) >= 150 for bw in read_bws)
    results.append({
        "text": "performance_satisfied",
        "passed": perf_satisfied,
        "evidence": f"读带宽: {', '.join(read_bws)} GB/s"
    })

    # Recommended marked
    has_recommended = '【推荐】' in output_text
    results.append({
        "text": "recommended_marked",
        "passed": has_recommended,
        "evidence": "找到推荐标记" if has_recommended else "未找到推荐标记"
    })

    # Performance comparison
    has_comparison = len(read_bws) > 1
    results.append({
        "text": "performance_comparison",
        "passed": has_comparison,
        "evidence": f"可以对比 {len(read_bws)} 个方案的性能"
    })

    return results

def grade_eval_3(output_text):
    results = []

    # Multiple solutions
    match = re.search(r'共找到 (\d+) 个满足需求的方案', output_text)
    solution_count = int(match.group(1)) if match else 0
    results.append({
        "text": "multiple_solutions",
        "passed": solution_count >= 2,
        "evidence": f"找到 {solution_count} 个方案"
    })

    # Capacity satisfied
    capacities = re.findall(r'可用容量: ([\d.]+) PiB', output_text)
    all_satisfied = all(float(c) >= 2.0 for c in capacities)
    results.append({
        "text": "capacity_satisfied",
        "passed": all_satisfied,
        "evidence": f"容量: {', '.join(capacities)} PiB"
    })

    # Min servers ft=2
    server_counts = re.findall(r'服务器台数: (\d+) 台', output_text)
    min_servers_ok = all(int(s) >= 10 for s in server_counts)
    results.append({
        "text": "min_servers_ft2",
        "passed": min_servers_ok,
        "evidence": f"服务器台数: {', '.join(server_counts)}"
    })

    # Recommended marked
    has_recommended = '【推荐】' in output_text
    results.append({
        "text": "recommended_marked",
        "passed": has_recommended,
        "evidence": "找到推荐标记" if has_recommended else "未找到推荐标记"
    })

    # EC scheme shown
    has_ec = 'EC8+2P' in output_text
    results.append({
        "text": "ec_scheme_shown",
        "passed": has_ec,
        "evidence": "显示 EC8+2P" if has_ec else "未显示正确的 EC 方案"
    })

    return results

if __name__ == '__main__':
    eval_id = sys.argv[1]
    output_file = sys.argv[2]

    with open(output_file, 'r') as f:
        output_text = f.read()

    if eval_id == '1':
        results = grade_eval_1(output_text)
    elif eval_id == '2':
        results = grade_eval_2(output_text)
    elif eval_id == '3':
        results = grade_eval_3(output_text)
    else:
        print(json.dumps({"error": "Unknown eval_id"}))
        sys.exit(1)

    passed_count = sum(1 for r in results if r['passed'])
    total_count = len(results)

    grading = {
        "expectations": results,
        "pass_rate": passed_count / total_count if total_count > 0 else 0,
        "passed": passed_count,
        "total": total_count
    }

    print(json.dumps(grading, indent=2, ensure_ascii=False))
