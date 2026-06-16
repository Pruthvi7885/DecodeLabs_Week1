// scripts/deploy.js
// DecodeLabs – Batch 2026  |  Robotics & Automation Project 1
//
// Run:  npx hardhat run scripts/deploy.js --network localhost

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("═══════════════════════════════════════════════════════");
  console.log(" DecodeLabs – Decentralized Robot Fleet Governance");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`Deployer (Fleet Owner): ${deployer.address}`);
  console.log(`Balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ── Deploy ──────────────────────────────────────────────────────
  const Factory = await ethers.getContractFactory("RobotFleetGovernance");
  const fleet   = await Factory.deploy();
  await fleet.waitForDeployment();
  const addr = await fleet.getAddress();
  console.log(`✅  RobotFleetGovernance deployed at: ${addr}\n`);

  // ── Demo: Register robots with capability bitmasks ───────────────
  //   bit  2  (value 4)   → Lidar Sensor
  //   bit 64  (value 2^64)→ High-Momentum Motor
  //   bit 96  (value 2^96)→ Heavy Payload Capacity

  const signers    = await ethers.getSigners();
  const robotAddrs = signers.slice(1, 4).map(s => s.address);

  const LIDAR          = 4n;                        // bit 2
  const HIGH_MOMENTUM  = 2n ** 64n;                 // bit 64
  const HEAVY_PAYLOAD  = 2n ** 96n;                 // bit 96

  const capMap = {
    [robotAddrs[0]]: LIDAR | HIGH_MOMENTUM,         // R-01A
    [robotAddrs[1]]: HIGH_MOMENTUM | HEAVY_PAYLOAD, // R-02B
    [robotAddrs[2]]: LIDAR,                         // R-03G
  };

  console.log("── Registering fleet robots ──────────────────────────");
  for (const [addr, caps] of Object.entries(capMap)) {
    const tx = await fleet.registerRobot(addr, caps);
    await tx.wait();
    console.log(`  Robot ${addr.slice(0,10)}… registered  (caps: ${caps})`);
  }

  // ── Demo: Assign a task ─────────────────────────────────────────
  const targetRobot  = robotAddrs[0];
  //  Sensor reading 0.3524 scaled by 10^7 = 3_524_000
  const sensorPayload = 3_524_000n;
  const metaURI       = "ipfs://QmExampleHashForTask001";

  console.log("\n── Assigning task to R-01A ───────────────────────────");
  const assignTx = await fleet.assignTask(targetRobot, sensorPayload, metaURI);
  const receipt  = await assignTx.wait();

  // Parse TaskAssigned event
  const event  = receipt.logs
    .map(l => { try { return fleet.interface.parseLog(l); } catch { return null; } })
    .find(e => e && e.name === "TaskAssigned");

  const taskId = event.args.taskId;
  console.log(`  Task #${taskId} assigned → robot ${targetRobot.slice(0,10)}…`);

  // ── Demo: Complete task (robot calls verifyOutcome) ─────────────
  const robotSigner  = signers[1]; // R-01A signer
  const fleetAsRobot = fleet.connect(robotSigner);

  // Simulate ZK-SNARK / completion hash
  const completionProof = ethers.keccak256(
    ethers.toUtf8Bytes(`task:${taskId}:completed:${Date.now()}`)
  );

  console.log("\n── Robot reporting task completion ───────────────────");
  const completeTx = await fleetAsRobot.verifyOutcome(taskId, completionProof);
  await completeTx.wait();
  console.log(`  ✅  Task #${taskId} completed. Proof: ${completionProof.slice(0,20)}…`);

  // ── Summary ──────────────────────────────────────────────────────
  const task = await fleet.getTask(taskId);
  console.log("\n── On-chain state (immutable) ────────────────────────");
  console.log(`  taskId      : ${task.taskId}`);
  console.log(`  robot       : ${task.robot}`);
  console.log(`  status      : ${["Pending","Assigned","Completed","Cancelled"][task.status]}`);
  console.log(`  proof       : ${task.completionProof}`);
  console.log(`  completedAt : ${new Date(Number(task.completedAt) * 1000).toISOString()}`);

  const fleet2 = await fleet.getFleet();
  console.log(`\n  Fleet size  : ${fleet2.length} robots`);
  console.log(`  Total tasks : ${await fleet.totalTasks()}`);
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(" Deployment & smoke-test complete ✔");
  console.log("═══════════════════════════════════════════════════════");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
