import type { Address, Commitment, SendableTransaction, Signature, Transaction } from '@solana/kit';

export type WalletConnectorMetadata = Readonly<{
	canAutoConnect?: boolean;
	icon?: string;
	id: string;
	name: string;
}>;

export type WalletAccount = Readonly<{
	address: Address;
	label?: string;
	publicKey: Uint8Array;
}>;

export type WalletSession = Readonly<{
	account: WalletAccount;
	connector: WalletConnectorMetadata;
	disconnect(): Promise<void>;
	sendTransaction?(
		transaction: SendableTransaction & Transaction,
		config?: Readonly<{ commitment?: Commitment }>,
	): Promise<Signature>;
	signMessage?(message: Uint8Array): Promise<Uint8Array>;
	signTransaction?(transaction: SendableTransaction & Transaction): Promise<SendableTransaction & Transaction>;
}>;

export type WalletConnector = WalletConnectorMetadata & {
	connect(opts?: Readonly<{ autoConnect?: boolean }>): Promise<WalletSession>;
	disconnect(): Promise<void>;
	isSupported(): boolean;
};

type WalletStatusConnected = Readonly<{
	connectorId: string;
	session: WalletSession;
	status: 'connected';
}>;

type WalletStatusConnecting = Readonly<{
	connectorId: string;
	status: 'connecting';
}>;

type WalletStatusDisconnected = Readonly<{
	status: 'disconnected';
}>;

type WalletStatusError = Readonly<{
	connectorId?: string;
	error: unknown;
	status: 'error';
}>;

export type WalletStatus =
	| WalletStatusConnected
	| WalletStatusConnecting
	| WalletStatusDisconnected
	| WalletStatusError;

export type WalletRegistry = Readonly<{
	all: readonly WalletConnector[];
	get(id: string): WalletConnector | undefined;
}>;
