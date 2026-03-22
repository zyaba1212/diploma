import bs58 from 'bs58';
import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

// Must match `docs/stage6.md` and the Anchor program v1 constants.
export const SUBMISSION_PREFIX = 'proposal_submission';
export const DATA_VERSION = 1;
export const SUBMITTED_STATUS = 1;

export function sha256Bytes(input: Uint8Array): Uint8Array {
  const h = createHash('sha256').update(input).digest();
  return new Uint8Array(h);
}

export function sha256Utf8(input: string): Uint8Array {
  return sha256Bytes(new TextEncoder().encode(input));
}

/**
 * Converts a hex/base16 sha256 string (64 hex chars) into raw 32 bytes.
 * Example: "ab12... (64 chars)" => Uint8Array(32)
 */
export function hexSha256ToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length !== 64) {
    throw new Error(`contentHash must be 64 hex chars (32 bytes), got length=${clean.length}`);
  }
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('contentHash must be hex/base16');
  }
  return new Uint8Array(Buffer.from(clean, 'hex'));
}

export function signatureBase58ToSignatureHashBytes(signatureBase58: string): Uint8Array {
  const sigBytes = bs58.decode(signatureBase58);
  if (sigBytes.length !== 64) {
    throw new Error(`ed25519 signature bytes must be 64, got ${sigBytes.length}`);
  }
  return sha256Bytes(sigBytes);
}

/**
 * PDA seed used by the Anchor program:
 * ["proposal_submission", DATA_VERSION=1, proposalIdHash(32 bytes), contentHash(32 bytes)]
 */
export function getProposalSubmissionPda(programId: PublicKey, proposalIdHash: Uint8Array, contentHash: Uint8Array) {
  if (proposalIdHash.length !== 32) throw new Error('proposalIdHash must be 32 bytes');
  if (contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');

  const seeds = [
    Buffer.from(SUBMISSION_PREFIX, 'utf8'),
    Buffer.from([DATA_VERSION]),
    Buffer.from(proposalIdHash),
    Buffer.from(contentHash),
  ];

  return PublicKey.findProgramAddressSync(seeds, programId);
}

