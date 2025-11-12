import { describe, expect, it } from 'vitest';

import { createTokenAmount } from './amounts';
import { createRatio } from './rational';

describe('token amount math', () => {
	const math = createTokenAmount(6);

	it('validates base unit inputs', () => {
		expect(math.decimals).toBe(6);
		expect(math.scale).toBe(1_000_000n);
		expect(math.fromBaseUnits(123_000_000n)).toBe(123_000_000n);
		expect(() => math.fromBaseUnits(-1n)).toThrow(/non-negative/);
	});

	it('parses decimal strings and numbers respecting rounding', () => {
		expect(math.fromDecimal('1.234567')).toBe(1_234_567n);
		expect(math.fromDecimal(1.5)).toBe(1_500_000n);
		expect(math.fromDecimal('1.23456789', { rounding: 'floor' })).toBe(1_234_567n);
		expect(math.fromDecimal('1.23456789', { rounding: 'ceil' })).toBe(1_234_568n);
		expect(math.fromDecimal('1.23456789', { rounding: 'round' })).toBe(1_234_568n);
		expect(() => math.fromDecimal('-1')).toThrow();
	});

	it('adds, subtracts, compares, and multiplies by ratios', () => {
		const lhs = math.fromDecimal('2');
		const rhs = math.fromDecimal('1');
		expect(math.add(lhs, rhs)).toBe(math.fromDecimal('3'));
		expect(math.subtract(lhs, rhs)).toBe(math.fromDecimal('1'));
		expect(() => math.subtract(rhs, lhs)).toThrow(/non-negative/);
		expect(math.compare(lhs, rhs)).toBe(1);
		expect(math.compare(rhs, rhs)).toBe(0);
		expect(math.compare(rhs, lhs)).toBe(-1);

		const ratio = createRatio(1, 2);
		expect(math.multiplyByRatio(math.fromDecimal('4'), ratio)).toBe(math.fromDecimal('2'));
	});

	it('formats amounts according to options', () => {
		const amount = math.fromDecimal('1.230000');
		expect(math.toDecimalString(amount)).toBe('1.23');
		expect(math.toDecimalString(amount, { trimTrailingZeros: false })).toBe('1.230000');
		expect(math.toDecimalString(amount, { minimumFractionDigits: 4 })).toBe('1.2300');
		const zeroDecimalsMath = createTokenAmount(0);
		expect(zeroDecimalsMath.toDecimalString(12n)).toBe('12');
	});

	it('flags zero values appropriately', () => {
		expect(math.isZero(0n)).toBe(true);
		expect(math.isZero(1n)).toBe(false);
	});
});
