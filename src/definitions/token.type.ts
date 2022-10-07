import { Token } from '@rsksmart/rif-relay-common';
import BigNumber from 'bignumber.js';

type ExchangeToken = Token & {
    xRate?: BigNumber;
    amount?: BigNumber;
};

export default ExchangeToken;
