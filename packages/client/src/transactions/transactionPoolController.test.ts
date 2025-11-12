import { describe, expect, test, vi } from 'vitest';

import type { TransactionHelper, TransactionInstructionInput, TransactionPrepared } from '../features/transactions';
import { createTransactionPoolController, type LatestBlockhashCache } from './transactionPoolController';

function createHelper(overrides: Partial<TransactionHelper> = {}): TransactionHelper {
	const prepared: TransactionPrepared = {
		commitment: 'processed',
		feePayer: {} as TransactionPrepared['feePayer'],
		instructions: [],
		lifetime: { blockhash: 'blockhash', lastValidBlockHeight: 1n },
		message: {} as TransactionPrepared['message'],
		mode: 'send',
		version: 0,
	};
	return {
		prepare: vi.fn().mockResolvedValue(prepared),
		prepareAndSend: vi.fn().mockResolvedValue('sig-prep-send'),
		send: vi.fn().mockResolvedValue('sig-send'),
		sign: vi.fn(),
		toWire: vi.fn(),
		...(overrides as TransactionHelper),
	} as TransactionHelper;
}

describe('createTransactionPoolController', () => {
	const instruction = {} as TransactionInstructionInput;

	test('mutates the instruction set', () => {
		const controller = createTransactionPoolController({
			helper: createHelper(),
			initialInstructions: [],
		});
		controller.addInstruction(instruction);
		expect(controller.getInstructions()).toHaveLength(1);
		controller.clearInstructions();
		expect(controller.getInstructions()).toHaveLength(0);
	});

	test('prepares transactions with cached lifetime', async () => {
		const helper = createHelper();
		const controller = createTransactionPoolController({
			blockhashMaxAgeMs: 50_000,
			helper,
			initialInstructions: [instruction],
		});
		const cache: LatestBlockhashCache = {
			updatedAt: Date.now(),
			value: { blockhash: 'cache', lastValidBlockHeight: 2n },
		};
		controller.setLatestBlockhashCache(cache);
		await controller.prepare();
		expect(helper.prepare).toHaveBeenCalledWith(
			expect.objectContaining({
				lifetime: cache.value,
			}),
		);
	});

	test('send throws when no prepared transaction exists', async () => {
		const controller = createTransactionPoolController({
			helper: createHelper(),
			initialInstructions: [instruction],
		});
		await expect(controller.send()).rejects.toThrow(/Prepare a transaction/);
	});

	test('prepareAndSend reuses cached instructions', async () => {
		const helper = createHelper();
		const controller = createTransactionPoolController({
			helper,
			initialInstructions: [instruction],
		});
		await controller.prepareAndSend();
		expect(helper.prepareAndSend).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: controller.getInstructions(),
			}),
			undefined,
		);
	});
});
