# 🤖 Decentralized Robot Fleet Governance
### DecodeLabs Industrial Training Kit — Batch 2026 | Project 1

> *"You are no longer merely programming machines. You are engineering the mathematically precise, economically self-sustaining networks that will define global commerce."*

---

## Overview

This project implements a **Decentralized Robot Fleet Governance** system using Solidity smart contracts. Instead of a fragile centralized server, all fleet decisions live on-chain — tamper-proof, immutable, and resilient.

### The Problem with Traditional Systems
Traditional fleet management relies on a single central server. One crash = entire fleet paralysis.

### The Solution: Blockchain as Meta-Controller
Every robot is authenticated on-chain. Every task assignment and completion is verified through smart contract logic gates — no single point of failure.

---

## Architecture

### IPO Model (on-chain decision engine)
```
INPUT                   PROCESS                  OUTPUT
─────────────────────   ──────────────────────   ──────────────────────
Authorized Payload  →   Smart Contract Logic  →  Immutable State
(uint256 payload +      (consensus + logic        (blockchain records
 targetRobot addr)       gates evaluate)           task lifecycles)
```

### Three Security Gate Checkpoints
Every `assignTask()` call passes through:

| Checkpoint | Rule | Logic |
|---|---|---|
| **1 – Invalid Robot** | Robot must be in authorized fleet | `if (!authenticated[robot]) → Reject` |
| **2 – Concurrency Shield** | Robot must be idle | `if (activeTask[robot] != 0) → Reject("Robot Busy")` |
| **3 – Mismatched Completion** | Only assigned robot can complete | `if (tasks[taskId].robot != msg.sender) → Block` |

---

## Smart Contract: `RobotFleetGovernance.sol`

### Key Functions

#### Logical Actuator Functions (Fleet Admin)
| Function | Description |
|---|---|
| `registerRobot(address, uint128)` | Register robot with capability bitmask. Owner only. |
| `deregisterRobot(address)` | Remove robot from fleet. Owner only. |

#### Behavioral Task Logic (Operational Execution)
| Function | Description |
|---|---|
| `assignTask(address, uint256, string)` | Assign task to one specific robot. Passes all 3 checkpoints. |
| `verifyOutcome(uint256, bytes32)` | Robot reports completion with ZK-SNARK/hash proof. |
| `cancelTask(uint256)` | Owner cancels an active task. |

#### View Functions
| Function | Description |
|---|---|
| `checkRobotAuth(address)` | Is robot authenticated? |
| `hasCapability(address, uint128)` | Does robot have a specific capability bit? |
| `getTask(uint256)` | Full task struct. |
| `getFleet()` | All registered robot addresses. |

### Capability Bitmask Layout
```
Bit  2  (value 4)    → Lidar Sensor
Bit 64  (value 2^64) → High-Momentum Motor
Bit 96  (value 2^96) → Heavy Payload Capacity
```
Using `uint128` efficiently stores complex hardware traits without the gas overhead of strings or arrays.

### Solidity Integer Scaling
Solidity has no native floats. Sensor readings are scaled by **10^7** before storage:
```
Raw sensor: 0.3524  →  ×10^7  →  3,524,000 (on-chain integer)
```

---

## Zero-Trust Economy Flywheel

```
1. INTENT     → Smart contract assigns task using IPO logic + capability bitmasks
2. EXECUTION  → Robot processes at the edge (LIDAR, Deep RL)
3. PROOF      → Robot submits a tiny ZK-SNARK through the Security Gates
4. REWARD     → Blockchain verifies proof → ERC-20 micropayment → next intent
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Install
```bash
npm install
```

### Compile
```bash
npx hardhat compile
```

### Run Tests
```bash
npx hardhat test
```

### Deploy Locally
```bash
# Terminal 1 – start local node
npx hardhat node

# Terminal 2 – deploy + smoke test
npx hardhat run scripts/deploy.js --network localhost
```

---

## Gatekeeper Rule — Deployment Checklist

- [ ] **Authenticated Registration** — Register a robot using the capability bitmask
- [ ] **Exclusive Tasking** — Assign a task to one specific robot
- [ ] **Concurrency Protection** — Enforce "Robot Busy" logic, reject double-booking
- [ ] **Proof-Driven Completion** — Process a completion hash/ZK-proof without crashing

---

## Future Extensions (Stretch Goals)
- Battery life constraint on task assignments
- Multi-robot collaboration logic gate
- ZK-SNARK verifier contract integration (Groth16)
- ERC-20 micropayment reward on `verifyOutcome`
- IPFS metadataURI pinning pipeline

---

*DecodeLabs — Greater Lucknow, India | decodelabs.tech@gmail.com*
