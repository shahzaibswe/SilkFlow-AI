const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Escrow states (must match Solidity enum order)
const State = {
  Created: 0,
  Funded: 1,
  ShipmentConfirmed: 2,
  Released: 3,
  Disputed: 4,
  Refunded: 5,
};

const AMOUNT = 18000n * 10n ** 6n; // 18,000 sUSD with 6 decimals
const ORDER_ID = ethers.keccak256(ethers.toUtf8Bytes("1")); // keccak256(ascii(str(order_id)))

async function deployFixture() {
  const [owner, agent, reviewer, buyer, seller, stranger] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockStableCoin");
  const token = await Token.deploy();

  const Escrow = await ethers.getContractFactory("SilkEscrow");
  const escrow = await Escrow.deploy(await token.getAddress(), agent.address, reviewer.address);

  // Fund the buyer with plenty of sUSD via the open faucet
  await token.mint(buyer.address, AMOUNT * 10n);

  return { owner, agent, reviewer, buyer, seller, stranger, token, escrow };
}

async function createFundedOrder(fixture) {
  const { escrow, token, buyer, seller, agent, ORDER_ID_ } = fixture;
  const orderId = ORDER_ID_ ?? ORDER_ID;
  await escrow.connect(agent).createOrder(orderId, AMOUNT, buyer.address, seller.address);
  await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
  await escrow.connect(buyer).fund(orderId);
  return orderId;
}

describe("MockStableCoin", function () {
  it("has correct name, symbol and 6 decimals", async function () {
    const { token } = await loadFixture(deployFixture);
    expect(await token.name()).to.equal("Silk USD");
    expect(await token.symbol()).to.equal("sUSD");
    expect(await token.decimals()).to.equal(6);
  });

  it("open faucet mints to anyone", async function () {
    const { token, stranger } = await loadFixture(deployFixture);
    await expect(token.connect(stranger).mint(stranger.address, 123n)).to.changeTokenBalances(
      token,
      [stranger],
      [123n]
    );
  });

  it("reverts minting to the zero address", async function () {
    const { token } = await loadFixture(deployFixture);
    await expect(
      token.mint(ethers.ZeroAddress, 1n)
    ).to.be.revertedWith("MockStableCoin: mint to zero address");
  });
});

