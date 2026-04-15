# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is an infrastructure skills repository for Claude Code, containing storage planning tools and Kubernetes networking deployment/operations guides. Each skill is a self-contained directory following the [agentskills.io](https://agentskills.io) specification.

## Architecture

### Skill Structure

Each skill follows this standard layout:
```
skills/<skill-name>/
├── SKILL.md              # Skill definition with YAML frontmatter
├── scripts/              # Executable calculation scripts (Node.js)
│   ├── <skill-name>.js  # Main planning calculator
│   └── test.js          # Unit tests
├── evals/               # Evaluation framework
│   └── evals.json       # Test cases
├── references/          # Technical specifications
│   └── TECHNICAL_SPECS.md
└── data/                # Configuration data (JSON)
```

### Available Skills

#### Storage Planning
- **storage-planner-router**: Routes storage planning requests to appropriate sub-skills, provides solution comparison
- **gpfs-ece-planner**: GPFS ECE high-performance file storage planning
- **vastdata-planner**: VastData unified storage platform planning (file/object/block)
- **weka-planner**: Weka high-performance file system planning
- **xsky-xeos-planner**: XSKY XEOS object storage planning

#### Kubernetes Networking
- **spiderpool**: Spiderpool underlay/RDMA network deployment, operations and troubleshooting (IB/RoCE/RoCE-MIF)
- **metallb**: MetalLB load balancer deployment, operations and troubleshooting

#### Infrastructure Operations
- **troubleshoot-guide**: Infrastructure troubleshooting guide (K8s, network, storage, system, application)

### Skill Invocation Pattern

The router skill (`storage-planner-router`) orchestrates other skills:
1. Identifies storage type (file/object/block)
2. Presents solution comparison table
3. Collects capacity/performance requirements
4. Calls sub-skills in parallel using the Skill tool
5. Aggregates results into comparison table

## Development Commands

### Testing Skills

Run unit tests for a specific skill:
```bash
cd skills/<skill-name>
node scripts/test.js
```

### Running Planning Scripts

Execute planning calculations directly:
```bash
cd skills/<skill-name>
node scripts/<skill-name>.js --capacity "500TiB" --read-bw "100GB/s" --json
```

All planning scripts accept `--json` flag for structured output.

### Running Evaluations

Skills use the agentskills.io evaluation framework. Test cases are defined in `evals/evals.json`.

## Key Technical Details

### Planning Script Architecture

All planning scripts (`*-planner.js`) follow a common pattern:
- Parse CLI arguments (capacity, performance, network, fault tolerance)
- Calculate multiple configuration options (different server counts, disk sizes)
- Apply erasure coding efficiency calculations
- Output multiple solutions with performance metrics
- Mark recommended solution based on cost-effectiveness

### Unit Conversion

Scripts handle both decimal (TB, GB) and binary (TiB, GiB) units:
- Conversion factor: 1 TB = 0.909 TiB
- Binary units are preferred for storage calculations
- Performance metrics support both unit systems

### Erasure Coding Schemes

GPFS ECE uses different EC schemes based on server count and fault tolerance:
- **EC4+2P**: 66.67% efficiency (≤3 servers, ft=1)
- **EC8+2P**: 80% efficiency (≥10 servers, ft=2)
- **EC8+3P**: 72.73% efficiency (≥11 servers, ft=3)

### Performance Calculation

- Network types affect performance: RoCE/IB (1.0x), Ethernet (0.3x)
- Bandwidth scales with network bandwidth parameter
- IOPS remains constant regardless of network bandwidth (only affected by network type)
- Per-node performance is aggregated across cluster

## Plugin Marketplace

This repository is published as a Claude Code plugin marketplace:
- Marketplace name: `wutz/infra-skills`
- Plugins:
  - `storage-skills`: Storage planning and capacity calculation
  - `k8s-networking`: Kubernetes networking deployment and operations
- Configuration: `.claude-plugin/marketplace.json`

## Important Conventions

- All skills use Chinese language in SKILL.md descriptions and user interactions
- Planning scripts output JSON format when `--json` flag is provided
- Skills should preserve original sub-skill output format when aggregating results
- Router skill must call sub-skills in parallel for efficiency
- Capacity requirements are mandatory; performance requirements are optional
