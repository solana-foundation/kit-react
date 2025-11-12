import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: [
			{
				find: '@solana/client-poc',
				replacement: '@solana/client',
			},
		],
	},
	optimizeDeps: {
		include: ['@solana/client', '@solana/react-hooks'],
	},
	server: {
		host: '0.0.0.0',
		port: 5174,
	},
});
