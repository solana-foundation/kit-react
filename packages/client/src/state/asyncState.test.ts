import { describe, expect, test } from 'vitest';

import { createAsyncState, createInitialAsyncState } from './asyncState';

describe('asyncState', () => {
	test('creates an idle state by default', () => {
		expect(createInitialAsyncState()).toEqual({ status: 'idle' });
	});

	test('creates a loading state with payload', () => {
		const state = createAsyncState('loading', { data: 'value' });
		expect(state).toEqual({ data: 'value', status: 'loading' });
	});

	test('preserves error payload', () => {
		const error = new Error('boom');
		const state = createAsyncState('error', { error });
		expect(state).toEqual({ error, status: 'error' });
	});
});
