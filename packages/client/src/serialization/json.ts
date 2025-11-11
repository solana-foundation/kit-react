import type { Lamports } from '@solana/kit';

import { lamports } from '../numeric/lamports';
import { type BigintLike, toBigint } from '../numeric/math';

/**
 * Serializes a bigint to its decimal string representation for JSON payloads.
 *
 * @param value - Bigint value to serialize.
 * @returns Decimal string representation suitable for JSON.
 */
export function bigintToJson(value: bigint): string {
	return value.toString();
}

/**
 * Parses a bigint-compatible JSON value.
 *
 * @param value - JSON value that should contain an integer string or number.
 * @returns Parsed bigint.
 */
export function bigintFromJson(value: BigintLike): bigint {
	return toBigint(value, 'bigint');
}

/**
 * Serializes lamports to a string since JSON cannot encode bigint directly.
 *
 * @param value - Lamport amount to serialize.
 * @returns Decimal string representation of the lamport amount.
 */
export function lamportsToJson(value: Lamports): string {
	return value.toString();
}

/**
 * Parses a lamport value from JSON primitives.
 *
 * @param value - JSON value containing an integer string or number.
 * @returns Parsed lamport amount.
 */
export function lamportsFromJson(value: BigintLike): Lamports {
	return lamports(value, 'lamports');
}
