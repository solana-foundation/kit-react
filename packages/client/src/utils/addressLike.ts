import { type Address, address as parseAddress } from '@solana/kit';

export type AddressLike = Address | string;

export function toAddress(addressLike: AddressLike): Address {
	return typeof addressLike === 'string' ? parseAddress(addressLike) : addressLike;
}

export function toAddressString(addressLike: AddressLike): string {
	return toAddress(addressLike).toString();
}
