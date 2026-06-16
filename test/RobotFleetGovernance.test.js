// test/RobotFleetGovernance.test.js
// DecodeLabs – Batch 2026  |  Robotics & Automation Project 1
//
// Run:  npx hardhat test

const { expect }        = require("chai");
const { ethers }        = require("hardhat");
const { loadFixture }   = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// ──────────────────────────────────────────────────────────────────
//  CAPABILITY CONSTANTS  (bitmask layout from spec)
// ──────────────────────────────────────────────────────────────────
const LIDAR         = 4n;          // bit 2
const HIGH_MOMENTUM = 2n ** 64n;   // bit 64
const HEAVY_PAYLOAD = 2n ** 96n;   // bit 96

// ──────────────────────────────────────────────────────────────────
//  FIXTURE
// ──────────────────────────────────────────────────────────────────
async function deployFleetFixture() {
  const [owner, robot1, robot2, robot3, stranger] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("RobotFleetGovernance");
  const fleet   = await Factory.deploy();

  return { fleet, owner, robot1, robot2, robot3, stranger };
}

// ──────────────────────────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────────────────────────
function fakeProof(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(`proof:${seed}`));
}

// ──────────────────────────────────────────────────────────────────
//  TESTS
// ──────────────────────────────────────────────────────────────────
describe("RobotFleetGovernance", function () {

  // ────────────────────────────────────────────────────────────────
  //  DEPLOYMENT
  // ────────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      const { fleet, owner } = await loadFixture(deployFleetFixture);
      expect(await fleet.owner()).to.equal(owner.address);
    });

    it("initialises with zero tasks", async function () {
      const { fleet } = await loadFixture(deployFleetFixture);
      expect(await fleet.totalTasks()).to.equal(0);
    });

    it("initialises with an empty fleet", async function () {
      const { fleet } = await loadFixture(deployFleetFixture);
      expect((await fleet.getFleet()).length).to.equal(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  AUTHENTICATED REGISTRATION  (Gatekeeper Rule #1)
  // ────────────────────────────────────────────────────────────────
  describe("registerRobot", function () {
    it("owner can register a robot with capability bitmask", async function () {
      const { fleet, owner, robot1 } = await loadFixture(deployFleetFixture);
      const caps = LIDAR | HIGH_MOMENTUM;

      await expect(fleet.registerRobot(robot1.address, caps))
        .to.emit(fleet, "RobotRegistered")
        .withArgs(robot1.address, caps);

      expect(await fleet.checkRobotAuth(robot1.address)).to.be.true;
    });

    it("correctly stores capability bitmask", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR | HEAVY_PAYLOAD);

      expect(await fleet.hasCapability(robot1.address, LIDAR)).to.be.true;
      expect(await fleet.hasCapability(robot1.address, HEAVY_PAYLOAD)).to.be.true;
      expect(await fleet.hasCapability(robot1.address, HIGH_MOMENTUM)).to.be.false;
    });

    it("non-owner CANNOT register a robot", async function () {
      const { fleet, robot1, stranger } = await loadFixture(deployFleetFixture);
      await expect(
        fleet.connect(stranger).registerRobot(robot1.address, LIDAR)
      ).to.be.revertedWith("FleetGov: caller is not owner");
    });

    it("reverts on zero address", async function () {
      const { fleet } = await loadFixture(deployFleetFixture);
      await expect(
        fleet.registerRobot(ethers.ZeroAddress, LIDAR)
      ).to.be.revertedWith("FleetGov: zero address");
    });

    it("reverts on duplicate registration", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await expect(
        fleet.registerRobot(robot1.address, LIDAR)
      ).to.be.revertedWith("FleetGov: robot already registered");
    });

    it("appears in the fleet list", async function () {
      const { fleet, robot1, robot2 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.registerRobot(robot2.address, HIGH_MOMENTUM);
      expect((await fleet.getFleet()).length).to.equal(2);
    });
  });

  describe("deregisterRobot", function () {
    it("owner can deregister an idle robot", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await expect(fleet.deregisterRobot(robot1.address))
        .to.emit(fleet, "RobotDeregistered")
        .withArgs(robot1.address);
      expect(await fleet.checkRobotAuth(robot1.address)).to.be.false;
    });

    it("cannot deregister a robot with an active task", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1000n, "ipfs://test");
      await expect(fleet.deregisterRobot(robot1.address))
        .to.be.revertedWith("FleetGov: robot has an active task");
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  EXCLUSIVE TASKING  (Gatekeeper Rule #2)
  // ────────────────────────────────────────────────────────────────
  describe("assignTask", function () {
    it("assigns a task to a registered robot", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);

      await expect(fleet.assignTask(robot1.address, 3_524_000n, "ipfs://taskA"))
        .to.emit(fleet, "TaskAssigned")
        .withArgs(1n, robot1.address, (await ethers.getSigners())[0].address, 3_524_000n);
    });

    it("task is stored with Assigned status", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://x");

      const t = await fleet.getTask(1);
      expect(t.status).to.equal(1); // TaskStatus.Assigned
      expect(t.robot).to.equal(robot1.address);
    });

    // CHECKPOINT 1 — Invalid Robot Validation
    it("CHECKPOINT 1: rejects task for unregistered robot", async function () {
      const { fleet, stranger } = await loadFixture(deployFleetFixture);
      await expect(
        fleet.assignTask(stranger.address, 100n, "ipfs://bad")
      ).to.be.revertedWith("FleetGov: robot not in authorized fleet");
    });

    // CHECKPOINT 2 — Concurrency Shield
    it("CHECKPOINT 2: rejects double-tasking (Robot Busy)", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 100n, "ipfs://first");

      await expect(
        fleet.assignTask(robot1.address, 200n, "ipfs://second")
      ).to.be.revertedWith("FleetGov: robot busy");
    });

    it("robot becomes idle again after task completion", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 100n, "ipfs://t");

      await fleet.connect(robot1).verifyOutcome(1n, fakeProof("t1"));

      // should now accept a new task
      await expect(fleet.assignTask(robot1.address, 200n, "ipfs://t2"))
        .to.emit(fleet, "TaskAssigned");
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  PROOF-DRIVEN COMPLETION  (Gatekeeper Rule #4 + Checkpoint 3)
  // ────────────────────────────────────────────────────────────────
  describe("verifyOutcome", function () {
    it("assigned robot can complete task with valid proof", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 100n, "ipfs://t");

      const proof = fakeProof("done");
      await expect(fleet.connect(robot1).verifyOutcome(1n, proof))
        .to.emit(fleet, "TaskCompleted")
        .withArgs(1n, robot1.address, proof);
    });

    it("stores completion proof on-chain immutably", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 100n, "ipfs://t");

      const proof = fakeProof("immutable");
      await fleet.connect(robot1).verifyOutcome(1n, proof);

      const t = await fleet.getTask(1n);
      expect(t.completionProof).to.equal(proof);
      expect(t.status).to.equal(2); // TaskStatus.Completed
    });

    it("increments robot completed-tasks counter", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://t");
      await fleet.connect(robot1).verifyOutcome(1n, fakeProof("r"));

      const r = await fleet.robots(robot1.address);
      expect(r.completedTasks).to.equal(1n);
    });

    // CHECKPOINT 3 — Mismatched Completion
    it("CHECKPOINT 3: blocks completion by wrong robot", async function () {
      const { fleet, robot1, robot2 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.registerRobot(robot2.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://t");

      await expect(
        fleet.connect(robot2).verifyOutcome(1n, fakeProof("hack"))
      ).to.be.revertedWith("FleetGov: caller is not the assigned robot");
    });

    it("rejects zero (invalid) proof", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://t");

      await expect(
        fleet.connect(robot1).verifyOutcome(1n, ethers.ZeroHash)
      ).to.be.revertedWith("FleetGov: invalid completion proof");
    });

    it("reverts on non-existent task", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await expect(
        fleet.connect(robot1).verifyOutcome(999n, fakeProof("x"))
      ).to.be.revertedWith("FleetGov: task does not exist");
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  TASK CANCELLATION
  // ────────────────────────────────────────────────────────────────
  describe("cancelTask", function () {
    it("owner can cancel an assigned task", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://t");

      await expect(fleet.cancelTask(1n))
        .to.emit(fleet, "TaskCancelled")
        .withArgs(1n, (await ethers.getSigners())[0].address);

      const t = await fleet.getTask(1n);
      expect(t.status).to.equal(3); // Cancelled
    });

    it("frees robot after cancellation", async function () {
      const { fleet, robot1 } = await loadFixture(deployFleetFixture);
      await fleet.registerRobot(robot1.address, LIDAR);
      await fleet.assignTask(robot1.address, 1n, "ipfs://t");
      await fleet.cancelTask(1n);

      expect(await fleet.activeTask(robot1.address)).to.equal(0n);
    });
  });

  // ────────────────────────────────────────────────────────────────
  //  SENSOR PAYLOAD ENCODING  (Solidity integer scaling)
  // ────────────────────────────────────────────────────────────────
  describe("encodeSensorPayload", function () {
    it("stores 0.3524 sensor reading as 3_524_000 (×10^7)", async function () {
      const { fleet } = await loadFixture(deployFleetFixture);
      // Off-chain: 0.3524 × 10^7 = 3524000
      expect(await fleet.encodeSensorPayload(3_524_000n)).to.equal(3_524_000n);
    });
  });

});
