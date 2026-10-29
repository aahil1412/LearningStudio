import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, ExternalLink } from "lucide-react";
import { invoke } from "../lib/bridge";
import type { ProviderUsage } from "../providerTypes";
import "./provider-settings.css";

export default function UsageStatus({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [usage, setUsage] = useState<ProviderUsage | null>(null),
    [error, setError] = useState("");
  const host = useRef<HTMLDetailsElement>(null);
  const refresh = useCallback(() => {
    void invoke<ProviderUsage>("providers:usage")
      .then((value) => {
        setUsage(value);
        setError("");
      })
      .catch(() =>
        setError(
          "Usage details are unavailable. Your learning session is unaffected.",
        ),
      );
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    const unsub = window.studio?.onRequestState?.((event) => {
      if (["complete", "failed", "canceled"].includes(event.phase)) refresh();
    });
    const changed = window.studio?.onDataChanged?.(refresh);
    return () => {
      clearInterval(timer);
      unsub?.();
      changed?.();
    };
  }, [refresh]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (host.current && !host.current.contains(event.target as Node))
        host.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const count = (value: number) => value.toLocaleString();
  const content = (
    <section
      className="provider-usage-content"
      aria-label="Provider usage details"
    >
      <div className="provider-usage-heading">
        <span>
          <Gauge size={18} />
        </span>
        <div>
          <strong>
            {usage?.kind === "chatgpt"
              ? "ChatGPT allowance"
              : usage?.label || "Model usage"}
          </strong>
          <p>
            {usage?.kind === "chatgpt"
              ? "Your subscription remains the default."
              : "Usage for the explicitly selected connection."}
          </p>
        </div>
      </div>
      {error ? (
        <p role="status">{error}</p>
      ) : !usage ? (
        <p role="status">Loading usage information…</p>
      ) : (
        <>
          <div className="provider-quota-fact">
            <span>
              {usage.kind === "chatgpt"
                ? "Remaining plan quota"
                : "Account balance"}
            </span>
            <strong>
              {usage.kind === "ollama" ? "Local server" : "Not exposed"}
            </strong>
          </div>
          <p className="provider-usage-explanation">
            {usage.planRemaining.explanation}
          </p>
          {usage.lastLimit && (
            <p className="notice warning">
              The provider reported a usage limit. Review the applicable limit
              before trying again; this does not establish that your entire plan
              is empty.
            </p>
          )}
          {usage.manageUsageUrl && (
            <button
              className="provider-manage-usage"
              onClick={() => void invoke("external:open", usage.manageUsageUrl)}
            >
              <ExternalLink size={15} /> Open ChatGPT Usage
            </button>
          )}
          <div className="provider-local-usage">
            <h4>Observed in Learning Studio</h4>
            <p>
              These local totals are not your remaining subscription allowance
              and exclude other apps.
            </p>
            <dl>
              <div>
                <dt>Completed requests</dt>
                <dd>{count(usage.observed.completedRequests)}</dd>
              </div>
              <div>
                <dt>Reported input tokens</dt>
                <dd>{count(usage.observed.inputTokens)}</dd>
              </div>
              <div>
                <dt>Reported output tokens</dt>
                <dd>{count(usage.observed.outputTokens)}</dd>
              </div>
            </dl>
            <small>
              Token counts reported for{" "}
              {count(usage.observed.tokenReportedRequests)} completed requests.
              Tracking since{" "}
              {new Date(usage.observed.since).toLocaleDateString()}.
            </small>
          </div>
          {usage.rateWindow && (
            <div className="provider-rate-window">
              <h4>Provider-reported rate window</h4>
              <p>
                Last response headers, not a subscription balance. These values
                can change outside this app.
              </p>
              <dl>
                {usage.rateWindow.requestsRemaining !== undefined && (
                  <div>
                    <dt>Requests remaining in window</dt>
                    <dd>{count(usage.rateWindow.requestsRemaining)}</dd>
                  </div>
                )}
                {usage.rateWindow.tokensRemaining !== undefined && (
                  <div>
                    <dt>Tokens remaining in window</dt>
                    <dd>{count(usage.rateWindow.tokensRemaining)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </>
      )}
    </section>
  );
  return compact ? (
    <details
      className="provider-usage-compact"
      ref={host}
      onKeyDown={(event) => {
        if (event.key === "Escape" && host.current) {
          host.current.open = false;
          host.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label="Model usage and ChatGPT quota">
        <Gauge size={15} />
        <span>Usage</span>
      </summary>
      <div className="provider-usage-popover">{content}</div>
    </details>
  ) : (
    <div className="provider-usage-card">{content}</div>
  );
}
