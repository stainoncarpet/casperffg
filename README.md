# Casper the Friendly Finality Gadget

This smart contract is a simplified implementation of the ideas described in a research paper titled "Casper the Friendly Finality Gadget."
The contract is written in Solidity. Hardhat, Ethers, Mocha, and Chai are used for testing and deployment.

## Run tests:

1. *npx hardhat test test/Casper.ts*
2. *REPORT_GAS=true npx hardhat test*
3. *npx hardhat coverage*

## Set ALCHEMY_API_KEY and SEPOLIA_PRIVATE_KEY environment variables:

Configuration variables are stored in plain text on disk. Avoid using this feature for data you wouldn’t normally save in an unencrypted file. Run *npx hardhat vars path* to find the storage's file location.
1. *npx hardhat vars set ALCHEMY_API_KEY*
2. *npx hardhat vars set SEPOLIA_PRIVATE_KEY*
3. *npx hardhat vars list*

## Run the ping script:

To run this script, create a .env file with ALCHEMY_API_KEY and SEPOLIA_PRIVATE_KEY in the project folder.
1. *node --env-file=.env scripts/ping.js*

## Deployment:

To deploy the contract run either of the two options (locally or to testnet).
1. *npx hardhat node && npx hardhat ignition deploy ./ignition/modules/Casper.ts --network localhost*
2. *npx hardhat ignition deploy ./ignition/modules/Casper.ts --network sepolia --deployment-id casperffg-sepolia-deployment*

## Verification:

Add another environment variable: ETHERSCAN_API_KEY in a similar fashion and run the following commands.
1. *npx hardhat vars set ETHERSCAN_API_KEY*
2. *npx hardhat ignition verify casperffg-sepolia-deployment*