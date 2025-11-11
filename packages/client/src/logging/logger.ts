import type { ClientLogger, LogLevel } from '../types';
import { toErrorMessage } from '../utils';

const defaultLevels: Record<LogLevel, number> = {
	debug: 10,
	error: 40,
	info: 20,
	warn: 30,
};

/**
 * Creates a logger function that falls back to console logging when no custom logger is provided.
 *
 * @param logger - Optional logger implementation supplied by the integrator.
 * @returns A {@link ClientLogger} instance ready for dependency injection.
 */
export function createLogger(logger?: ClientLogger): ClientLogger {
	if (logger) {
		return logger;
	}
	return ({ data, level, message }) => {
		const payload: Record<string, unknown> = data ? { ...data } : {};
		switch (level) {
			case 'error':
				console.error(`[react-core] ${message}`, payload);
				break;
			case 'warn':
				console.warn(`[react-core] ${message}`, payload);
				break;
			case 'info':
				console.info(`[react-core] ${message}`, payload);
				break;
			default:
				console.debug(`[react-core] ${message}`, payload);
		}
	};
}

/**
 * Formats an error into a structured payload for logging.
 *
 * @param error - Arbitrary error value that will be recorded.
 * @returns Serializable shape containing the original error and message.
 */
export function formatError(error: unknown): Record<string, unknown> {
	return {
		error,
		message: toErrorMessage(error),
	};
}

/**
 * Returns whether the provided log level is at least as severe as the threshold.
 *
 * @param level - Log level to evaluate.
 * @param threshold - Minimum severity level that should pass.
 * @returns `true` when the level meets or exceeds the threshold.
 */
export function isLevelAtLeast(level: LogLevel, threshold: LogLevel): boolean {
	return defaultLevels[level] >= defaultLevels[threshold];
}
