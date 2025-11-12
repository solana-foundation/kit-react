import type { SolanaClient } from '@solana/client';
import type { RenderHookOptions, RenderHookResult, RenderOptions } from '@testing-library/react';
import { act, render as rtlRender, renderHook as rtlRenderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { SolanaClientProvider } from '../src/context';
import { SolanaQueryProvider } from '../src/QueryProvider';
import { createMockSolanaClient, type MockSolanaClient, type MockSolanaClientOptions } from './mocks';

type ClientConfig = Readonly<{
	client?: MockSolanaClient;
	clientOptions?: MockSolanaClientOptions;
}>;

type TestProviderProps = Readonly<{
	children: ReactNode;
	client: SolanaClient;
}>;

function resolveClient(options?: ClientConfig): MockSolanaClient {
	if (options?.client) {
		return options.client;
	}
	return createMockSolanaClient(options?.clientOptions);
}

export function TestSolanaClientProvider({ children, client }: TestProviderProps) {
	return (
		<SolanaClientProvider client={client}>
			<SolanaQueryProvider>{children}</SolanaQueryProvider>
		</SolanaClientProvider>
	);
}

type RenderWithClientOptions = Omit<RenderOptions, 'wrapper'> & ClientConfig;

export function renderWithClient(ui: ReactElement, options: RenderWithClientOptions = {}) {
	const { client: providedClient, clientOptions, ...renderOptions } = options;
	const client = resolveClient({ client: providedClient, clientOptions });
	const Wrapper = ({ children }: { children: ReactNode }) => (
		<TestSolanaClientProvider client={client}>{children}</TestSolanaClientProvider>
	);
	const result = rtlRender(ui, { wrapper: Wrapper, ...renderOptions });
	return { client, ...result };
}

type RenderHookWithClientOptions<Props> = Omit<RenderHookOptions<Props>, 'wrapper'> & ClientConfig;

export function renderHookWithClient<Result, Props>(
	callback: (props: Props) => Result,
	options: RenderHookWithClientOptions<Props> = {},
): RenderHookResult<Result, Props> & { client: MockSolanaClient } {
	const { client: providedClient, clientOptions, ...hookOptions } = options;
	const client = resolveClient({ client: providedClient, clientOptions });
	function Wrapper({ children }: { children: ReactNode }) {
		return <TestSolanaClientProvider client={client}>{children}</TestSolanaClientProvider>;
	}
	const result = rtlRenderHook(callback, {
		wrapper: Wrapper,
		...hookOptions,
	});
	return { client, ...result };
}

export { act, screen, waitFor, within };
export { default as userEvent } from '@testing-library/user-event';
