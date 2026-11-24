# AGENTS.md

Context for agents working in this repository. Product overview lives in `README.md`.

## Commands

- `pnpm dev` — Vite (`vite --host`), default port 5173.
- `pnpm build` — `tsc -b && vite build`.
- `npx tsc --noEmit -p tsconfig.app.json` — typecheck without emitting.
- `pnpm lint` — ESLint.

## Environment

- `VITE_API_URL` is the backend base URL used by `src/services/api.service.ts` and every derived service. Locally it points at `http://localhost:4000/api/v1`.
- `VITE_BACKEND_URL` is unused by the swap service; kept for other callers.
- `VITE_STELLAR_NETWORK` (`testnet` default), `VITE_STELLAR_TESTNET_PASSPHRASE`, and `VITE_STELLAR_MAINNET_PASSPHRASE` come from `.env` through `src/utils/env.utils.ts`; the service uses the passphrases to validate Freighter and sign.
- The backend allows `http://localhost:5173` via CORS.

## API conventions

- Backend nodes return `{ success: boolean, data: T, message: string }`. `BaseApiService` does not unwrap this envelope, so callers read `response.data.data`.
- Axios errors from nodes put the human message in `response.data.message` (not `.error`). Services should extract `message` (string or array) before falling back to a generic error.
- Local catalog agents are served from `GET /api/v1/agents/explore` (auth required) and carry `image_url`; node icons live in `public/icons/agents/` and are referenced as absolute URLs built from the backend `FRONTEND_URL`.

## Stellar swap integration

`src/services/stellar-swap.service.ts` backs `src/components/shared/StellarSwapModal.tsx` and talks to the Soroswap node, not to the old wallet routes.

- `quote()` calls `POST /soroswap/build` with `{ address, fromAsset, toAsset, amount, slippageBps }` and maps the response:
  - `network` → `network` and `networkPassphrase` (from `VITE_STELLAR_{TESTNET,MAINNET}_PASSPHRASE`).
  - `xdr` → `unsignedXdr`; `quote.expectedOut` → `amountOut` (human units); `quote.minimumReceived`, `quote.priceImpactPct`.
- `signAndSubmit()` checks Freighter's passphrase, signs, then calls `POST /soroswap/submit` with `{ xdr }` and returns `data.txHash`.
- A 500 from `/soroswap/build` usually means the wallet lacks a trustline for the output asset or lacks XLM for fees; the service surfaces that hint.

## Assets

- Agent icons are SVGs in `public/icons/agents/`: `soroswap.svg` (official mark) and `defindex.svg` (mark extracted from the official lockup).
