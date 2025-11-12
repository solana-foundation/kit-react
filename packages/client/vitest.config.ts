import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config';

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			include: ['src/**/*.{test,spec}.{ts,tsx}'],
			coverage: {
				include: ['src/**/*.{ts,tsx}'],
				reportsDirectory: '../../coverage/client',
			},
		},
	}),
);
