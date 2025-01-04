// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CasperFFG {
    /* 
    *Structs
    */
    struct Checkpoint {
        bytes32 hash;
        bytes32 parentHash;
        bool isJustified;
        bool isFinalized;
        uint256 epoch; // in this simplified implementation epoch = height, in the production version it is not always the case
    }

    struct Vote {
        bytes32 sourceHash;
        bytes32 targetHash;
        uint256 sourceHeight;
        uint256 targetHeight;
    }

    struct Validator {
        uint256 deposit;
        uint256 startDynasty;
        uint256 endDynasty;
    }

    struct Withdrawal {
        uint256 amount;
        uint256 allowedFromBlockNumber;
    }

    /* 
    *Mappings
    */
    mapping(bytes32 => Checkpoint) public checkpoints;
    mapping(address => Validator) public validators;
    mapping(uint256 => mapping(address => bool)) public votesAtHeightByVoter; // height => voter => hasVoted
    mapping(address => Vote) public lastVoteByVoter;
    mapping(bytes32 => mapping(bytes32 => uint256)) public checkpointLinkVotingStats; // source => target => validatorsVoted
    mapping(uint256 => int256) public amountStakedByDynasty; // dynasty => amountDeposited
    mapping(address => Withdrawal) public withdrawals;

    /* 
    *Constants
    */
    uint256 public constant MIN_DEPOSIT = 0.01 ether;
    uint256 public constant EPOCH_LENGTH = 100;
    uint256 public constant WITHDRAWAL_DELAY = 21600 * 4; // approximately 21,600 blocks are added to the Ethereum blockchain in a month * 4 months

    /* 
    *State Variables
    */
    bytes32 public latestCheckpointHash;
    uint256 public currentDynasty; // The dynasty of block b is the number of f inalized checkpoints in the chain from root to the parent of block b.
    uint256 public currentEpoch;
    bool public isVotingPeriodOpen;

    /* 
    *Final State Variables
    */
    uint256 public genesisBlockNumber;

    /* 
    *Events
    */
    event ValidatorJoined(address indexed validator, uint256 deposit, uint256 startDynasty);
    event ValidatorLeft(address indexed validator, uint256 endDynasty);
    event CheckpointCreated(bytes32 indexed hash, uint256 height, uint256 dynasty);
    event VoteSubmitted(address indexed validator, bytes32 sourceHash, bytes32 targetHash, uint256 sourceHeight, uint256 targetHeight);
    event CheckpointJustified(bytes32 indexed hash, uint256 height);
    event CheckpointFinalized(bytes32 indexed hash, uint256 height);

    /* 
    *Constructor
    */
    constructor() {
        // explicitly set initial state
        latestCheckpointHash = 0;
        currentDynasty = 0;
        currentEpoch = 0;
        isVotingPeriodOpen = false;

        // genesis checkpoint
        genesisBlockNumber = block.number;
        bytes32 genesisHash = keccak256(abi.encodePacked(genesisBlockNumber));
        createCheckpoint(genesisHash, latestCheckpointHash, true, true, 0);
    }

    /* 
    *External Functions
    */
    function joinValidatorSet() external payable {
        require(msg.value >= MIN_DEPOSIT, "Deposit too low");

        Validator memory maybeValidator = validators[msg.sender];
        require(maybeValidator.deposit == 0 && maybeValidator.startDynasty == 0 && maybeValidator.endDynasty == 0, "Already registered validator");
        
        validators[msg.sender] = Validator({
            deposit: msg.value,
            startDynasty: currentDynasty + 2,
            endDynasty: type(uint256).max
        });
        
        amountStakedByDynasty[currentDynasty + 2] += int256(msg.value);
        emit ValidatorJoined(msg.sender, msg.value, currentDynasty + 2);
    }

    function leaveValidatorSet() external {
        require(isScheduledValidator(msg.sender), "Not a validator");

        Validator storage validator = validators[msg.sender];

        // add to withdrawals waiting list
        withdrawals[msg.sender] = Withdrawal({
            amount: validator.deposit,
            allowedFromBlockNumber: block.number + WITHDRAWAL_DELAY // withdrawal delay (approximately “four months worth of blocks”)
        });

        amountStakedByDynasty[currentDynasty + 2] -= int256(validator.deposit);
        validator.deposit = 0;
        validator.endDynasty = currentDynasty + 2;

        emit ValidatorLeft(msg.sender, currentDynasty + 2);
    }

    // Since only the canonical chain can be accessed from inside a smart contract
    // validators can only vote for the same checkpoints on the canonical chain
    function submitVote(bytes32 _sourceHash, bytes32 _targetHash, uint256 _sourceHeight, uint256 _targetHeight) external {
        // check if voting period is open and validator can vote
        require(isVotingPeriodOpen, "Voting period not open");
        require(isActiveValidator(msg.sender), "Not an active validator");

        // check if source and target heights are valid
        require(_sourceHeight < _targetHeight, "Invalid source and target heights"); // source height should be less than target height
        require(_targetHeight == currentEpoch + 1, "Invalid target height"); // can only select a checkpoint for the next epoch

        // check if source and target hashes are valid
        require(_sourceHash == latestCheckpointHash, "Invalid source checkpoint");
        require(_targetHash == keccak256(abi.encodePacked(getFutureCheckpointBlockNumber())), "Invalid target checkpoint");

        // check if source checkpoint is valid
        require(checkpoints[_sourceHash].isJustified, "Source not justified");
        require(!checkpoints[_sourceHash].isFinalized, "Source already finalized");
        require(checkpoints[_sourceHash].epoch == _sourceHeight, "Invalid source height");
        
        // Check for slashing conditions
        bool hasViolatedHeightCondition = hasVotedAtHeight(msg.sender, _targetHeight);
        bool hasViolatedSpanCondition = hasConflictingVote(msg.sender, _sourceHeight, _targetHeight);
        bool isPenalized = penalizeIfViolated(hasViolatedHeightCondition, hasViolatedSpanCondition);

        // can't use require because it would revert state changes
        if (isPenalized) {
            return;
        }

        // record vote for future checks
        votesAtHeightByVoter[_targetHeight][msg.sender] = true;
        lastVoteByVoter[msg.sender] = Vote({
            sourceHash: _sourceHash,
            targetHash: _targetHash,
            sourceHeight: _sourceHeight,
            targetHeight: _targetHeight
        });

        // update link voting stats
        checkpointLinkVotingStats[_sourceHash][_targetHash] += validators[msg.sender].deposit;

        // Check if link has 2/3 support
        if (checkpointLinkVotingStats[_sourceHash][_targetHash] >= getTwoThirdsStakeForCurrentDynasty()) {
            closeVotingPeriod();

            createCheckpoint(_targetHash, _sourceHash, false, false, _targetHeight);
            currentEpoch++;

            justifyCheckpoint(_targetHash);
            finalizeCheckpoint(_sourceHash);
        }

        emit VoteSubmitted(msg.sender, _sourceHash, _targetHash, _sourceHeight, _targetHeight);
    }

    // every EPOCH_LENGTH blocks run this function
    function openVotingPeriodIfPossible() external {
        uint256 diff = block.number - genesisBlockNumber;
        require(diff >= (currentEpoch + 1) * EPOCH_LENGTH, "Not enough blocks since last checkpoint");
        require(!isVotingPeriodOpen, "Voting period already open");

        // during the first 2 dynasties we don't have any validators that can vote
        // create checkpoints for the first 2 dynasties without voting
        if (currentDynasty < 2) {
            bytes32 targetHash = keccak256(abi.encodePacked(getFutureCheckpointBlockNumber()));
            bytes32 sourceHash = latestCheckpointHash;

            createCheckpoint(targetHash, sourceHash, false, false, currentEpoch + 1);
            currentEpoch++;

            justifyCheckpoint(targetHash);
            
            // don't need to finalize and increment dynasty if source is root
            if (checkpoints[sourceHash].parentHash != 0) { finalizeCheckpoint(sourceHash);}
        } else {
            isVotingPeriodOpen = true;
        }
    }

    function withdrawAfterDelay() external {
        Withdrawal memory withdrawal = withdrawals[msg.sender];
        require(withdrawal.amount > 0, "Nothing to withdraw");
        require(withdrawal.allowedFromBlockNumber <= block.number, "Withdrawal not allowed yet");
        payable(msg.sender).transfer(withdrawal.amount);
        delete withdrawals[msg.sender];
    }

    function getFutureCheckpointBlockNumberPublic() external view returns (uint256) {
        return getFutureCheckpointBlockNumber();
    }

    /* 
    *Internal functions
    */
    function closeVotingPeriod() internal {
        isVotingPeriodOpen = false;
    }

    function isActiveValidator(address _validator) internal view returns (bool) {
        Validator memory validator = validators[_validator];
        return validator.deposit >= MIN_DEPOSIT && validator.startDynasty <= currentDynasty && validator.endDynasty > currentDynasty;
    }

    function isScheduledValidator(address _validator) internal view returns (bool) {
        Validator memory validator = validators[_validator];
        return validator.deposit >= MIN_DEPOSIT && validator.startDynasty > 0 && validator.endDynasty == type(uint256).max;
    }

    function createCheckpoint(bytes32 _hash, bytes32 _parentHash, bool _isJustified, bool _isFinalized, uint256 _epoch) internal {
        checkpoints[_hash] = Checkpoint({
            hash: _hash,
            parentHash: _parentHash,
            isJustified: _isJustified,
            isFinalized: _isFinalized,
            epoch: _epoch
        });

        latestCheckpointHash = _hash;
        
        emit CheckpointCreated(_hash, currentEpoch, currentDynasty);
    }

    // slashing condition "a validator must not publish two distinct votes for the same target height.": h(t1) = h(t2)
    function hasVotedAtHeight(address _validator, uint256 _height) internal view returns (bool) {
        return votesAtHeightByVoter[_height][_validator];
    }

    // slashing condition "a validator must not vote within the span of its other votes": h(s1) < h(s2) < h(t2) < h(t1)
    function hasConflictingVote(address _validator, uint256 _sourceHeight, uint256 _targetHeight) internal view returns (bool) {
        // we remember each validator's last vote only
        Vote memory lastVote = lastVoteByVoter[_validator];
        // h(s1) should be < h(s2) and h(t1) should be < h(t2) or vice versa
        bool option1 = lastVote.sourceHeight > _sourceHeight && lastVote.targetHeight > _targetHeight;
        bool option2 = lastVote.sourceHeight < _sourceHeight && lastVote.targetHeight < _targetHeight;

        if (option1 || option2) { return false; }

        return true;
    }

    function getTwoThirdsStakeForCurrentDynasty() internal view returns (uint256) {
        // can safely cast because amount staked by current dynasty can't be lower than 0, it can be less than zero 0 a future dynasty if a validator left
        return (uint256(amountStakedByDynasty[currentDynasty]) * 2) / 3;
    }

    function justifyCheckpoint(bytes32 _hash) internal {
        checkpoints[_hash].isJustified = true;
        emit CheckpointJustified(_hash, checkpoints[_hash].epoch);
    }

    function finalizeCheckpoint(bytes32 _hash) internal {
        checkpoints[_hash].isFinalized = true;
        emit CheckpointFinalized(_hash, checkpoints[_hash].epoch);

        // move to next dynasty
        amountStakedByDynasty[currentDynasty + 1] = amountStakedByDynasty[currentDynasty] + amountStakedByDynasty[currentDynasty + 1];

        currentDynasty++;
    }

    // there is ony one potential checkpoint block since we can access the canonical chain only
    function getFutureCheckpointBlockNumber() internal view returns (uint256) {
        return (currentEpoch + 1) * EPOCH_LENGTH + genesisBlockNumber;
    }

    function penalizeIfViolated(bool _hasViolatedHeightCondition, bool _hasViolatedSpanCondition) internal returns (bool) {
        if (_hasViolatedHeightCondition || _hasViolatedSpanCondition) {
            // The penalty for violating a rule is a validator’s entire deposit.
            uint256 penalty = validators[msg.sender].deposit;
            validators[msg.sender].deposit = 0;
            amountStakedByDynasty[currentDynasty] -= int256(penalty);
            return true;
        }

        return false;
    }
}
