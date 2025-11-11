import { describe, expect, it } from 'vitest';

import { LAMPORTS_PER_SOL, lamports, lamportsFromSol, lamportsMath, lamportsToSolString } from './lamports';
import { createRatio } from './rational';

describe('lamport helpers', () => {
	it('normalizes lamport inputs', () => {
		expect(lamports(10n)).toBe(10n);
		expect(lamports(10)).toBe(10n);
		expect(lamports('10')).toBe(10n);
		expect(() => lamports('-1')).toThrow(/non-negative/);
	});

	it('converts between SOL and lamports', () => {
		expect(LAMPORTS_PER_SOL).toBe(1_000_000_000n);
		expect(lamportsFromSol('1.5')).toBe(1_500_000_000n);
		expect(lamportsToSolString(500_000_000n)).toBe('0.5');
	});

	it('provides math utilities around lamports', () => {
		const ratio = createRatio(1, 2);
		expect(lamportsMath.add(1n, 2n)).toBe(3n);
		expect(lamportsMath.subtract(5n, 2n)).toBe(3n);
		expect(() => lamportsMath.subtract(1n, 5n)).toThrow(/non-negative/);
		expect(lamportsMath.multiplyByRatio(4n, ratio)).toBe(2n);
		expect(lamportsMath.compare(2n, 3n)).toBe(-1);
		expect(lamportsMath.isZero(0n)).toBe(true);
	});
});
