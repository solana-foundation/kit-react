import type { Lamports } from '@solana/kit';

import { createTokenAmount, type FormatAmountOptions, type ParseAmountOptions, type TokenAmountMath } from './amounts';
import type { ApplyRatioOptions, Ratio } from './rational';

const BASE_LAMPORTS = createTokenAmount(9);

export const LAMPORTS_PER_SOL = BASE_LAMPORTS.scale;

export type LamportsMath = Readonly<{
	add(lhs: Lamports, rhs: Lamports): Lamports;
	compare(lhs: Lamports, rhs: Lamports): number;
	decimals: number;
	fromLamports(value: bigint | number | string, label?: string): Lamports;
	fromSol(value: number | string, options?: ParseAmountOptions): Lamports;
	isZero(amount: Lamports): boolean;
	multiplyByRatio(amount: Lamports, ratio: Ratio, options?: ApplyRatioOptions): Lamports;
	raw: TokenAmountMath;
	scale: bigint;
	subtract(lhs: Lamports, rhs: Lamports): Lamports;
	toSolString(amount: Lamports, options?: FormatAmountOptions): string;
}>;

/**
 * Typed helpers for working with lamport-denominated values.
 */
export const lamportsMath: LamportsMath = Object.freeze({
	/**
	 * Adds two lamport amounts.
	 *
	 * @param lhs - First lamport operand.
	 * @param rhs - Second lamport operand.
	 * @returns Sum as lamports.
	 */
	add(lhs, rhs) {
		return BASE_LAMPORTS.add(lhs, rhs) as Lamports;
	},
	/**
	 * Compares two lamport amounts.
	 *
	 * @param lhs - First lamport operand.
	 * @param rhs - Second lamport operand.
	 * @returns `1`, `0`, or `-1` corresponding to the comparison result.
	 */
	compare(lhs, rhs) {
		return BASE_LAMPORTS.compare(lhs, rhs);
	},
	decimals: BASE_LAMPORTS.decimals,
	/**
	 * Validates and converts raw lamport inputs.
	 *
	 * @param value - Integer-like lamport amount.
	 * @param label - Optional label used for error reporting.
	 * @returns Normalized lamport bigint.
	 */
	fromLamports(value, label) {
		return BASE_LAMPORTS.fromBaseUnits(value, label) as Lamports;
	},
	/**
	 * Converts SOL denominated values into lamports.
	 *
	 * @param value - Decimal representation of SOL.
	 * @param options - Optional rounding and labelling configuration.
	 * @returns Lamport amount.
	 */
	fromSol(value, options) {
		return BASE_LAMPORTS.fromDecimal(value, options) as Lamports;
	},
	/**
	 * Determines whether a lamport amount equals zero.
	 *
	 * @param amount - Lamports to inspect.
	 * @returns `true` when the amount is zero.
	 */
	isZero(amount) {
		return BASE_LAMPORTS.isZero(amount);
	},
	/**
	 * Applies a ratio to lamports.
	 *
	 * @param amount - Lamport amount to scale.
	 * @param ratio - Ratio produced by {@link createRatio}.
	 * @param options - Optional rounding configuration.
	 * @returns Scaled lamport amount.
	 */
	multiplyByRatio(amount, ratio, options) {
		return BASE_LAMPORTS.multiplyByRatio(amount, ratio, options) as Lamports;
	},
	raw: BASE_LAMPORTS,
	scale: BASE_LAMPORTS.scale,
	/**
	 * Subtracts two lamport amounts.
	 *
	 * @param lhs - First lamport operand.
	 * @param rhs - Second lamport operand.
	 * @returns Difference as lamports.
	 */
	subtract(lhs, rhs) {
		return BASE_LAMPORTS.subtract(lhs, rhs) as Lamports;
	},
	/**
	 * Formats lamports into a human-readable SOL string.
	 *
	 * @param amount - Lamport amount to format.
	 * @param options - Formatting preferences.
	 * @returns SOL string representation.
	 */
	toSolString(amount, options) {
		return BASE_LAMPORTS.toDecimalString(amount, options);
	},
});

/**
 * Shortcut for constructing lamport values from base units.
 *
 * @param value - Integer-like lamport amount.
 * @param label - Optional label used for error reporting.
 * @returns Normalized lamport bigint.
 */
export function lamports(value: bigint | number | string, label?: string): Lamports {
	return lamportsMath.fromLamports(value, label);
}

/**
 * Converts an SOL-denominated value into lamports.
 *
 * @param value - Decimal representation of SOL.
 * @param options - Optional rounding and labelling configuration.
 * @returns Lamport amount.
 */
export function lamportsFromSol(value: number | string, options?: ParseAmountOptions): Lamports {
	return lamportsMath.fromSol(value, options);
}

/**
 * Converts lamports into a human-readable SOL string.
 *
 * @param amount - Lamport amount to format.
 * @param options - Formatting preferences.
 * @returns SOL string representation.
 */
export function lamportsToSolString(amount: Lamports, options?: FormatAmountOptions): string {
	return lamportsMath.toSolString(amount, options);
}
