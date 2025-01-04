// import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
// import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

describe("CasperFFG", function () {
    let CasperFFG: any;
    let casperFFG: any;
    let owner: any;
    let validator1: any;
    let validator2: any;
    let validator3: any;
    let nonValidator: any;
    const MIN_DEPOSIT_STRING = "0.01";
    const MIN_DEPOSIT = hre.ethers.parseEther(MIN_DEPOSIT_STRING);
    const EPOCH_LENGTH = 100;
    const WITHDRAWAL_DELAY = 21600 * 4;
  
    beforeEach(async function () {
      [owner, validator1, validator2, validator3, nonValidator] = await ethers.getSigners();
      CasperFFG = await ethers.getContractFactory("CasperFFG");
      casperFFG = await CasperFFG.deploy();
      await casperFFG.waitForDeployment();
    });
  
    describe("Constructor", function () {
      it("Should set initial state correctly", async function () {
        expect(await casperFFG.genesisBlockNumber()).to.be.gt(0);

        expect(await casperFFG.currentDynasty()).to.equal(0);
        expect(await casperFFG.currentEpoch()).to.equal(0);
        expect(await casperFFG.isVotingPeriodOpen()).to.equal(false);

        const genesisBlockNumber = await ethers.provider.getBlockNumber();
        const genesisHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [genesisBlockNumber]));

        const maybeRootCheckpoint = await casperFFG.checkpoints(genesisHash);
        expect(maybeRootCheckpoint.hash).to.equal(genesisHash);
        expect(maybeRootCheckpoint.parentHash).to.equal(ethers.toBigInt(0));
        expect(maybeRootCheckpoint.isJustified).to.equal(true);
        expect(maybeRootCheckpoint.isFinalized).to.equal(true);
        expect(maybeRootCheckpoint.epoch).to.equal(ethers.toBigInt(0));

        expect(await casperFFG.latestCheckpointHash()).to.equal(maybeRootCheckpoint.hash);
      });
    });
  
    describe("Validator Management", function () {
      describe("joinValidatorSet", function () {
        it("Should allow joining with sufficient deposit", async function () {
          await expect(casperFFG.connect(validator1).joinValidatorSet({
            value: MIN_DEPOSIT
          }))
            .to.emit(casperFFG, "ValidatorJoined")
            .withArgs(validator1.address, MIN_DEPOSIT, 2);
  
          const validator = await casperFFG.validators(validator1.address);
          expect(validator.deposit).to.equal(MIN_DEPOSIT);
          expect(validator.startDynasty).to.equal(2);
        });
  
        it("Should reject insufficient deposits", async function () {
          await expect(
            casperFFG.connect(validator1).joinValidatorSet({
              value: MIN_DEPOSIT - 1n
            })
          ).to.be.revertedWith("Deposit too low");
        });
  
        it("Should reject already registered validators", async function () {
          await casperFFG.connect(validator1).joinValidatorSet({
            value: MIN_DEPOSIT
          });
  
          await expect(
            casperFFG.connect(validator1).joinValidatorSet({
              value: MIN_DEPOSIT
            })
          ).to.be.revertedWith("Already registered validator");
        });
      });
  
      describe("leaveValidatorSet", function () {
        beforeEach(async function () {
          await casperFFG.connect(validator1).joinValidatorSet({
            value: MIN_DEPOSIT
          });
        });
  
        it("Should allow validators to leave", async function () {
          await expect(casperFFG.connect(validator1).leaveValidatorSet())
            .to.emit(casperFFG, "ValidatorLeft")
            .withArgs(validator1.address, 2);
  
          const validator = await casperFFG.validators(validator1.address);
          expect(validator.deposit).to.equal(0);
          expect(validator.endDynasty).to.equal(2);
        });
  
        it("Should reject non-validators leaving", async function () {
          await expect(
            casperFFG.connect(nonValidator).leaveValidatorSet()
          ).to.be.revertedWith("Not a validator");
        });
  
        it("Should set correct withdrawal delay", async function () {
            const stakedAmountBeforeLeaving = (await casperFFG.validators(validator1.address)).deposit;
          await casperFFG.connect(validator1).leaveValidatorSet();

          const withdrawal = await casperFFG.withdrawals(validator1.address);
          expect(withdrawal.amount).to.equal(stakedAmountBeforeLeaving);
          expect(withdrawal.allowedFromBlockNumber).to.equal(await ethers.provider.getBlockNumber() + WITHDRAWAL_DELAY);
        });
      });
    });
  
    describe("Voting Mechanism", function () {
      beforeEach(async function () {
        // Setup multiple validators
        await casperFFG.connect(validator1).joinValidatorSet({ value: MIN_DEPOSIT });
        await casperFFG.connect(validator2).joinValidatorSet({ value: MIN_DEPOSIT });
        await casperFFG.connect(validator3).joinValidatorSet({ value: MIN_DEPOSIT });
      });
  
      describe("openVotingPeriodIfPossible", function () {
        it("Should not open voting period before EPOCH_LENGTH blocks", async function () {
          await expect(
            casperFFG.openVotingPeriodIfPossible()
          ).to.be.revertedWith("Not enough blocks since last checkpoint");
        });
  
        it("Should automatically create checkpoints for first two dynasties", async function () {
          // Mine enough blocks to reach next epoch
          await mineBlocks(EPOCH_LENGTH);
          await casperFFG.openVotingPeriodIfPossible();
          expect(await casperFFG.currentEpoch()).to.equal(1);
        });
      });
  
      describe("submitVote", function () {
        beforeEach(async function () {
          // Advance to dynasty 2 where validators can vote
          await mineBlocks(EPOCH_LENGTH * 2);
          await casperFFG.openVotingPeriodIfPossible();
          await casperFFG.openVotingPeriodIfPossible();
          await mineBlocks(EPOCH_LENGTH);
          await casperFFG.openVotingPeriodIfPossible();
          await mineBlocks(EPOCH_LENGTH);
          await casperFFG.openVotingPeriodIfPossible();
        });
  
        it("Should allow valid votes from active validators", async function () {
          const sourceHash = await casperFFG.latestCheckpointHash();
          const sourceHeight = await casperFFG.currentEpoch();
          const targetHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [await casperFFG.getFutureCheckpointBlockNumberPublic()]
          ));
          const targetHeight = await casperFFG.currentEpoch() + 1n;

          await expect(
            casperFFG.connect(validator1).submitVote(
              sourceHash,
              targetHash,
              sourceHeight,
              targetHeight
            )
          ).to.emit(casperFFG, "VoteSubmitted");

          const hasVoted = await casperFFG.votesAtHeightByVoter(targetHeight, validator1.address);
          expect(hasVoted).to.equal(true);
          const lastVote = await casperFFG.lastVoteByVoter(validator1.address);
          expect(lastVote.sourceHash).to.equal(sourceHash);
          expect(lastVote.targetHash).to.equal(targetHash);
          expect(lastVote.sourceHeight).to.equal(sourceHeight);
          expect(lastVote.targetHeight).to.equal(targetHeight);
          const linkVotingStats = await casperFFG.checkpointLinkVotingStats(sourceHash, targetHash);
          const validatorStake = (await casperFFG.validators(validator1.address)).deposit
          expect(linkVotingStats).to.equal(validatorStake);
          const amountStakedForCurrentDynasty = await casperFFG.amountStakedByDynasty(await casperFFG.currentDynasty());
          expect(amountStakedForCurrentDynasty).to.equal(MIN_DEPOSIT + MIN_DEPOSIT + MIN_DEPOSIT);
        });
  
        it("Should reject votes from non-validators", async function () {
          const sourceHash = await casperFFG.latestCheckpointHash();
          const targetHeight = await casperFFG.currentEpoch() + 1n;
          const sourceHeight = await casperFFG.currentEpoch();
          const targetHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [await casperFFG.getFutureCheckpointBlockNumberPublic()]
          ));
  
          await expect(
            casperFFG.connect(nonValidator).submitVote(
              sourceHash,
              targetHash,
              sourceHeight,
              targetHeight
            )
          ).to.be.revertedWith("Not an active validator");
        });
  
        it("Should enforce slashing conditions", async function () {
          const beforeSlashing = await casperFFG.validators(validator1.address);
          const stakedInDynastyBefore = await casperFFG.amountStakedByDynasty(await casperFFG.currentDynasty());
          const sourceHash = await casperFFG.latestCheckpointHash();
          const targetHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [await casperFFG.getFutureCheckpointBlockNumberPublic()]
          ));
          const targetHeight = await casperFFG.currentEpoch() + 1n;
          const sourceHeight = await casperFFG.currentEpoch();
  
          // Submit first vote
          await casperFFG.connect(validator1).submitVote(
            sourceHash,
            targetHash,
            sourceHeight,
            targetHeight
          );

          // Submit second vote
          await casperFFG.connect(validator1).submitVote(
            sourceHash,
            targetHash,
            sourceHeight,
            targetHeight
          );

          const afterSlashing = await casperFFG.validators(validator1.address);
          const stakedInDynastyAfter = await casperFFG.amountStakedByDynasty(await casperFFG.currentDynasty());

          expect(beforeSlashing.deposit).to.equal(MIN_DEPOSIT);
          expect(afterSlashing.deposit).to.equal(0);
          expect(stakedInDynastyAfter).to.equal(stakedInDynastyBefore - MIN_DEPOSIT);
        });
  
        it("Should justify and finalize checkpoints with sufficient votes", async function () {
          const latestCheckpointBefore = await casperFFG.latestCheckpointHash();
          const stakedInCurrentDynasty = await casperFFG.amountStakedByDynasty(await casperFFG.currentDynasty());
          const sourceHash = await casperFFG.latestCheckpointHash();
          const targetHeight = await casperFFG.currentEpoch() + 1n;
          const sourceHeight = await casperFFG.currentEpoch();
          const targetHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256"],
            [await casperFFG.getFutureCheckpointBlockNumberPublic()]
          ));

          // Check if checkpints are in correct state
          const targetCheckpoint1 = await casperFFG.checkpoints(targetHash);
          const sourceCheckpoint1 = await casperFFG.checkpoints(sourceHash);
          expect(targetCheckpoint1.isJustified).to.be.false;
          expect(sourceCheckpoint1.isFinalized).to.be.false;
  
          // Submit votes from all validators to reach 2/3 threshold
          await casperFFG.connect(validator1).submitVote(
            sourceHash,
            targetHash,
            sourceHeight,
            targetHeight
          );

          await casperFFG.connect(validator2).submitVote(
            sourceHash,
            targetHash,
            sourceHeight,
            targetHeight
          );

          const latestCheckpointAfter = await casperFFG.latestCheckpointHash();

          expect(latestCheckpointBefore).to.not.equal(latestCheckpointAfter);

          const linkStats = await casperFFG.checkpointLinkVotingStats(sourceHash, targetHash);
      
          expect(linkStats).to.equal(MIN_DEPOSIT + MIN_DEPOSIT); // 2 ETH
          expect(stakedInCurrentDynasty).equals(MIN_DEPOSIT + MIN_DEPOSIT + MIN_DEPOSIT); // 3 ETH
          
          // Check if checkpoint is justified and previous is finalized
          const targetCheckpoint = await casperFFG.checkpoints(targetHash);
          const sourceCheckpoint = await casperFFG.checkpoints(sourceHash);
          expect(targetCheckpoint.isJustified).to.be.true;
          expect(sourceCheckpoint.isFinalized).to.be.true;
        });
      });
    });
  
    describe("Withdrawal Mechanism", function () {
      beforeEach(async function () {
        await casperFFG.connect(validator1).joinValidatorSet({
          value: MIN_DEPOSIT
        });
        await casperFFG.connect(validator1).leaveValidatorSet();
      });

      it("Leaver's deposit should be accurately deducted from total dynasty deposited", async function () {
        const currentlyStaked = await casperFFG.amountStakedByDynasty((await casperFFG.currentDynasty()) + ethers.toBigInt(2)); 
        await casperFFG.connect(validator2).joinValidatorSet({
          value: MIN_DEPOSIT
        });
        const currentlyStaked2 = await casperFFG.amountStakedByDynasty((await casperFFG.currentDynasty()) + ethers.toBigInt(2)); 
        await casperFFG.connect(validator2).leaveValidatorSet();
        const currentlyStaked3 = await casperFFG.amountStakedByDynasty((await casperFFG.currentDynasty()) + ethers.toBigInt(2)); 
        expect(currentlyStaked3).to.equal(currentlyStaked);
        expect(currentlyStaked2).to.equal(currentlyStaked + MIN_DEPOSIT);
      });
  
      it("Should not allow withdrawal before delay period", async function () {
        await expect(
          casperFFG.connect(validator1).withdrawAfterDelay()
        ).to.be.revertedWith("Withdrawal not allowed yet");
      });
  
      it("Should allow withdrawal after delay period", async function () {
        // Mine blocks to pass withdrawal delay
        await mineBlocks(WITHDRAWAL_DELAY);
        
        const initialBalance = await ethers.provider.getBalance(validator1.address);
        await casperFFG.connect(validator1).withdrawAfterDelay();
        const finalBalance = await ethers.provider.getBalance(validator1.address);
        const diff = parseFloat(ethers.formatEther(finalBalance)) - parseFloat(ethers.formatEther(initialBalance));

        // Some ETH will be lost due to gas fees
        expect(diff).to.be.closeTo(parseFloat(ethers.formatEther(MIN_DEPOSIT)), parseFloat(MIN_DEPOSIT_STRING) / 100);
      });
    });
  });
  
  // Helper function to mine blocks
  async function mineBlocks(count: number) {
    for (let i = 0; i < count; i++) {
      await ethers.provider.send("evm_mine");
    }
  }