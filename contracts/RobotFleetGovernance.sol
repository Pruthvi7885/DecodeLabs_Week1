// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RobotFleetGovernance
 * @author DecodeLabs - Batch 2026
 * @notice Decentralized Robot Fleet Governance & Tasking
 * @dev Implements authenticated registration, exclusive tasking,
 *      concurrency protection, and proof-driven completion (IPO Model).
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  INPUT (Authorized Payload)  →  PROCESS (Smart Contract)    │
 *  │  →  OUTPUT (Immutable State)                                 │
 *  └─────────────────────────────────────────────────────────────┘
 */
contract RobotFleetGovernance {

    // ─────────────────────────────────────────────────────────────
    //  TYPES
    // ─────────────────────────────────────────────────────────────

    enum TaskStatus { Pending, Assigned, Completed, Cancelled }

    struct Robot {
        address addr;
        uint128 capabilities;   // bitmask — e.g. bit2=Lidar, bit64=HighMomentumMotor, bit96=HeavyPayload
        bool    registered;
        uint256 completedTasks;
    }

    struct Task {
        uint256 taskId;
        address robot;          // assigned robot
        address requester;      // who submitted the task
        uint256 payload;        // uint256 task descriptor (scaled integer)
        string  metadataURI;    // IPFS URI for heavy off-chain data
        TaskStatus status;
        bytes32 completionProof; // ZK-SNARK hash / completion hash
        uint256 createdAt;
        uint256 completedAt;
    }

    // ─────────────────────────────────────────────────────────────
    //  STATE
    // ─────────────────────────────────────────────────────────────

    address public owner;
    uint256 private _taskCounter;

    mapping(address  => Robot)   public robots;
    mapping(uint256  => Task)    public tasks;
    mapping(address  => uint256) public activeTask;   // robot → current taskId (0 = idle)

    address[] private _robotList;

    // ─────────────────────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────────────────────

    event RobotRegistered  (address indexed robot, uint128 capabilities);
    event RobotDeregistered(address indexed robot);
    event TaskAssigned     (uint256 indexed taskId, address indexed robot, address indexed requester, uint256 payload);
    event TaskCompleted    (uint256 indexed taskId, address indexed robot, bytes32 proof);
    event TaskCancelled    (uint256 indexed taskId, address indexed cancelledBy);

    // ─────────────────────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "FleetGov: caller is not owner");
        _;
    }

    modifier onlyRegistered(address robot) {
        require(robots[robot].registered, "FleetGov: robot not in authorized fleet");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  LOGICAL ACTUATOR FUNCTIONS  (Fleet Admin)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register a robot with a capability bitmask.
     * @dev    Strictly controlled by _onlyOwner check (security rule from spec).
     *         uint128 bitmask stores hardware traits gas-efficiently.
     * @param  robot        Ethereum address of the robot wallet.
     * @param  capabilities 128-bit packed capability flags.
     *
     * Example bitmask layout:
     *   bit  2  → Lidar Sensor
     *   bit 64  → High-Momentum Motor
     *   bit 96  → Heavy Payload Capacity
     */
    function registerRobot(address robot, uint128 capabilities) external onlyOwner {
        require(robot != address(0),        "FleetGov: zero address");
        require(!robots[robot].registered,  "FleetGov: robot already registered");

        robots[robot] = Robot({
            addr:           robot,
            capabilities:   capabilities,
            registered:     true,
            completedTasks: 0
        });
        _robotList.push(robot);

        emit RobotRegistered(robot, capabilities);
    }

    /**
     * @notice Remove a robot from the authorized fleet.
     * @dev    Cannot deregister a robot that currently has an active task.
     */
    function deregisterRobot(address robot) external onlyOwner onlyRegistered(robot) {
        require(activeTask[robot] == 0, "FleetGov: robot has an active task");

        robots[robot].registered = false;

        // Remove from list (swap-and-pop)
        for (uint256 i = 0; i < _robotList.length; i++) {
            if (_robotList[i] == robot) {
                _robotList[i] = _robotList[_robotList.length - 1];
                _robotList.pop();
                break;
            }
        }

        emit RobotDeregistered(robot);
    }

    // ─────────────────────────────────────────────────────────────
    //  BEHAVIORAL TASK LOGIC  (Operational Execution)
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Assign a task to exactly one specific robot.
     *         Passes through all three Security Gate checkpoints.
     *
     * @dev    CHECKPOINT 1 — Invalid Robot Validation
     *           if (!authenticated[robot]) → Reject
     *         CHECKPOINT 2 — Concurrency Shield
     *           if (activeTask[robot] != 0) → Reject("Robot Busy")
     *
     * @param  targetRobot  Address of the robot to assign.
     * @param  payload      uint256 task descriptor (sensor readings scaled ×10^7).
     * @param  metadataURI  IPFS URI pointing to full task specification.
     */
    function assignTask(
        address targetRobot,
        uint256 payload,
        string calldata metadataURI
    )
        external
        onlyRegistered(targetRobot)          // CHECKPOINT 1
        returns (uint256 taskId)
    {
        // CHECKPOINT 2 — Concurrency Shield
        require(activeTask[targetRobot] == 0, "FleetGov: robot busy");

        _taskCounter++;
        taskId = _taskCounter;

        tasks[taskId] = Task({
            taskId:          taskId,
            robot:           targetRobot,
            requester:       msg.sender,
            payload:         payload,
            metadataURI:     metadataURI,
            status:          TaskStatus.Assigned,
            completionProof: bytes32(0),
            createdAt:       block.timestamp,
            completedAt:     0
        });

        activeTask[targetRobot] = taskId;

        emit TaskAssigned(taskId, targetRobot, msg.sender, payload);
    }

    /**
     * @notice Verify and close a task — only the assigned robot may call this.
     *
     * @dev    CHECKPOINT 3 — Mismatched Completion
     *           if (tasks[taskId].robot != msg.sender) → Block Transaction
     *         Triggers flawless state transitions only when the exact
     *         assigned hardware reports success.
     *
     * @param  taskId           Task to complete.
     * @param  completionProof  ZK-SNARK hash or completion hash submitted by robot.
     */
    function verifyOutcome(uint256 taskId, bytes32 completionProof) external {
        Task storage t = tasks[taskId];

        require(t.taskId != 0,                       "FleetGov: task does not exist");
        require(t.status == TaskStatus.Assigned,     "FleetGov: task not in assigned state");

        // CHECKPOINT 3 — Mismatched Completion
        require(t.robot == msg.sender,               "FleetGov: caller is not the assigned robot");

        // On-chain logic gate: proof must be non-zero
        require(completionProof != bytes32(0),       "FleetGov: invalid completion proof");

        // Immutable state update (OUTPUT of IPO model)
        t.status          = TaskStatus.Completed;
        t.completionProof = completionProof;
        t.completedAt     = block.timestamp;

        activeTask[msg.sender] = 0;          // robot is now idle
        robots[msg.sender].completedTasks++; // performance tracking

        emit TaskCompleted(taskId, msg.sender, completionProof);
    }

    /**
     * @notice Cancel an assigned task (owner only).
     * @dev    Frees the robot from its active task lock.
     */
    function cancelTask(uint256 taskId) external onlyOwner {
        Task storage t = tasks[taskId];

        require(t.taskId != 0,                   "FleetGov: task does not exist");
        require(t.status == TaskStatus.Assigned, "FleetGov: task not cancellable");

        t.status = TaskStatus.Cancelled;
        activeTask[t.robot] = 0;

        emit TaskCancelled(taskId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    //  VIEW / QUERY FUNCTIONS
    // ─────────────────────────────────────────────────────────────

    /// @notice Check whether a robot is authenticated in the fleet.
    function checkRobotAuth(address robot) external view returns (bool) {
        return robots[robot].registered;
    }

    /// @notice Check if a robot has a specific capability via bitmask.
    function hasCapability(address robot, uint128 capabilityBit) external view returns (bool) {
        return (robots[robot].capabilities & capabilityBit) != 0;
    }

    /// @notice Get the full task struct for a given taskId.
    function getTask(uint256 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    /// @notice Return the list of all registered robot addresses.
    function getFleet() external view returns (address[] memory) {
        return _robotList;
    }

    /// @notice Return total tasks ever created.
    function totalTasks() external view returns (uint256) {
        return _taskCounter;
    }

    /**
     * @notice Encode a floating-point sensor reading into a Solidity-safe integer.
     * @dev    Solidity has no native floats. Scale by 10^7 to preserve 7 decimal places.
     *         Example: 0.3524 → 3_524_000
     * @param  scaledValue  Raw sensor value already multiplied by 10^7 off-chain.
     */
    function encodeSensorPayload(uint256 scaledValue) external pure returns (uint256) {
        return scaledValue; // stored as-is; division by 1e7 performed off-chain
    }
}
