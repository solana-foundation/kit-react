import { describe, expect, it, vi } from 'vitest';

import { deepFreeze, now, toErrorMessage } from './utils';

describe('utility helpers', () => {
	it('deepFreeze recursively freezes objects', () => {
		const input = { nested: { value: 1 } };
		const frozen = deepFreeze(input);
		expect(Object.isFrozen(frozen)).toBe(true);
		expect(Object.isFrozen(frozen.nested)).toBe(true);
		expect(frozen.nested.value).toBe(1);
	});

	it('now delegates to Date.now', () => {
		vi.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
		expect(now()).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
		vi.useRealTimers();
	});

	it('formats error messages', () => {
		expect(toErrorMessage(new Error('oops'))).toBe('oops');
		expect(toErrorMessage('plain')).toBe('plain');
		expect(toErrorMessage({ foo: 'bar' })).toBe('{"foo":"bar"}');
		const circular: { self?: unknown } = {};
		circular.self = circular;
		expect(toErrorMessage(circular)).toBe('[object Object]');
	});
});
