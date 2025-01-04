import { JsonRpcProvider } from 'ethers';

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

// Connect to the Ethereum network
const provider = new JsonRpcProvider("https://eth-sepolia.g.alchemy.com/v2/" + ALCHEMY_API_KEY);

// Get block by number
const blockNumber = "latest";
const block = await provider.getBlock(blockNumber);

console.log(block);