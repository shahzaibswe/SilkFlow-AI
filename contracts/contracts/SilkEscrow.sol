// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SilkEscrow — trade-finance escrow state machine for SilkFlow AI
/// @notice Orders are keyed by bytes32 orderId (backend passes keccak256 of the
///         DB order id). Roles: `agent` (AI agent wallet), `reviewer` (human
///         admin), owner = deployer. Funding is pull-then-push: the buyer
///         approves the token, then fund() does transferFrom into the contract.
contract SilkEscrow {
    using SafeERC20 for IERC20;

    enum EscrowState {
        Created,           // 0 — registered, awaiting buyer funding
        Funded,            // 1 — funds pulled into contract
        ShipmentConfirmed, // 2 — agent confirmed shipment evidence
        Released,          // 3 — funds paid to seller
        Disputed,          // 4 — buyer/seller raised a dispute
        Refunded           // 5 — funds returned to buyer
    }

    struct Order {
        uint256 amount;   // escrowed amount in sUSD base units (6 decimals)
        address buyer;
        address seller;
        EscrowState state;
        uint256 fundedAt;   // block timestamp of funding (0 if not funded)
        uint256 releasedAt; // block timestamp of release/refund (0 if not settled)
    }

    IERC20 public immutable usd;
    address public owner;
    address public agent;
    address public reviewer;

    mapping(bytes32 => Order) public orders;

    // ---------------------------------------------------------------- events
    // Note: per spec all events carry orderId; OrderCreated also indexes it.
    event OrderCreated(bytes32 indexed orderId, uint256 amount, address buyer, address seller);
    event OrderFunded(bytes32 orderId, uint256 amount);
    event ShipmentConfirmed(bytes32 orderId);
    event FundsReleased(bytes32 orderId, address seller, uint256 amount);
    event DisputeRaised(bytes32 orderId, address by);
    event DisputeResolved(bytes32 orderId, uint8 decision);

    // ------------------------------------------------------------- modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "SilkEscrow: caller is not owner");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "SilkEscrow: caller is not agent");
        _;
    }

    modifier onlyReviewer() {
        require(msg.sender == reviewer, "SilkEscrow: caller is not reviewer");
        _;
    }

    modifier orderExists(bytes32 orderId) {
        require(orders[orderId].seller != address(0), "SilkEscrow: order does not exist");
        _;
    }

    // ------------------------------------------------------------ constructor
    constructor(address token, address agent_, address reviewer_) {
        require(token != address(0), "SilkEscrow: token is zero address");
        usd = IERC20(token);
        owner = msg.sender;
        agent = agent_ != address(0) ? agent_ : msg.sender;
        reviewer = reviewer_ != address(0) ? reviewer_ : msg.sender;
        emit RoleUpdated(agent, reviewer);
    }

    event RoleUpdated(address agent, address reviewer);

    // --------------------------------------------------------- admin (owner)
    function setAgent(address agent_) external onlyOwner {
        require(agent_ != address(0), "SilkEscrow: agent is zero address");
        agent = agent_;
        emit RoleUpdated(agent, reviewer);
    }

    function setReviewer(address reviewer_) external onlyOwner {
        require(reviewer_ != address(0), "SilkEscrow: reviewer is zero address");
        reviewer = reviewer_;
        emit RoleUpdated(agent, reviewer);
    }

    // ----------------------------------------------------------- state views
    function getState(bytes32 orderId) external view orderExists(orderId) returns (EscrowState) {
        return orders[orderId].state;
    }

    function getOrder(bytes32 orderId) external view orderExists(orderId) returns (Order memory) {
        return orders[orderId];
    }

    // -------------------------------------------------------------- lifecycle
    /// @notice Register an order in state Created. Only agent or owner.
    function createOrder(
        bytes32 orderId,
        uint256 amount,
        address buyer,
        address seller
    ) external {
        require(msg.sender == agent || msg.sender == owner, "SilkEscrow: only agent or owner");
        require(orderId != bytes32(0), "SilkEscrow: orderId is zero");
        require(amount > 0, "SilkEscrow: amount must be positive");
        require(buyer != address(0) && seller != address(0), "SilkEscrow: buyer/seller is zero address");
        require(buyer != seller, "SilkEscrow: buyer and seller are the same");
        require(orders[orderId].seller == address(0), "SilkEscrow: order already exists");

        orders[orderId] = Order({
            amount: amount,
            buyer: buyer,
            seller: seller,
            state: EscrowState.Created, // must already be Created (fresh slot)
            fundedAt: 0,
            releasedAt: 0
        });

        emit OrderCreated(orderId, amount, buyer, seller);
    }

    /// @notice Buyer funds the order. Requires prior sUSD approval (pull-then-push).
    function fund(bytes32 orderId) external orderExists(orderId) {
        Order storage o = orders[orderId];
        require(msg.sender == o.buyer, "SilkEscrow: only buyer can fund");
        require(o.state == EscrowState.Created, "SilkEscrow: not in state Created");

        uint256 amount = o.amount;
        usd.safeTransferFrom(o.buyer, address(this), amount);
        o.state = EscrowState.Funded;
        o.fundedAt = block.timestamp;

        emit OrderFunded(orderId, amount);
    }

    /// @notice Agent confirms shipment evidence. Funded -> ShipmentConfirmed.
    function confirmShipment(bytes32 orderId) external onlyAgent orderExists(orderId) {
        Order storage o = orders[orderId];
        require(o.state == EscrowState.Funded, "SilkEscrow: not in state Funded");
        o.state = EscrowState.ShipmentConfirmed;
        emit ShipmentConfirmed(orderId);
    }

    /// @notice Agent releases funds to the seller. ShipmentConfirmed -> Released.
    function release(bytes32 orderId) external onlyAgent orderExists(orderId) {
        Order storage o = orders[orderId];
        require(o.state == EscrowState.ShipmentConfirmed, "SilkEscrow: not in state ShipmentConfirmed");
        o.state = EscrowState.Released;
        o.releasedAt = block.timestamp;
        usd.safeTransfer(o.seller, o.amount);
        emit FundsReleased(orderId, o.seller, o.amount);
    }

    /// @notice Buyer or seller escalates to a human dispute.
    ///         Funded | ShipmentConfirmed -> Disputed.
    function raiseDispute(bytes32 orderId) external orderExists(orderId) {
        Order storage o = orders[orderId];
        require(
            msg.sender == o.buyer || msg.sender == o.seller,
            "SilkEscrow: only buyer or seller can dispute"
        );
        require(
            o.state == EscrowState.Funded || o.state == EscrowState.ShipmentConfirmed,
            "SilkEscrow: not in fundable/disputable state"
        );
        o.state = EscrowState.Disputed;
        emit DisputeRaised(orderId, msg.sender);
    }

    /// @notice Reviewer settles a dispute. Disputed -> (0: Released, pay seller)
    ///         | (1: Refunded, pay buyer).
    function resolve(bytes32 orderId, uint8 decision) external onlyReviewer orderExists(orderId) {
        Order storage o = orders[orderId];
        require(o.state == EscrowState.Disputed, "SilkEscrow: not in state Disputed");
        require(decision <= 1, "SilkEscrow: decision must be 0 (release) or 1 (refund)");

        if (decision == 0) {
            o.state = EscrowState.Released;
            o.releasedAt = block.timestamp;
            usd.safeTransfer(o.seller, o.amount);
            emit FundsReleased(orderId, o.seller, o.amount);
        } else {
            o.state = EscrowState.Refunded;
            o.releasedAt = block.timestamp;
            usd.safeTransfer(o.buyer, o.amount);
        }

        emit DisputeResolved(orderId, decision);
    }
}
