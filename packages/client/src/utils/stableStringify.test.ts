import { describe, expect, test } from 'vitest';

import { stableStringify } from './stableStringify';

describe('stableStringify', () => {
	test('serializes bigint values', () => {
		expect(stableStringify({ value: 1n })).toBe('{"value":{"__type":"bigint","value":"1"}}');
	});

	test('serializes Uint8Array values', () => {
		expect(stableStringify(new Uint8Array([1, 2, 3]))).toBe('[1,2,3]');
	});

	test('falls back to undefined string', () => {
		expect(stableStringify(undefined)).toBe('undefined');
	});
});
