import Joi, { CustomHelpers } from 'joi';
import { utils, Wallet } from 'ethers';

const MAX_POSSIBLE_PORT_NUMBER = 65535;

const isBigNumberish: Joi.CustomValidator = (
  value: string,
  helpers: CustomHelpers
) => {
  //Some values are automatically translated to their numeric representation (i.e. 1e3 to 1000)
  //Here we need to put them back to their original representation, since strings like 1e3 are invalid
  //BigNumber strings and fails at runtime
  value = helpers.original as string;

  //Taken directly from ethers library https://github.com/ethers-io/ethers.js/blob/f97b92bbb1bde22fcc44100af78d7f31602863ab/packages/bignumber/src.ts/bignumber.ts#L28
  const isValidBigNumberRepresentation =
    value != null &&
    ((typeof value === 'number' && value % 1 === 0) ||
      (typeof value === 'string' && !!value.match(/^-?[0-9]+$/)) ||
      utils.isHexString(value) ||
      typeof value === 'bigint' ||
      utils.isBytes(value));

  if (!isValidBigNumberRepresentation) {
    throw new Error(`Invalid BigNumber string representation: ${value}`);
  }

  return value;
};

const isAddress: Joi.CustomValidator = (value: string) => {
  if (!utils.isAddress(value)) {
    throw new Error(`Invalid address: ${value}`);
  }

  return value;
};

const isValidPK: Joi.CustomValidator = (value: string) => {
  try {
    new Wallet(value);
  } catch (e) {
    throw new Error(`Invalid PK: ${value}`);
  }
};

const isValidMnemonic: Joi.CustomValidator = (value: string) => {
  try {
    Wallet.fromMnemonic(value);
  } catch (e) {
    throw new Error(`Invalid Mnemonic: ${value.toString()}`);
  }
};

const appSchema = Joi.object({
  url: Joi.string().uri().required(),
  port: Joi.number().required().max(MAX_POSSIBLE_PORT_NUMBER).min(0),
  workdir: Joi.string().required(),
  devMode: Joi.boolean().optional(),
  customReplenish: Joi.boolean().optional(),
  logLevel: Joi.optional(),
  checkInterval: Joi.number().min(0).required(),
  readyTimeout: Joi.number().min(0).required(),
  transferFeePercentage: Joi.number().optional(),
  gasFeePercentage: Joi.number().optional(),
  fixedUsdFee: Joi.number().optional(),
  disableSponsoredTx: Joi.boolean().required(),
  sponsoredDestinations: Joi.array().items(Joi.string().custom(isAddress)),
  requestMinValidSeconds: Joi.number().min(0).required(),
});

const blockchainSchema = Joi.object({
  rskNodeUrl: Joi.string().uri().required(),
  gasPriceFactor: Joi.number().required(),
  registrationBlockRate: Joi.number().min(0).required(),
  alertedBlockDelay: Joi.number().min(0).required(),
  minAlertedDelayMS: Joi.number().min(0).required(),
  maxAlertedDelayMS: Joi.number().min(0).required(),
  workerMinBalance: Joi.number().unsafe().custom(isBigNumberish),
  workerTargetBalance: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  managerMinBalance: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  managerMinStake: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  managerTargetBalance: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  minHubWithdrawalBalance: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  refreshStateTimeoutBlocks: Joi.number().min(0).required(),
  pendingTransactionTimeoutBlocks: Joi.number().min(0).required(),
  successfulRoundsForReady: Joi.number().min(0).required(),
  confirmationsNeeded: Joi.number().min(0).required(),
  retryGasPriceFactor: Joi.number().min(0).required(),
  maxGasPrice: Joi.number().min(0).unsafe().custom(isBigNumberish).required(),
  defaultGasLimit: Joi.number()
    .min(0)
    .unsafe()
    .custom(isBigNumberish)
    .required(),
  estimateGasFactor: Joi.number().min(0).required(),
});

const contractsSchema = Joi.object({
  relayHubAddress: Joi.string().custom(isAddress).required(),
  deployVerifierAddress: Joi.string().custom(isAddress).required(),
  relayVerifierAddress: Joi.string().custom(isAddress).required(),
  feesReceiver: Joi.string().custom(isAddress).optional(),
  trustedVerifiers: Joi.array()
    .items(Joi.string().custom(isAddress))
    .optional(),
});

const registerSchema = Joi.object({
  stake: Joi.number().min(0).required(),
  funds: Joi.number().min(0).required(),
  mnemonic: Joi.string().allow('').custom(isValidMnemonic).optional(),
  privateKey: Joi.string().allow('').custom(isValidPK).optional(),
  relayHub: Joi.string().allow('').custom(isAddress).optional(),
  gasPrice: Joi.number().min(1).unsafe().custom(isBigNumberish).required(),
  unstakeDelay: Joi.number().min(0).required(),
});

export const serverConfigSchema = Joi.object({
  app: appSchema,
  blockchain: blockchainSchema,
  contracts: contractsSchema,
  register: registerSchema,
});