describe("SilkEscrow", function () {
  describe("deployment / roles", function () {
    it("stores token, owner, agent and reviewer", async function () {
      const { escrow, token, owner, agent, reviewer } = await loadFixture(deployFixture);
      expect(await escrow.usd()).to.equal(await token.getAddress());
      expect(await escrow.owner()).to.equal(owner.address);
      expect(await escrow.agent()).to.equal(agent.address);
      expect(await escrow.reviewer()).to.equal(reviewer.address);
    });

    it("owner can rotate agent/reviewer, others cannot", async function () {
      const { escrow, stranger } = await loadFixture(deployFixture);
      await expect(escrow.connect(stranger).setAgent(stranger.address)).to.be.revertedWith(
        "SilkEscrow: caller is not owner"
      );
      await expect(escrow.setReviewer(stranger.address))
        .to.emit(escrow, "RoleUpdated");
      expect(await escrow.reviewer()).to.equal(stranger.address);
    });
  });

  describe("createOrder", function () {
    it("agent creates an order in state Created and emits OrderCreated", async function () {
      const { escrow, buyer, seller, agent } = await loadFixture(deployFixture);
      await expect(escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address))
        .to.emit(escrow, "OrderCreated")
        .withArgs(ORDER_ID, AMOUNT, buyer.address, seller.address);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.Created);
      const o = await escrow.getOrder(ORDER_ID);
      expect(o.amount).to.equal(AMOUNT);
      expect(o.buyer).to.equal(buyer.address);
      expect(o.seller).to.equal(seller.address);
      expect(o.fundedAt).to.equal(0n);
      expect(o.releasedAt).to.equal(0n);
    });

    it("owner may also create orders", async function () {
      const { escrow, owner, buyer, seller } = await loadFixture(deployFixture);
      await expect(escrow.connect(owner).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address)).to.not.be
        .reverted;
    });

    it("rejects callers that are neither agent nor owner", async function () {
      const { escrow, buyer, seller, stranger } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(stranger).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address)
      ).to.be.revertedWith("SilkEscrow: only agent or owner");
    });

    it("rejects duplicate orderId", async function () {
      const { escrow, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await expect(
        escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address)
      ).to.be.revertedWith("SilkEscrow: order already exists");
    });

    it("rejects bad inputs (zero amount, zero addresses, buyer==seller)", async function () {
      const { escrow, buyer, seller, agent } = await loadFixture(deployFixture);
      await expect(
        escrow.connect(agent).createOrder(ORDER_ID, 0, buyer.address, seller.address)
      ).to.be.revertedWith("SilkEscrow: amount must be positive");
      await expect(
        escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, ethers.ZeroAddress, seller.address)
      ).to.be.revertedWith("SilkEscrow: buyer/seller is zero address");
      await expect(
        escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, buyer.address)
      ).to.be.revertedWith("SilkEscrow: buyer and seller are the same");
    });

    it("unknown orders are not readable", async function () {
      const { escrow } = await loadFixture(deployFixture);
      await expect(escrow.getState(ORDER_ID)).to.be.revertedWith("SilkEscrow: order does not exist");
    });
  });

  describe("fund (pull-then-push)", function () {
    it("buyer funds a Created order: Created -> Funded, exact amount pulled", async function () {
      const { escrow, token, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);

      const tx = escrow.connect(buyer).fund(ORDER_ID);
      await expect(tx).to.changeTokenBalances(token, [buyer, escrow], [-AMOUNT, AMOUNT]);
      await expect(tx).to.emit(escrow, "OrderFunded").withArgs(ORDER_ID, AMOUNT);

      expect(await escrow.getState(ORDER_ID)).to.equal(State.Funded);
      const o = await escrow.getOrder(ORDER_ID);
      expect(o.fundedAt).to.equal(await time.latest());
    });

    it("only the buyer can fund", async function () {
      const { escrow, agent, stranger } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, stranger.address, agent.address);
      await expect(escrow.connect(agent).fund(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: only buyer can fund"
      );
    });

    it("enforces the exact registered amount (approve more, pull only amount)", async function () {
      const { escrow, token, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 5n);
      await expect(escrow.connect(buyer).fund(ORDER_ID)).to.changeTokenBalances(
        token,
        [buyer, escrow],
        [-AMOUNT, AMOUNT]
      );
    });

    it("reverts without prior approval", async function () {
      const { escrow, token, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await expect(escrow.connect(buyer).fund(ORDER_ID)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance"
      );
    });

    it("reverts with insufficient buyer balance", async function () {
      const { escrow, token, seller, agent } = await loadFixture(deployFixture);
      const signers = await ethers.getSigners();
      const poor = signers[8]; // never minted to
      const poorOrderId = ethers.keccak256(ethers.toUtf8Bytes("99"));
      await escrow.connect(agent).createOrder(poorOrderId, AMOUNT, poor.address, seller.address);
      await token.connect(poor).approve(await escrow.getAddress(), AMOUNT);
      await expect(escrow.connect(poor).fund(poorOrderId)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientBalance"
      );
    });

    it("cannot fund twice / wrong state", async function () {
      const fixture = await deployFixture();
      const { escrow, buyer, seller, agent, token, reviewer, owner, stranger } = fixture;
      await createFundedOrder(fixture);
      await expect(escrow.connect(buyer).fund(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state Created"
      );
    });
  });

  describe("confirmShipment", function () {
    it("agent moves Funded -> ShipmentConfirmed", async function () {
      const fixture = await deployFixture();
      const { escrow, agent } = fixture;
      await createFundedOrder(fixture);
      await expect(escrow.connect(agent).confirmShipment(ORDER_ID))
        .to.emit(escrow, "ShipmentConfirmed")
        .withArgs(ORDER_ID);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.ShipmentConfirmed);
    });

    it("only agent can confirm", async function () {
      const fixture = await deployFixture();
      const { escrow, buyer, reviewer } = fixture;
      await createFundedOrder(fixture);
      await expect(escrow.connect(buyer).confirmShipment(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: caller is not agent"
      );
      await expect(escrow.connect(reviewer).confirmShipment(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: caller is not agent"
      );
    });

    it("requires Funded state (not Created, not twice)", async function () {
      const { escrow, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await expect(escrow.connect(agent).confirmShipment(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state Funded"
      );
      const fixture = await deployFixture();
      await createFundedOrder(fixture);
      await fixture.escrow.connect(fixture.agent).confirmShipment(ORDER_ID);
      await expect(fixture.escrow.connect(fixture.agent).confirmShipment(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state Funded"
      );
    });
  });

  describe("release", function () {
    it("happy path create -> fund -> confirmShipment -> release pays the seller", async function () {
      const fixture = await deployFixture();
      const { escrow, token, buyer, seller, agent } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(agent).confirmShipment(ORDER_ID);

      const tx = escrow.connect(agent).release(ORDER_ID);
      await expect(tx).to.changeTokenBalances(token, [escrow, seller], [-AMOUNT, AMOUNT]);
      await expect(tx).to.emit(escrow, "FundsReleased").withArgs(ORDER_ID, seller.address, AMOUNT);

      expect(await escrow.getState(ORDER_ID)).to.equal(State.Released);
      const o = await escrow.getOrder(ORDER_ID);
      expect(o.releasedAt).to.equal(await time.latest());
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("only agent can release", async function () {
      const fixture = await deployFixture();
      const { escrow, buyer, seller, reviewer } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(fixture.agent).confirmShipment(ORDER_ID);
      await expect(escrow.connect(reviewer).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: caller is not agent"
      );
      await expect(escrow.connect(buyer).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: caller is not agent"
      );
      await expect(escrow.connect(seller).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: caller is not agent"
      );
    });

    it("cannot release before shipment is confirmed", async function () {
      const fixture = await deployFixture();
      const { escrow, agent } = fixture;
      await createFundedOrder(fixture);
      await expect(escrow.connect(agent).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state ShipmentConfirmed"
      );
    });

    it("prevents double release", async function () {
      const fixture = await deployFixture();
      const { escrow, agent, token, seller } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(agent).confirmShipment(ORDER_ID);
      await escrow.connect(agent).release(ORDER_ID);
      await expect(escrow.connect(agent).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state ShipmentConfirmed"
      );
      // seller got paid exactly once
      expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
    });

    it("cannot release a disputed or refunded order", async function () {
      const fixture = await deployFixture();
      const { escrow, agent, buyer } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(buyer).raiseDispute(ORDER_ID);
      await expect(escrow.connect(agent).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state ShipmentConfirmed"
      );
      await escrow.connect(fixture.reviewer).resolve(ORDER_ID, 1); // refund
      await expect(escrow.connect(agent).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state ShipmentConfirmed"
      );
    });
  });

  describe("raiseDispute", function () {
    it("buyer can dispute from Funded", async function () {
      const fixture = await deployFixture();
      const { escrow, buyer } = fixture;
      await createFundedOrder(fixture);
      await expect(escrow.connect(buyer).raiseDispute(ORDER_ID))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(ORDER_ID, buyer.address);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.Disputed);
    });

    it("seller can dispute from ShipmentConfirmed", async function () {
      const fixture = await deployFixture();
      const { escrow, agent, seller } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(agent).confirmShipment(ORDER_ID);
      await expect(escrow.connect(seller).raiseDispute(ORDER_ID))
        .to.emit(escrow, "DisputeRaised")
        .withArgs(ORDER_ID, seller.address);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.Disputed);
    });

    it("third parties cannot dispute", async function () {
      const fixture = await deployFixture();
      const { escrow, stranger, reviewer, owner } = fixture;
      await createFundedOrder(fixture);
      for (const caller of [stranger, reviewer, owner]) {
        await expect(escrow.connect(caller).raiseDispute(ORDER_ID)).to.be.revertedWith(
          "SilkEscrow: only buyer or seller can dispute"
        );
      }
    });

    it("cannot dispute Created / Released / terminal states", async function () {
      const { escrow, buyer, seller, agent } = await loadFixture(deployFixture);
      await escrow.connect(agent).createOrder(ORDER_ID, AMOUNT, buyer.address, seller.address);
      await expect(escrow.connect(buyer).raiseDispute(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in fundable/disputable state"
      );

      const fixture = await deployFixture();
      await createFundedOrder(fixture);
      await fixture.escrow.connect(fixture.agent).confirmShipment(ORDER_ID);
      await fixture.escrow.connect(fixture.agent).release(ORDER_ID);
      await expect(fixture.escrow.connect(fixture.buyer).raiseDispute(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in fundable/disputable state"
      );
    });

    it("cannot dispute twice", async function () {
      const fixture = await deployFixture();
      const { escrow, buyer, seller } = fixture;
      await createFundedOrder(fixture);
      await escrow.connect(buyer).raiseDispute(ORDER_ID);
      await expect(escrow.connect(seller).raiseDispute(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in fundable/disputable state"
      );
    });
  });

  describe("resolve (reviewer only)", function () {
    async function disputedFixture() {
      const fixture = await deployFixture();
      await createFundedOrder(fixture);
      await fixture.escrow.connect(fixture.buyer).raiseDispute(ORDER_ID);
      return fixture;
    }

    it("decision 0 releases to seller and emits events", async function () {
      const fixture = await disputedFixture();
      const { escrow, token, reviewer, seller } = fixture;
      const tx = escrow.connect(reviewer).resolve(ORDER_ID, 0);
      await expect(tx).to.changeTokenBalances(token, [escrow, seller], [-AMOUNT, AMOUNT]);
      await expect(tx).to.emit(escrow, "FundsReleased").withArgs(ORDER_ID, seller.address, AMOUNT);
      await expect(tx).to.emit(escrow, "DisputeResolved").withArgs(ORDER_ID, 0);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.Released);
      expect((await escrow.getOrder(ORDER_ID)).releasedAt).to.equal(await time.latest());
    });

    it("decision 1 refunds the buyer", async function () {
      const fixture = await disputedFixture();
      const { escrow, token, reviewer, buyer } = fixture;
      const tx = escrow.connect(reviewer).resolve(ORDER_ID, 1);
      await expect(tx).to.changeTokenBalances(token, [escrow, buyer], [-AMOUNT, AMOUNT]);
      await expect(tx).to.emit(escrow, "DisputeResolved").withArgs(ORDER_ID, 1);
      expect(await escrow.getState(ORDER_ID)).to.equal(State.Refunded);
    });

    it("only reviewer can resolve", async function () {
      const fixture = await disputedFixture();
      const { escrow, agent, buyer, seller, owner, stranger } = fixture;
      for (const caller of [agent, buyer, seller, owner, stranger]) {
        await expect(escrow.connect(caller).resolve(ORDER_ID, 0)).to.be.revertedWith(
          "SilkEscrow: caller is not reviewer"
        );
      }
    });

    it("rejects invalid decision codes", async function () {
      const fixture = await disputedFixture();
      await expect(fixture.escrow.connect(fixture.reviewer).resolve(ORDER_ID, 2)).to.be.revertedWith(
        "SilkEscrow: decision must be 0 (release) or 1 (refund)"
      );
      await expect(fixture.escrow.connect(fixture.reviewer).resolve(ORDER_ID, 255)).to.be.revertedWith(
        "SilkEscrow: decision must be 0 (release) or 1 (refund)"
      );
    });

    it("cannot resolve a non-disputed order", async function () {
      const fixture = await deployFixture();
      await createFundedOrder(fixture);
      await expect(fixture.escrow.connect(fixture.reviewer).resolve(ORDER_ID, 0)).to.be.revertedWith(
        "SilkEscrow: not in state Disputed"
      );
    });

    it("dispute resolution is final (no double settle)", async function () {
      const fixture = await disputedFixture();
      const { escrow, reviewer, token, seller, buyer, agent } = fixture;
      await escrow.connect(reviewer).resolve(ORDER_ID, 0);
      expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);

      await expect(escrow.connect(reviewer).resolve(ORDER_ID, 1)).to.be.revertedWith(
        "SilkEscrow: not in state Disputed"
      );
      await expect(escrow.connect(agent).release(ORDER_ID)).to.be.revertedWith(
        "SilkEscrow: not in state ShipmentConfirmed"
      );
      // escrow drained exactly once
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
      expect(await token.balanceOf(buyer.address)).to.equal(AMOUNT * 9n); // 10x mint minus funding, not refunded
    });
  });

  describe("operational details", function () {
    it("independent orders do not interfere", async function () {
      const fixture = await deployFixture();
      const { escrow, token, buyer, seller, agent } = fixture;
      const idA = ethers.keccak256(ethers.toUtf8Bytes("10"));
      const idB = ethers.keccak256(ethers.toUtf8Bytes("20"));
      await escrow.connect(agent).createOrder(idA, AMOUNT, buyer.address, seller.address);
      await escrow.connect(agent).createOrder(idB, AMOUNT * 2n, buyer.address, seller.address);
      await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 3n);
      await escrow.connect(buyer).fund(idA);
      await escrow.connect(agent).confirmShipment(idA);
      await escrow.connect(agent).release(idA);
      expect(await escrow.getState(idA)).to.equal(State.Released);
      expect(await escrow.getState(idB)).to.equal(State.Created);
      // funding B pulls its own (larger) amount
      await escrow.connect(buyer).fund(idB);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT * 2n);
    });

    it("time moves forward and timestamps are recorded", async function () {
      const fixture = await deployFixture();
      const { escrow, agent } = fixture;
      await createFundedOrder(fixture);
      const before = (await escrow.getOrder(ORDER_ID)).fundedAt;
      await time.increase(60);
      await escrow.connect(agent).confirmShipment(ORDER_ID);
      await escrow.connect(agent).release(ORDER_ID);
      const o = await escrow.getOrder(ORDER_ID);
      expect(o.releasedAt).to.be.greaterThan(before);
    });
  });
});
