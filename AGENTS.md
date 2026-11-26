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

## Workflow automation

`WorkflowAutomationModal` (`src/components/editor/WorkflowAutomationModal.tsx`) is backed by the backend schedule/trigger routes.

- Schedules are non-custodial and funded by a one-time token allowance ("sign once"), not escrow — there is no deposit/withdraw. Creating one is a four-call, two-signature flow: `buildSchedule()` returns `{ approvalXdr, commitmentHash, nextRun, intervalSeconds, feeStroops, allowanceCapStroops, allowanceExpiresAt, ... }`; the modal signs `approvalXdr` and calls `submitAllowanceApproval()`; only once that's confirmed on-chain can `buildScheduleCreate()` build the job-creation XDR (Soroban must simulate `create` against a real allowance, so this can't happen earlier); the modal signs that and calls `confirmSchedule()`. After setup, the keeper runs the job with zero further owner signatures until the allowance needs renewing. Pause/resume/cancel/set_limits use `buildScheduleAction()` + `confirmScheduleAction()`.
- Amounts in the UI are XLM strings converted to stroops (7 dp) before calling the backend.
- Cron must repeat at a fixed cadence (minimum 60s); non-uniform crons are rejected by the backend. Next run, job id, fee, allowance cap/expiry, period cap, max runs, and end date are shown per schedule.
- Wallet connect/sign uses `@creit.tech/stellar-wallets-kit` (a static `StellarWalletsKit` class), not `@stellar/freighter-api` directly — unlike the rest of the app's Stellar modals (swap/orders/send), which are still Freighter-only. `ensureWalletsKit()` calls `StellarWalletsKit.init({ modules: defaultModules(), network })` once; `connectWallet()` opens `StellarWalletsKit.authModal()` (a picker covering Freighter, Albedo, xBull, Lobstr, Rabet, Hana, and more) only if no address is cached in component state, and `signXdr()` calls `StellarWalletsKit.signTransaction()`. Note the package's subpath exports: `defaultModules` lives at `@creit.tech/stellar-wallets-kit/modules/utils`, not the root or `/sdk` entry point, despite being re-exported-looking from `sdk/mod.d.ts` — that file only re-exports a *different* `sdk/utils.d.ts`.
- Webhook triggers return a one-time token and `POST /api/v1/workflows/hooks/<token>`; event triggers are stored but not fired by an event bus yet.
