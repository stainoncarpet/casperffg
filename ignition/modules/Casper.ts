import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CasperModule = buildModule("CasperModule", (m) => {
  const casper = m.contract("CasperFFG");

  return { casper };
});

module.exports = CasperModule;