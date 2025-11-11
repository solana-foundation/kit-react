import { describe, expect, it } from 'vitest';

import { applyRatio, createRatio } from './rational';

describe('ratio helpers', () => {
	it('creates immutable ratios with validation', () => {
		const ratio = createRatio(2, 5);
		expect(ratio).toEqual({ numerator: 2n, denominator: 5n });
		expect(Object.isFrozen(ratio)).toBe(true);
	});

	it('rejects invalid ratio inputs', () => {
		expect(() => createRatio(-1, 2)).toThrow(/numerator/);
		expect(() => createRatio(1, 0)).toThrow(/positive/);
		expect(() => createRatio(1, -3)).toThrow(/positive/);
	});

	it('applies ratios with different rounding strategies', () => {
		const ratio = createRatio(1, 3);
		expect(applyRatio(9n, ratio)).toBe(3n);
		expect(applyRatio(10n, ratio)).toBe(3n);
		expect(applyRatio(10n, ratio, { rounding: 'ceil' })).toBe(4n);
		expect(applyRatio(10n, ratio, { rounding: 'round' })).toBe(3n);
		expect(applyRatio(11n, ratio, { rounding: 'round' })).toBe(4n);
		expect(() => applyRatio(-1n, ratio)).toThrow(/amount/);
	});
});
