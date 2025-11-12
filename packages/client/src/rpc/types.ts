type SolanaRpcInstance = ReturnType<typeof import('@solana/kit')['createSolanaRpc']>;
type SolanaSubscriptionsInstance = ReturnType<typeof import('@solana/kit')['createSolanaRpcSubscriptions']>;

export type SolanaClientRuntime = {
	rpc: SolanaRpcInstance;
	rpcSubscriptions: SolanaSubscriptionsInstance;
};
