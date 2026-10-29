export type ModelProviderKind = "chatgpt" | "ollama" | "openai-compatible";
export type ModelProviderProfile = {
  id: string;
  label: string;
  kind: ModelProviderKind;
  baseUrl?: string;
  hasKey: boolean;
  externalConsent: boolean;
};
export type ProviderListing = {
  activeId: string;
  profiles: ModelProviderProfile[];
};
export type ProviderSave = {
  id?: string;
  label: string;
  kind: "ollama" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  clearKey?: boolean;
  externalConsent?: boolean;
};
export type ProviderUsageSample = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  rateWindow?: {
    requestsRemaining?: number;
    tokensRemaining?: number;
    requestsLimit?: number;
    tokensLimit?: number;
    requestsReset?: string;
    tokensReset?: string;
  };
};
export type ProviderUsage = {
  providerId: string;
  label: string;
  kind: ModelProviderKind;
  connected: boolean;
  planRemaining: { available: false; explanation: string };
  manageUsageUrl?: string;
  observed: {
    since: string;
    completedRequests: number;
    failedRequests: number;
    tokenReportedRequests: number;
    inputTokens: number;
    outputTokens: number;
  };
  rateWindow?: ProviderUsageSample["rateWindow"] & { observedAt: string };
  lastLimit?: { reportedAt: string; code: string };
};
