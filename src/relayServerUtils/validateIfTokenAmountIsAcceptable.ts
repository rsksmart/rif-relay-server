import type { BigNumber } from 'ethers';
import log from 'loglevel';
import { INSUFFICIENT_TOKEN_AMOUNT } from '../definitions/errorMessages.const';
import type { AppConfig } from '../ServerConfigParams';
import type { HttpEnvelopingRequest } from '../definitions';
import { isSponsorshipAllowed } from './isSponsorshipAllowed';
import convertTokenToGas from './convertTokenToGas';

export async function validateIfTokenAmountIsAcceptable(
  maxPossibleGas: BigNumber,
  envelopingTransaction: HttpEnvelopingRequest,
  appConfig: AppConfig
) {
  if (isSponsorshipAllowed(envelopingTransaction.relayRequest, appConfig)) {
    return;
  }

  const { request, relayData } = envelopingTransaction.relayRequest;

  const tokenContract = request.tokenContract;
  const tokenAmount = request.tokenAmount;
  const gasPrice = relayData.gasPrice;

  const tokenAmountInGas = await convertTokenToGas(
    tokenAmount,
    tokenContract,
    gasPrice
  );

  const isTokenAmountAcceptable = tokenAmountInGas.isGreaterThanOrEqualTo(
    maxPossibleGas.toString()
  );

  log.debug(
    'TokenAmount in gas agreed by the user',
    tokenAmountInGas.toString()
  );
  log.debug(
    'MaxPossibleGas including fees required by the transaction',
    maxPossibleGas.toString()
  );
  log.debug('RequestFees - isTokenAmountAcceptable? ', isTokenAmountAcceptable);

  if (!isTokenAmountAcceptable) {
    throw new Error(INSUFFICIENT_TOKEN_AMOUNT);
  }
}

export default validateIfTokenAmountIsAcceptable;
