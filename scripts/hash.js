import * as ethers from "ethers";

/// Put the next checkpoint block number in here
const nextCheckpointBlockNumber = 432;
const nextCheckpointBlockHash = ethers.solidityPackedKeccak256(["uint256"], [nextCheckpointBlockNumber]);
console.log(nextCheckpointBlockHash);