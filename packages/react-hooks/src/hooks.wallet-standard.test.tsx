// @vitest-environment jsdom

import type { WalletConnector } from '@solana/client';
import { getWalletStandardConnectors, watchWalletStandardConnectors } from '@solana/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWalletSession } from '../test/fixtures';
import { act, renderHookWithClient } from '../test/utils';

import { useWalletStandardConnectors } from './hooks';

let currentConnectors: WalletConnector[] = [];
const unsubscribe = vi.fn();
let emitConnectors: ((connectors: readonly WalletConnector[]) => void) | undefined;

vi.mock('@solana/client', async () => {
	const actual = await vi.importActual<typeof import('@solana/client')>('@solana/client');
	return {
		...actual,
		getWalletStandardConnectors: vi.fn(() => currentConnectors),
		watchWalletStandardConnectors: vi.fn((onChange: typeof emitConnectors, _options?: unknown) => {
			emitConnectors = onChange;
			return unsubscribe;
		}),
	};
});

const mockedGet = vi.mocked(getWalletStandardConnectors);
const mockedWatch = vi.mocked(watchWalletStandardConnectors);

function createConnector(id: string): WalletConnector {
	return {
		canAutoConnect: true,
		connect: vi.fn(async () => createWalletSession({ connector: { id, name: `Wallet ${id}` } })),
		disconnect: vi.fn(async () => undefined),
		id,
		isSupported: vi.fn(() => true),
		name: `Wallet ${id}`,
	};
}

describe('useWalletStandardConnectors', () => {
	beforeEach(() => {
		currentConnectors = [createConnector('wallet-a'), createConnector('wallet-b')];
		unsubscribe.mockReset();
		mockedGet.mockClear();
		mockedWatch.mockClear();
	});

	it('loads and updates the connector list, cleaning up on unmount', () => {
		const { result, unmount } = renderHookWithClient(() => useWalletStandardConnectors());

		expect(result.current).toEqual(currentConnectors);
		expect(mockedGet).toHaveBeenCalledTimes(2);
		expect(mockedWatch).toHaveBeenCalledWith(expect.any(Function), {});

		const nextConnectors = [createConnector('wallet-c')];
		act(() => {
			emitConnectors?.(nextConnectors);
		});

		expect(result.current).toEqual(nextConnectors);

		unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('forwards discovery overrides to Wallet Standard helpers', () => {
		const overrides = { iconOverrides: true };
		renderHookWithClient(() => useWalletStandardConnectors({ overrides }));

		expect(mockedGet).toHaveBeenCalledWith({ overrides });
		expect(mockedWatch).toHaveBeenCalledWith(expect.any(Function), { overrides });
	});
});
