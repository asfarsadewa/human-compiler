// Turnstile widget lifecycle. Tokens are single-use: the widget is reset after
// every compile so the next one gets a fresh token.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_ACTION = "compile";
const TOKEN_WAIT_MS = 20_000;
const SCRIPT_WAIT_MS = 15_000;

// api.js is loaded with render=explicit; poll until its global appears.
const ready: Promise<TurnstileApi> = new Promise<TurnstileApi>((resolve, reject) => {
  if (typeof window === "undefined") return;
  const done = () => {
    if (window.turnstile) {
      window.clearInterval(poll);
      window.clearTimeout(timer);
      resolve(window.turnstile);
    }
  };
  const timer = window.setTimeout(() => {
    window.clearInterval(poll);
    reject(new Error("verification script did not load"));
  }, SCRIPT_WAIT_MS);
  const poll = window.setInterval(done, 200);
  done();
});

export type TurnstileState = "loading" | "ready" | "error";

export interface TurnstileHandle {
  state: TurnstileState;
  /** Resolves with a fresh token, waiting for the widget if needed. */
  getToken(): Promise<string>;
  /** Invalidates the current token and asks the widget for a new one. */
  reset(): void;
}

export function useTurnstile(siteKey: string | null, container: RefObject<HTMLDivElement | null>): TurnstileHandle {
  const [state, setState] = useState<TurnstileState>("loading");
  const tokenRef = useRef<string | null>(null);
  const widgetRef = useRef<string | null>(null);
  const apiRef = useRef<TurnstileApi | null>(null);
  const waitersRef = useRef<((token: string) => void)[]>([]);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    const el = container.current;
    ready
      .then((api) => {
        if (cancelled) return;
        apiRef.current = api;
        widgetRef.current = api.render(el, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          appearance: "interaction-only",
          size: "flexible",
          theme: "auto",
          callback: (token: string) => {
            tokenRef.current = token;
            setState("ready");
            const waiters = waitersRef.current;
            waitersRef.current = [];
            for (const w of waiters) w(token);
          },
          "expired-callback": () => {
            tokenRef.current = null;
          },
          "error-callback": () => {
            tokenRef.current = null;
            setState("error");
          },
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
      if (apiRef.current && widgetRef.current) {
        try {
          apiRef.current.remove(widgetRef.current);
        } catch {
          // widget already gone
        }
      }
      widgetRef.current = null;
    };
  }, [siteKey, container]);

  const reset = useCallback(() => {
    tokenRef.current = null;
    if (apiRef.current && widgetRef.current) {
      try {
        apiRef.current.reset(widgetRef.current);
      } catch {
        setState("error");
      }
    }
  }, []);

  const getToken = useCallback((): Promise<string> => {
    const current = tokenRef.current;
    if (current) {
      tokenRef.current = null;
      return Promise.resolve(current);
    }
    if (!widgetRef.current) return Promise.reject(new Error("verification is not ready"));
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        waitersRef.current = waitersRef.current.filter((w) => w !== onToken);
        reject(new Error("verification timed out"));
      }, TOKEN_WAIT_MS);
      const onToken = (token: string) => {
        window.clearTimeout(timer);
        tokenRef.current = null;
        resolve(token);
      };
      waitersRef.current.push(onToken);
      // A consumed or expired token means the widget is idle; ask it to run again.
      if (apiRef.current && widgetRef.current) {
        try {
          apiRef.current.reset(widgetRef.current);
        } catch {
          // reset failures surface as a timeout
        }
      }
    });
  }, []);

  return { state, getToken, reset };
}
