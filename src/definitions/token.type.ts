import BigNumber from 'bignumber.js';

type Token = {
    name: string;
    decimals: number;
    contractAddress: string;
    xRate?: BigNumber;
    amount?: BigNumber;
};

export default Token;
