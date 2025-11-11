import { address } from '@solana/kit';
import { describe, expect, test } from 'vitest';

import { toAddress, toAddressString } from './addressLike';

describe('addressLike', () => {
	test('parses string addresses', () => {
		const value = toAddress('11111111111111111111111111111111');
		expect(value.toString()).toBe('11111111111111111111111111111111');
	});

	test('returns the same Address instances', () => {
		const existing = address('SysvarRent111111111111111111111111111111111');
		expect(toAddress(existing)).toBe(existing);
	});

	test('stringifies addresses', () => {
		expect(toAddressString('11111111111111111111111111111111')).toBe('11111111111111111111111111111111');
	});
});
