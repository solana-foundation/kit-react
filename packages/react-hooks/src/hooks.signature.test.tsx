// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createSignature } from '../test/fixtures';
import { act, renderHookWithClient, waitFor } from '../test/utils';

import { useSignatureStatus, useWaitForSignature } from './hooks';

describe('useSignatureStatus', () => {
	it('fetches the signature status via RPC', async () => {
		const signature = createSignature(1);
		const { client, result } = renderHookWithClient(() => useSignatureStatus(signature));

		await waitFor(() => expect(result.current.signatureStatus).not.toBeUndefined());
		expect(client.runtime.rpc.getSignatureStatuses).toHaveBeenCalledWith([signature.toString()], undefined);
		expect(result.current.confirmationStatus).toBe('processed');
	});

	it('stays idle when no signature is provided', () => {
		const { client, result } = renderHookWithClient(() => useSignatureStatus());
		expect(client.runtime.rpc.getSignatureStatuses).not.toHaveBeenCalled();
		expect(result.current.status).toBe('idle');
	});
});

describe('useWaitForSignature', () => {
	it('resolves when the RPC status reaches the desired commitment', async () => {
		const signature = createSignature(2);
		const { client, result } = renderHookWithClient(() => useWaitForSignature(signature, { subscribe: false }));

		expect(result.current.waitStatus).toBe('waiting');

		client.runtime.rpc.getSignatureStatuses.mockReturnValueOnce({
			send: vi.fn(async () => ({
				context: { slot: 0n },
				value: [
					{
						confirmationStatus: 'confirmed',
						confirmations: 1,
						err: null,
						slot: 1n,
					},
				],
			})),
		} as never);

		await act(async () => {
			await result.current.refresh();
		});

		await waitFor(() => expect(result.current.waitStatus).toBe('success'));
	});

	it('reports signature errors surfaced by RPC', async () => {
		const signature = createSignature(3);
		const { client, result } = renderHookWithClient(() => useWaitForSignature(signature, { subscribe: false }));

		client.runtime.rpc.getSignatureStatuses.mockReturnValueOnce({
			send: vi.fn(async () => ({
				context: { slot: 0n },
				value: [
					{
						confirmationStatus: 'processed',
						confirmations: 0,
						err: { InstructionError: [0, 'Custom'] },
						slot: 1n,
					},
				],
			})),
		} as never);

		await act(async () => {
			await result.current.refresh();
		});

		await waitFor(() => expect(result.current.waitStatus).toBe('error'));
		expect(result.current.waitError).toEqual({ InstructionError: [0, 'Custom'] });
	});
});
