import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, formatError, isLevelAtLeast } from './logger';

describe('logger utilities', () => {
	const consoleSpies: Record<string, ReturnType<typeof vi.spyOn>> = {};

	beforeEach(() => {
		consoleSpies.error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		consoleSpies.warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		consoleSpies.info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
		consoleSpies.debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
	});

	afterEach(() => {
		for (const spy of Object.values(consoleSpies)) {
			spy.mockRestore();
		}
	});

	it('returns injected logger when provided', () => {
		const custom = vi.fn();
		const logger = createLogger(custom);
		logger({ level: 'info', message: 'msg' });
		expect(custom).toHaveBeenCalledWith({ level: 'info', message: 'msg' });
	});

	it('falls back to console logging', () => {
		const logger = createLogger();
		logger({ level: 'error', message: 'fail', data: { detail: 1 } });
		logger({ level: 'warn', message: 'warn', data: { detail: 2 } });
		logger({ level: 'info', message: 'info', data: { detail: 3 } });
		logger({ level: 'debug', message: 'debug', data: { detail: 4 } });

		expect(consoleSpies.error).toHaveBeenCalledWith('[react-core] fail', { detail: 1 });
		expect(consoleSpies.warn).toHaveBeenCalledWith('[react-core] warn', { detail: 2 });
		expect(consoleSpies.info).toHaveBeenCalledWith('[react-core] info', { detail: 3 });
		expect(consoleSpies.debug).toHaveBeenCalledWith('[react-core] debug', { detail: 4 });
	});

	it('formats errors', () => {
		const error = new Error('boom');
		expect(formatError(error)).toEqual({ error, message: 'boom' });
	});

	it('evaluates severity thresholds', () => {
		expect(isLevelAtLeast('error', 'warn')).toBe(true);
		expect(isLevelAtLeast('debug', 'info')).toBe(false);
	});
});
