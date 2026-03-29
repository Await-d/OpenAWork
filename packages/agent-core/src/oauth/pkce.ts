import crypto from 'crypto';

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

function toBase64Url(input: Buffer): string {
  return input.toString('base64url');
}

export function generatePKCEChallenge(): PKCEChallenge {
  const codeVerifier = toBase64Url(crypto.randomBytes(64));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

export function generateState(): string {
  return toBase64Url(crypto.randomBytes(32));
}
