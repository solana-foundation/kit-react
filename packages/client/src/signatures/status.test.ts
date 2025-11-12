import { describe, expect, test } from 'vitest';

import {
	confirmationMeetsCommitment,
	deriveConfirmationStatus,
	normalizeSignature,
	type SignatureStatusLike,
} from './status';

describe('signature status helpers', () => {
	test('normalizes string signatures', () => {
		const fakeSignature = '2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2';
		expect(normalizeSignature(fakeSignature)?.toString()).toBe(fakeSignature);
	});

	test('derives confirmation from confirmationStatus field', () => {
		const status: SignatureStatusLike = { confirmationStatus: 'confirmed' };
		expect(deriveConfirmationStatus(status)).toBe('confirmed');
	});

	test('derives confirmation from confirmations count', () => {
		const status: SignatureStatusLike = { confirmations: 2 };
		expect(deriveConfirmationStatus(status)).toBe('confirmed');
	});

	test('derives finalized when confirmations null', () => {
		const status: SignatureStatusLike = { confirmations: null };
		expect(deriveConfirmationStatus(status)).toBe('finalized');
	});

	test('checks commitment priority', () => {
		expect(confirmationMeetsCommitment('finalized', 'processed')).toBe(true);
		expect(confirmationMeetsCommitment('processed', 'confirmed')).toBe(false);
	});
});
