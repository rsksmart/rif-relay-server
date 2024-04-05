export function queryVerifiers(
  verifier: string | undefined,
  verifiers: Set<string>
) {
  // if no verifier was supplied, query all trusted verifiers
  if (!verifier) {
    return Array.from(verifiers);
  }

  // if a verifier was supplied, check that it is trusted
  if (!verifiers.has(verifier.toLowerCase())) {
    throw new Error('Supplied verifier is not trusted');
  }

  return [verifier];
}

export default queryVerifiers;
