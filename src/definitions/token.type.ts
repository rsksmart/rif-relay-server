import type { ERC20 } from '@rsksmart/rif-relay-contracts';

declare type ExchangeToken = {
  instance: ERC20;
  name: string;
  symbol: string;
  decimals: number;

  xRate?: string;
  amount?: string;
};

export default ExchangeToken;
