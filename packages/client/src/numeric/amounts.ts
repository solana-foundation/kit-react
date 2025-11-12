import {
	assertDecimals,
	assertNonNegative,
	type BigintLike,
	checkedAdd,
	checkedSubtract,
	pow10,
	toBigint,
} from './math';
import { type ApplyRatioOptions, applyRatio, type Ratio, type RoundingMode } from './rational';

export type ParseAmountOptions = Readonly<{
	label?: string;
	rounding?: RoundingMode;
}>;

export type FormatAmountOptions = Readonly<{
	minimumFractionDigits?: number;
	trimTrailingZeros?: boolean;
}>;

export type TokenAmountMath = Readonly<{
	add(lhs: bigint, rhs: bigint): bigint;
	compare(lhs: bigint, rhs: bigint): number;
	decimals: number;
	fromBaseUnits(value: BigintLike, label?: string): bigint;
	fromDecimal(value: number | string, options?: ParseAmountOptions): bigint;
	isZero(amount: bigint): boolean;
	multiplyByRatio(amount: bigint, ratio: Ratio, options?: ApplyRatioOptions): bigint;
	scale: bigint;
	subtract(lhs: bigint, rhs: bigint): bigint;
	toDecimalString(amount: bigint, options?: FormatAmountOptions): string;
}>;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * Normalizes number inputs by validating precision limitations and returning a string representation.
 *
 * @param value - Decimal number provided by the caller.
 * @param decimals - Token decimal precision used to validate fractional digits.
 * @param label - Label used in thrown error messages.
 * @returns A string representation that avoids scientific notation.
 */
function normalizeNumberInput(value: number, decimals: number, label: string): string {
	if (!Number.isFinite(value)) {
		throw new RangeError(`${label} must be a finite number`);
	}
	if (Number.isInteger(value)) {
		return value.toString(10);
	}
	const stringValue = value.toString(10);
	if (stringValue.includes('e') || stringValue.includes('E')) {
		throw new RangeError(`${label} cannot use exponential notation; provide a string instead`);
	}
	const parts = stringValue.split('.');
	if (parts[1] && parts[1].length > decimals + 6) {
		// Safety guard: floating point precision might be insufficient.
		throw new RangeError(`${label} exceeds safe precision; provide a string instead`);
	}
	return stringValue;
}

/**
 * Converts a decimal string into base units while respecting rounding preferences.
 *
 * @param value - Decimal string to convert.
 * @param decimals - Token decimal precision.
 * @param scale - Precomputed scale equal to 10^decimals.
 * @param options - Rounding and labelling options.
 * @returns Bigint representing the value in base units.
 */
function decimalToBaseUnits(value: string, decimals: number, scale: bigint, options: ParseAmountOptions): bigint {
	const label = options.label ?? 'value';
	const rounding = options.rounding ?? 'floor';
	const sanitized = value.replace(/_/g, '').trim();
	if (sanitized === '') {
		throw new SyntaxError(`${label} must not be empty`);
	}
	if (!DECIMAL_PATTERN.test(sanitized)) {
		throw new SyntaxError(`${label} must be a non-negative decimal string`);
	}
	const [integerPartRaw, fractionalRaw] = sanitized.split('.');
	const integerPart = integerPartRaw || '0';
	assertNonNegative(BigInt(integerPart), label);
	let result = BigInt(integerPart) * scale;

	const fractionalDigits = fractionalRaw ?? '';
	if (decimals === 0) {
		if (fractionalDigits.length === 0) {
			return result;
		}
		const hasFractional = /[1-9]/.test(fractionalDigits);
		if (rounding === 'ceil' && hasFractional) {
			return result + 1n;
		}
		if (rounding === 'round' && fractionalDigits[0] !== undefined && fractionalDigits[0] >= '5') {
			return result + 1n;
		}
		return result;
	}

	const truncatedFractional = fractionalDigits.slice(0, decimals).padEnd(decimals, '0');
	const fractionalComponent = truncatedFractional === '' ? 0n : BigInt(truncatedFractional);
	result += fractionalComponent;

	if (fractionalDigits.length > decimals) {
		const remainderDigits = fractionalDigits.slice(decimals);
		const hasRemainder = /[1-9]/.test(remainderDigits);
		if (rounding === 'ceil' && hasRemainder) {
			result += 1n;
		} else if (rounding === 'round') {
			const firstRemainderDigit = remainderDigits[0];
			if (firstRemainderDigit !== undefined && firstRemainderDigit >= '5') {
				result += 1n;
			}
		}
	}

	return result;
}

/**
 * Formats a base-unit amount into a human-friendly decimal string.
 *
 * @param amount - Value in base units.
 * @param decimals - Token decimal precision.
 * @param scale - Precomputed scale equal to 10^decimals.
 * @param options - Formatting preferences.
 * @returns A decimal string suitable for display.
 */
