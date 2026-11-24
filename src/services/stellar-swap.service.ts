import { getNetwork, signTransaction } from "@stellar/freighter-api";
import axios from "axios";
import { env } from "@/utils/env.utils";
import { BaseApiService } from "./api.service";

export type StellarSwapAsset = "XLM" | "USDC";

export interface StellarSwapQuote {
  network: "mainnet" | "testnet";
  networkPassphrase: string;
  provider: "soroswap" | "stellar-sdex";
  fromAsset: StellarSwapAsset;
  toAsset: StellarSwapAsset;
  amountIn: string;
  amountOut: string;
  minimumReceived: string;
  priceImpactPct: string | null;
  slippageBps: number;
  unsignedXdr: string;
  expiresInSeconds: number;
}

type NodeEnvelope<T> = { success: boolean; data: T; message: string };

type SoroswapBuildData = {
  network: "mainnet" | "testnet";
  address: string;
  xdr: string;
  quote: {
    amountIn: string;
    amountOut: string;
    expectedOut: string;
    minimumReceived: string;
    priceImpactPct: string;
    routePlan: { protocol: string; percent: string }[];
  };
};

type SoroswapSubmitData = {
  txHash: string;
  success: boolean;
  ledger?: number;
  protocol?: string;
};

const NETWORK_PASSPHRASES = {
  testnet: env.VITE_STELLAR_TESTNET_PASSPHRASE,
  mainnet: env.VITE_STELLAR_MAINNET_PASSPHRASE,
} as const;

function toError(error: unknown, serverErrorHint?: string): Error {
  if (axios.isAxiosError(error)) {
    if (serverErrorHint && error.response?.status === 500) return new Error(serverErrorHint);
    const payload = error.response?.data as { message?: string | string[]; error?: string } | undefined;
    const message = payload?.message ?? payload?.error;
    if (Array.isArray(message)) return new Error(message.join(", "));
    if (typeof message === "string" && message.length > 0) return new Error(message);
  }
  return error instanceof Error ? error : new Error("Request failed");
}

class StellarSwapService extends BaseApiService {
  async quote(input: {
    address: string;
    fromAsset: StellarSwapAsset;
    toAsset: StellarSwapAsset;
    amount: string;
    slippageBps: number;
  }): Promise<StellarSwapQuote> {
    try {
      const response = await this.api.post<NodeEnvelope<SoroswapBuildData>>("/soroswap/build", {
        address: input.address,
        fromAsset: input.fromAsset,
        toAsset: input.toAsset,
        amount: input.amount,
        slippageBps: input.slippageBps,
      });

      const payload = response.data;
      if (!payload?.success || !payload.data) {
        throw new Error(payload?.message || "Could not build the swap transaction");
      }

      const data = payload.data;
      return {
        network: data.network,
        networkPassphrase: NETWORK_PASSPHRASES[data.network],
        provider: "soroswap",
        fromAsset: input.fromAsset,
        toAsset: input.toAsset,
        amountIn: input.amount,
        amountOut: data.quote.expectedOut,
        minimumReceived: data.quote.minimumReceived,
        priceImpactPct: data.quote.priceImpactPct ?? null,
        slippageBps: input.slippageBps,
        unsignedXdr: data.xdr,
        expiresInSeconds: 60,
      };
    } catch (error) {
      throw toError(
        error,
        "Soroswap could not build this swap. Check that the wallet has a trustline for the output asset and enough XLM for fees.",
      );
    }
  }

  async signAndSubmit(address: string, quote: StellarSwapQuote): Promise<string> {
    const walletNetwork = await getNetwork();
    if (walletNetwork.error) throw new Error(walletNetwork.error.message);
    if (walletNetwork.networkPassphrase !== quote.networkPassphrase) {
      throw new Error(`Freighter is connected to ${walletNetwork.network}; switch it to Stellar ${quote.network} before swapping`);
    }

    const signed = await signTransaction(quote.unsignedXdr, {
      address,
      networkPassphrase: quote.networkPassphrase,
    });
    if (signed.error) throw new Error(signed.error.message);
    if (signed.signerAddress !== address) throw new Error("Freighter signed with a different account. Select the linked wallet and retry.");

    try {
      const response = await this.api.post<NodeEnvelope<SoroswapSubmitData>>("/soroswap/submit", {
        xdr: signed.signedTxXdr,
      });

      const payload = response.data;
      if (!payload?.success || !payload.data) {
        throw new Error(payload?.message || "Swap submission failed");
      }
      if (!payload.data.success) {
        throw new Error(`Swap failed on the network. Transaction: ${payload.data.txHash}`);
      }
      return payload.data.txHash;
    } catch (error) {
      throw toError(error);
    }
  }
}

export const stellarSwapService = new StellarSwapService();
