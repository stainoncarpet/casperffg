import * as ethers from "ethers";

/// Put the next checkpoint block number in here
const nextCheckpointBlockNumber = 424;
const nextCheckpointBlockHash = ethers.solidityPackedKeccak256(["uint256"], [nextCheckpointBlockNumber]);
console.log(nextCheckpointBlockHash);