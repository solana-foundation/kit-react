type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function stableStringify(value: unknown): string {
	const result = JSON.stringify(value, (_key, candidate) => {
		if (typeof candidate === 'bigint') {
			return { __type: 'bigint', value: candidate.toString() };
		}
		if (candidate instanceof Uint8Array) {
			return Array.from(candidate);
		}
		return candidate as JsonValue;
	});
	return result ?? 'undefined';
}
