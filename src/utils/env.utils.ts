import { z } from 'zod';

const envSchema = z.object({
	VITE_API_URL: z.string().default('http://localhost:4000/api/v1'),
	VITE_PRIVY_APP_ID: z.string().default(''),
	VITE_STELLAR_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
	VITE_STELLAR_TESTNET_PASSPHRASE: z.string().default('Test SDF Network ; September 2015'),
	VITE_STELLAR_MAINNET_PASSPHRASE: z.string().default('Public Global Stellar Network ; September 2015'),
});

export const env = envSchema.parse({
	VITE_API_URL: import.meta.env.VITE_API_URL,
	VITE_PRIVY_APP_ID: import.meta.env.VITE_PRIVY_APP_ID,
	VITE_STELLAR_NETWORK: import.meta.env.VITE_STELLAR_NETWORK,
	VITE_STELLAR_TESTNET_PASSPHRASE: import.meta.env.VITE_STELLAR_TESTNET_PASSPHRASE,
	VITE_STELLAR_MAINNET_PASSPHRASE: import.meta.env.VITE_STELLAR_MAINNET_PASSPHRASE,
});
