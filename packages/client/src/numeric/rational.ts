import { assertNonNegative, type BigintLike, toBigint } from './math';

export type RoundingMode = 'ceil' | 'floor' | 'round';

export type Ratio = Readonly<{
	denominator: bigint;
	numerator: bigint;
}>;

/**
 * Divides two bigint values while applying the requested rounding strategy.
 *
 * @param dividend - Value to be divided.
 * @param divisor - Value to divide by; must be positive.
 * @param rounding - Rounding strategy to apply when a remainder exists.
 * @returns Quotient adjusted for rounding.
 */
function divideWithRounding(dividend: bigint, divisor: bigint, rounding: RoundingMode): bigint {
	if (divisor <= 0n) {
		throw new RangeError('divisor must be positive');
	}
	const base = dividend / divisor;
	const remainder = dividend % divisor;
	if (remainder === 0n) {
		return base;
	}
	switch (rounding) {
		case 'ceil':
			return base + 1n;
		case 'round': {
			const twice = remainder * 2n;
			return twice >= divisor ? base + 1n : base;
		}
		default:
			return base;
	}
}

/**
 * Creates a ratio used for slippage, fee, or percentage calculations.
 *
 * @param numeratorInput - Numerator part of the ratio; must be non-negative.
 * @param denominatorInput - Denominator part of the ratio; must be positive.
 * @returns Immutable ratio descriptor.
 */
export function createRatio(numeratorInput: BigintLike, denominatorInput: BigintLike): Ratio {
	const numerator = toBigint(numeratorInput, 'numerator');
	const denominator = toBigint(denominatorInput, 'denominator');
	if (denominator <= 0n) {
		throw new RangeError('denominator must be positive');
	}
	assertNonNegative(numerator, 'numerator');
	return Object.freeze({ denominator, numerator });
}

export type ApplyRatioOptions = Readonly<{
	rounding?: RoundingMode;
}>;

/**
 * Multiplies an integer amount by the provided ratio using the requested rounding strategy.
 *
 * @param amount - Base amount to scale; must be non-negative.
 * @param ratio - Ratio produced by {@link createRatio}.
 * @param options - Optional rounding configuration.
 * @returns Scaled amount as a bigint.
 */
export function applyRatio(amount: bigint, ratio: Ratio, options: ApplyRatioOptions = {}): bigint {
	assertNonNegative(amount, 'amount');
	const dividend = amount * ratio.numerator;
	const rounding = options.rounding ?? 'floor';
	return divideWithRounding(dividend, ratio.denominator, rounding);
}
