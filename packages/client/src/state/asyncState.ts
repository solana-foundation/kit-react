export type AsyncStatus = 'error' | 'idle' | 'loading' | 'success';

export type AsyncState<T> = Readonly<{
	data?: T;
	error?: unknown;
	status: AsyncStatus;
}>;

export function createInitialAsyncState<T>(): AsyncState<T> {
	return { status: 'idle' };
}

export function createAsyncState<T>(
	status: AsyncStatus,
	payload: Readonly<{ data?: T; error?: unknown }> = {},
): AsyncState<T> {
	return {
		data: payload.data,
		error: payload.error,
		status,
	};
}
