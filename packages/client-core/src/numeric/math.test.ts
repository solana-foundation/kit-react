import { describe, expect, it } from 'vitest';

import {
	assertDecimals,
	assertNonNegative,
	checkedAdd,
	checkedDivide,
	checkedMultiply,
	checkedSubtract,
	pow10,
	toBigint,
} from './math';

describe('math utilities', () => {
	it('pow10 returns expected powers of ten', () => {
		expect(pow10(0)).toBe(1n);
		expect(pow10(3)).toBe(1000n);
	});

	it('pow10 throws on invalid exponent', () => {
		expect(() => pow10(-1)).toThrow(/exponent/);
		expect(() => pow10(39)).toThrow(/exponent/);
	});

	it('assertNonNegative enforces positive values', () => {
		expect(() => assertNonNegative(-1n)).toThrow(/non-negative/);
		expect(assertNonNegative(0n)).toBeUndefined();
		expect(assertNonNegative(42n)).toBeUndefined();
	});

	it('assertDecimals validates range and integer-ness', () => {
		expect(() => assertDecimals(1.5)).toThrow(/integer/);
		expect(() => assertDecimals(-1)).toThrow(/integer/);
		expect(() => assertDecimals(40)).toThrow(/integer/);
		expect(assertDecimals(9)).toBeUndefined();
	});

	it('toBigint converts supported inputs', () => {
		expect(toBigint(123n)).toBe(123n);
		expect(toBigint(123)).toBe(123n);
		expect(toBigint('456')).toBe(456n);
		expect(() => toBigint('12.5')).toThrow(/integer string/);
		expect(() => toBigint('abc')).toThrow(/integer string/);
		expect(() => toBigint(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
		expect(() => toBigint(1.1)).toThrow(/finite integer/);
	});

	it('checked addition/subtraction/multiplication/division reject negatives', () => {
		expect(checkedAdd(10n, 5n)).toBe(15n);
		expect(checkedSubtract(10n, 5n)).toBe(5n);
		expect(checkedMultiply(3n, 4n)).toBe(12n);
		expect(checkedDivide(10n, 2n)).toBe(5n);

		expect(() => checkedSubtract(5n, 10n)).toThrow(/non-negative/);
		expect(() => checkedMultiply(-1n, 2n)).toThrow(/non-negative/);
		expect(() => checkedDivide(5n, 0n)).toThrow(/non-zero/);
	});
});