function formatBaseUnits(amount: bigint, decimals: number, scale: bigint, options: FormatAmountOptions): string {
	assertNonNegative(amount, 'amount');
	const minimumFractionDigits = options.minimumFractionDigits ?? 0;
	if (minimumFractionDigits < 0 || minimumFractionDigits > decimals) {
		throw new RangeError('minimumFractionDigits must be between 0 and the token decimals');
	}
	const trimTrailingZeros = options.trimTrailingZeros ?? true;
	if (decimals === 0) {
		return amount.toString();
	}
	const whole = amount / scale;
	let fraction = (amount % scale).toString().padStart(decimals, '0');
	if (trimTrailingZeros) {
		fraction = fraction.replace(/0+$/, '');
	}
	if (fraction.length < minimumFractionDigits) {
		fraction = fraction.padEnd(minimumFractionDigits, '0');
	}
	if (fraction.length === 0) {
		return whole.toString();
	}
	return `${whole.toString()}.${fraction}`;
}

/**
 * Factory that returns integer-safe helpers for working with token amounts across arbitrary decimals.
 *
 * @param decimals - Token decimal precision (0-38) used to scale values.
 * @returns Helper collection for conversions and arithmetic over bigint amounts.
 */
export function createTokenAmount(decimals: number): TokenAmountMath {
	assertDecimals(decimals, 'decimals');
	const scale = pow10(decimals);

	/**
	 * Converts a base-unit value into bigint after validation.
	 *
	 * @param value - Integer-like representation of the amount.
	 * @param label - Optional label used in error messages.
	 * @returns Bigint representation of the base units.
	 */
	function fromBaseUnits(value: BigintLike, label?: string): bigint {
		const amount = toBigint(value, label ?? 'amount');
		assertNonNegative(amount, label ?? 'amount');
		return amount;
	}

	/**
	 * Parses user-provided decimal inputs into base units.
	 *
	 * @param value - Decimal number or string representing the token amount.
	 * @param options - Optional rounding and labelling configuration.
	 * @returns Bigint amount scaled into base units.
	 */
	function fromDecimal(value: number | string, options: ParseAmountOptions = {}): bigint {
		const label = options.label ?? 'value';
		if (typeof value === 'number') {
			if (Number.isInteger(value)) {
				if (!Number.isSafeInteger(value)) {
					throw new RangeError(`${label} must be within the safe integer range when provided as a number`);
				}
				return fromBaseUnits(BigInt(value) * scale, label);
			}
			if (decimals === 0) {
				throw new RangeError(`${label} cannot include fractional digits for a token with 0 decimals`);
			}
			const normalized = normalizeNumberInput(value, decimals, label);
			return decimalToBaseUnits(normalized, decimals, scale, options);
		}
		return decimalToBaseUnits(value, decimals, scale, options);
	}

	/**
	 * Formats a base-unit amount into a decimal display string.
	 *
	 * @param amount - Integer amount expressed in base units.
	 * @param options - Formatting preferences for the output string.
	 * @returns Decimal string representation of the amount.
	 */
	function toDecimalString(amount: bigint, options: FormatAmountOptions = {}): string {
		return formatBaseUnits(fromBaseUnits(amount), decimals, scale, options);
	}

	/**
	 * Adds two base-unit amounts while preventing negative results.
	 *
	 * @param lhs - First operand in base units.
	 * @param rhs - Second operand in base units.
	 * @returns Sum of the operands.
	 */
	function add(lhs: bigint, rhs: bigint): bigint {
		return checkedAdd(fromBaseUnits(lhs), fromBaseUnits(rhs));
	}

	/**
	 * Subtracts two base-unit amounts while preventing negative results.
	 *
	 * @param lhs - First operand in base units.
	 * @param rhs - Second operand in base units.
	 * @returns Difference of the operands.
	 */
	function subtract(lhs: bigint, rhs: bigint): bigint {
		return checkedSubtract(fromBaseUnits(lhs), fromBaseUnits(rhs));
	}

	/**
	 * Applies a ratio to a base-unit amount.
	 *
	 * @param amount - Base amount to scale.
	 * @param ratio - Ratio produced by {@link createRatio}.
	 * @param options - Optional rounding configuration.
	 * @returns Scaled bigint amount.
	 */
	function multiplyByRatio(amount: bigint, ratio: Ratio, options?: ApplyRatioOptions): bigint {
		return applyRatio(fromBaseUnits(amount), ratio, options);
	}

	/**
	 * Returns whether the supplied base-unit amount is zero.
	 *
	 * @param amount - Amount to test for zero.
	 * @returns `true` when the amount equals zero.
	 */
	function isZero(amount: bigint): boolean {
		return fromBaseUnits(amount) === 0n;
	}

	/**
	 * Compares two base-unit amounts.
	 *
	 * @param lhs - First operand in base units.
	 * @param rhs - Second operand in base units.
	 * @returns `1`, `0`, or `-1` depending on the comparison result.
	 */
	function compare(lhs: bigint, rhs: bigint): number {
		const left = fromBaseUnits(lhs);
		const right = fromBaseUnits(rhs);
		if (left > right) {
			return 1;
		}
		if (left < right) {
			return -1;
		}
		return 0;
	}

	return Object.freeze({
		add,
		compare,
		decimals,
		fromBaseUnits,
		fromDecimal,
		isZero,
		multiplyByRatio,
		scale,
		subtract,
		toDecimalString,
	});
}
