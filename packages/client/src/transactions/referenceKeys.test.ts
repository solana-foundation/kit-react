import type { Address, BaseTransactionMessage } from '@solana/kit';
import { AccountRole } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { insertReferenceKey, insertReferenceKeys } from './referenceKeys';

function createTransaction(instructions: BaseTransactionMessage['instructions']): BaseTransactionMessage {
	return {
		instructions: Object.freeze(instructions),
	};
}

const TARGET_PROGRAM = 'ProgramAddress1111111111111111111111111111111' as Address;

describe('reference key helpers', () => {
	it('appends a single reference to the first non-memo instruction', () => {
		const transaction = createTransaction([
			{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', data: new Uint8Array(), accounts: [] },
			{ programAddress: TARGET_PROGRAM, data: new Uint8Array(), accounts: [] },
		]);
		const reference = 'Ref11111111111111111111111111111111111111' as Address;
		const updated = insertReferenceKey(reference, transaction);
		expect(updated.instructions[1]?.accounts).toEqual([{ address: reference, role: AccountRole.READONLY }]);
		expect(updated).not.toBe(transaction);
	});

	it('appends multiple references to the first non-memo instruction', () => {
		const transaction = createTransaction([
			{ programAddress: TARGET_PROGRAM, data: new Uint8Array(), accounts: [] },
		]);
		const references = [
			'Ref11111111111111111111111111111111111111' as Address,
			'Ref22222222222222222222222222222222222222' as Address,
		];
		const updated = insertReferenceKeys(references, transaction);
		expect(updated.instructions[0]?.accounts).toEqual(
			references.map((address) => ({ address, role: AccountRole.READONLY })),
		);
	});

	it('throws when no non-memo instruction exists', () => {
		const transaction = createTransaction([
			{ programAddress: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', data: new Uint8Array(), accounts: [] },
		]);
		expect(() => insertReferenceKey('Ref11111111111111111111111111111111111111' as Address, transaction)).toThrow();
	});
});
