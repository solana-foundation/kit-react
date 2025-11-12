import { type Commitment, signature as parseSignature, type Signature } from '@solana/kit';

export type SignatureLike = Signature | string;

export type ConfirmationCommitment = Extract<Commitment, 'confirmed' | 'finalized' | 'processed'>;

export type SignatureStatusLike = Readonly<{
	confirmationStatus?: ConfirmationCommitment | null;
	confirmations?: number | bigint | null;
}> | null;

const COMMITMENT_PRIORITY: Record<ConfirmationCommitment, number> = {
	processed: 0,
	confirmed: 1,
	finalized: 2,
};

export const SIGNATURE_STATUS_TIMEOUT_MS = 20_000;

export function normalizeSignature(input?: SignatureLike): Signature | undefined {
	if (!input) {
		return undefined;
	}
	return typeof input === 'string' ? parseSignature(input) : input;
}

export function deriveConfirmationStatus(status: SignatureStatusLike): ConfirmationCommitment | null {
	if (!status) {
		return null;
	}
	if (
		status.confirmationStatus === 'processed' ||
		status.confirmationStatus === 'confirmed' ||
		status.confirmationStatus === 'finalized'
	) {
		return status.confirmationStatus;
	}
	if (status.confirmations === null) {
		return 'finalized';
	}
	if (typeof status.confirmations === 'number' && status.confirmations > 0) {
		return 'confirmed';
	}
	return 'processed';
}

export function confirmationMeetsCommitment(
	confirmation: ConfirmationCommitment | null,
	target: ConfirmationCommitment,
): boolean {
	if (!confirmation) {
		return false;
	}
	return COMMITMENT_PRIORITY[confirmation] >= COMMITMENT_PRIORITY[target];
}
