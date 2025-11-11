export type BigintLike = bigint | number | string;

const TEN = 10n;

/**
 * Raises 10 to the power of the provided non-negative integer exponent.
 *
 * @param exponent - Exponent that must be between 0 and 38 inclusive.
 * @returns Power-of-ten bigint value.
 */
export function pow10(exponent: number): bigint {
	assertDecimals(exponent, 'exponent');
	return TEN ** BigInt(exponent);
}

/**
 * Ensures the provided bigint is not negative.
 *
 * @param value - Bigint value to validate.
 * @param label - Optional label used in error messages.
 * @throws When the value is negative.
 */
export function assertNonNegative(value: bigint, label = 'value'): void {
	if (value < 0n) {
		throw new RangeError(`${label} must be non-negative`);
	}
}

/**
 * Ensures the provided decimals value is a safe non-negative integer within typical SPL limits.
 *
 * @param decimals - Decimal precision to validate.
 * @param label - Optional label used in error messages.
 * @throws When the value is not an integer between 0 and 38 inclusive.
 */
export function assertDecimals(decimals: number, label = 'decimals'): void {
	if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
		throw new RangeError(`${label} must be an integer between 0 and 38`);
	}
}

/**
 * Converts supported numeric inputs into bigint while enforcing integer semantics.
 *
 * @param value - Integer-like value to convert.
 * @param label - Optional label used in error messages.
 * @returns Bigint representation of the supplied value.
 * @throws When the input is not a finite integer.
 */
export function toBigint(value: BigintLike, label = 'value'): bigint {
	if (typeof value === 'bigint') {
		return value;
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || !Number.isInteger(value)) {
			throw new RangeError(`${label} must be a finite integer when provided as a number`);
		}
		if (!Number.isSafeInteger(value)) {
			throw new RangeError(`${label} must be within the safe integer range when provided as a number`);
		}
		return BigInt(value);
	}
	const trimmed = value.trim();
	const match = /^[-+]?\d+$/.exec(trimmed);
	if (!match) {
		throw new SyntaxError(`${label} must be an integer string`);
	}
	return BigInt(match[0]);
}

/**
 * Adds two bigint values while enforcing non-negative outputs.
 *
 * @param lhs - Left-hand side operand.
 * @param rhs - Right-hand side operand.
 * @param label - Optional label used in error messages.
 * @returns Sum of the operands.
 * @throws When the result is negative.
 */
export function checkedAdd(lhs: bigint, rhs: bigint, label = 'result'): bigint {
	const result = lhs + rhs;
	assertNonNegative(result, label);
	return result;
}

/**
 * Subtracts two bigint values, throwing if the operation would go negative.
 *
 * @param lhs - Left-hand side operand.
 * @param rhs - Right-hand side operand.
 * @param label - Optional label used in error messages.
 * @returns Difference of the operands.
 * @throws When the result is negative.
 */
export function checkedSubtract(lhs: bigint, rhs: bigint, label = 'result'): bigint {
	const result = lhs - rhs;
	assertNonNegative(result, label);
	return result;
}

/**
 * Multiplies two bigint values and ensures the result is non-negative.
 *
 * @param lhs - Left-hand side operand.
 * @param rhs - Right-hand side operand.
 * @param label - Optional label used in error messages.
 * @returns Product of the operands.
 * @throws When the result is negative.
 */
export function checkedMultiply(lhs: bigint, rhs: bigint, label = 'result'): bigint {
	const result = lhs * rhs;
	assertNonNegative(result, label);
	return result;
}

/**
 * Performs integer division and verifies that the divisor is non-zero and the result is non-negative.
 *
 * @param dividend - Value to be divided.
 * @param divisor - Value to divide by.
 * @param label - Optional label used in error messages.
 * @returns Quotient of the division.
 * @throws When the divisor is zero or the result is negative.
 */
export function checkedDivide(dividend: bigint, divisor: bigint, label = 'result'): bigint {
	if (divisor === 0n) {
		throw new RangeError('divisor must be non-zero');
	}
	const result = dividend / divisor;
	assertNonNegative(result, label);
	return result;
}
