import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		environmentMatchGlobs: [
			['packages/react-hooks/**', 'jsdom'],
			['examples/**', 'jsdom'],
		],
		include: ['{packages,examples}/**/*.{test,spec}.{ts,tsx}'],
		setupFiles: './vitest.setup.ts',
		passWithNoTests: true,
		coverage: {
			reporter: ['text', 'lcov'],
			reportsDirectory: './coverage',
			include: ['packages/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}'],
		},
	},
});
