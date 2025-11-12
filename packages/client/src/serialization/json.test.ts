import { describe, expect, it } from 'vitest';

import { bigintFromJson, bigintToJson, lamportsFromJson, lamportsToJson } from './json';

describe('json serialization helpers', () => {
	it('serializes and parses bigint values', () => {
		expect(bigintToJson(42n)).toBe('42');
		expect(bigintFromJson('42')).toBe(42n);
		expect(bigintFromJson(7)).toBe(7n);
		expect(() => bigintFromJson('abc')).toThrow(/integer string/);
	});

	it('serializes and parses lamports', () => {
		expect(lamportsToJson(10n)).toBe('10');
		expect(lamportsFromJson('10')).toBe(10n);
		expect(() => lamportsFromJson('-5')).toThrow(/non-negative/);
	});
});
