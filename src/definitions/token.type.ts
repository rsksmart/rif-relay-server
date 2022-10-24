import { ERC20Token } from '@rsksmart/rif-relay-common';
import BigNumber from 'bignumber.js';

type ExchangeToken = ERC20Token & {
    xRate?: BigNumber;
    amount?: BigNumber;
};

export default ExchangeToken;
