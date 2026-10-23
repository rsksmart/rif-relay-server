export const MAX_ESTIMATED_GAS_DEVIATION = 0.2;

/**
 * The highest gasPrice the server ever sends a transaction at, as a multiple
 * of the node's gasPrice. A Rootstock node rejects a transaction priced above
 * 80 times the minimum gas price, and its gasPrice is 1.1 times that minimum,
 * so the cap is about 73 times the node's gasPrice; the margin covers the
 * minimum gas price moving between blocks.
 */
export const MAX_NODE_GAS_PRICE_FACTOR = 50;
