import { describe, expect, test, vi } from 'vitest';

import { createSolTransferController, type SolTransferInput } from './solTransferController';

type MockSignature = `sig-${string}`;

function createHelper() {
	return {
		sendTransfer: vi
			.fn<[SolTransferInput & { authority: never }], Promise<MockSignature>>()
			.mockResolvedValue('sig-1'),
	} as unknown as Parameters<typeof createSolTransferController>[0]['helper'];
}

describe('createSolTransferController', () => {
	test('throws when no authority is available', async () => {
		const helper = createHelper();
		const controller = createSolTransferController({ helper });
		await expect(
			controller.send({
				amount: 1n,
				authority: undefined,
				destination: '11111111111111111111111111111111',
			} as SolTransferInput),
		).rejects.toThrow(/authority/);
	});

	test('falls back to authority provider', async () => {
		const helper = createHelper();
		const authority = {} as SolTransferInput['authority'];
		const controller = createSolTransferController({
			authorityProvider: () => authority,
			helper,
		});
		await controller.send({
			amount: 1n,
			destination: '11111111111111111111111111111111',
		} as SolTransferInput);
		expect(helper.sendTransfer).toHaveBeenCalled();
	});

	test('transitions state on success and reset', async () => {
		const helper = createHelper();
		const controller = createSolTransferController({
			authorityProvider: () => ({}) as SolTransferInput['authority'],
			helper,
		});
		const snapshots: string[] = [];
		const unsubscribe = controller.subscribe(() => {
			snapshots.push(controller.getState().status);
		});
		await controller.send({
			amount: 1n,
			destination: '11111111111111111111111111111111',
		} as SolTransferInput);
		controller.reset();
		unsubscribe();
		expect(snapshots).toEqual(['loading', 'success', 'idle']);
	});
});
