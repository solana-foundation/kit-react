import type {
	Base64EncodedWireTransaction,
	Transaction,
	TransactionMessage,
	TransactionMessageWithFeePayer,
} from '@solana/kit';
import {
	compileTransaction,
	getBase64EncodedWireTransaction,
	partiallySignTransactionMessageWithSigners,
} from '@solana/kit';

type Base64ConvertibleTransaction = (TransactionMessage & TransactionMessageWithFeePayer) | Transaction;

/**
 * Serializes a transaction message or fully signed transaction to a base64-encoded wire format string.
 */
export function transactionToBase64(tx: Base64ConvertibleTransaction): Base64EncodedWireTransaction {
	if ('messageBytes' in tx) {
		return getBase64EncodedWireTransaction(tx);
	}
	return getBase64EncodedWireTransaction(compileTransaction(tx));
}

/**
 * Serializes a transaction after ensuring all attached signers have produced signatures.
 */
export async function transactionToBase64WithSigners(
	tx: Base64ConvertibleTransaction,
): Promise<Base64EncodedWireTransaction> {
	if ('messageBytes' in tx) {
		return transactionToBase64(tx);
	}
	const signed = await partiallySignTransactionMessageWithSigners(tx);
	return transactionToBase64(signed);
}
