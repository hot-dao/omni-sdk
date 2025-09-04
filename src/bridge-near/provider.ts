import { getErrorTypeFromErrorMessage, parseRpcError } from "@near-js/utils";
import { JsonRpcProvider } from "@near-js/providers";
import { TypedError } from "@near-js/types";

import { wait } from "../utils";

let _nextId = 123;
export const fastnearRpc = Math.random() > 0.5 ? "https://c1.rpc.fastnear.com" : "https://c2.rpc.fastnear.com";
const defaultsProviders = ["https://relmn.aurora.dev", "https://nearrpc.aurora.dev", "https://archival-rpc.mainnet.near.org", fastnearRpc];

export class NetworkError extends Error {
  name = "NetworkError";
  constructor(readonly status: number, readonly title: string, readonly body: any, readonly json?: object) {
    super(body);
  }

  toString() {
    return typeof this.body === "object" ? JSON.stringify(this.body) : this.body;
  }
}

class TimeoutNetworkError extends NetworkError {
  constructor(title: string) {
    super(0, title, "Timeout error");
  }
}

class NearRpcProvider extends JsonRpcProvider {
  public providers: string[];
  public currentProviderIndex = 0;
  public startTimeout;

  constructor(providers = defaultsProviders, private timeout = 30000, private triesCountForEveryProvider = 3, private incrementTimout = true) {
    super({ url: "" });
    this.currentProviderIndex = 0;
    this.providers = providers;
    this.startTimeout = timeout;
  }

  async sendJsonRpc<T>(method: string, params: any, attempts = 0): Promise<T> {
    const url = this.providers[this.currentProviderIndex];
    const requestStart = Date.now();

    try {
      const result = await this.send<T>(method, params, url, this.timeout);
      this.timeout = Math.max(this.startTimeout, this.timeout / 1.2);
      return result;
    } catch (e: any) {
      if (e instanceof TimeoutNetworkError && this.incrementTimout) {
        this.timeout = Math.min(60000, this.timeout * 1.2);
      }

      if (e instanceof NetworkError) {
        this.currentProviderIndex += 1;
        if (this.providers[this.currentProviderIndex] == null) this.currentProviderIndex = 0;
        if (attempts + 1 > this.providers.length * this.triesCountForEveryProvider) throw e;

        const needTime = 500 * attempts;
        const spent = Date.now() - requestStart;

        if (spent < needTime) {
          await wait(needTime - spent);
        }

        return await this.sendJsonRpc(method, params, attempts + 1);
      }

      throw e;
    }
  }

  async send<T>(method: string, params: any, url: string, timeout: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const req = await fetch(url, {
      body: JSON.stringify({ method, params, id: _nextId++, jsonrpc: "2.0" }),
      headers: { "Content-Type": "application/json", Referer: "https://my.herewallet.app" },
      signal: controller.signal,
      method: "POST",
    }).catch(() => {
      clearInterval(timer);
      if (controller.signal.aborted) throw new TimeoutNetworkError("RPC Network Error");
      if (!window.navigator.onLine) throw new NetworkError(0, "RPC Network Error", "No internet connection");
      throw new NetworkError(0, "RPC Network Error", "Unknown Near RPC Error, maybe connection unstable, try VPN");
    });

    clearInterval(timer);
    if (!req.ok) {
      const text = await req.text().catch(() => "Unknown error");
      throw new NetworkError(req.status, "RPC Network Error", text);
    }

    const response = await req.json();

    if (response.error) {
      if (typeof response.error.data === "object") {
        const isReadable = typeof response.error.data.error_message === "string" && typeof response.error.data.error_type === "string";
        if (isReadable) throw new TypedError(response.error.data.error_message, response.error.data.error_type);
        throw parseRpcError(response.error.data);
      }

      // NOTE: All this hackery is happening because structured errors not implemented
      // TODO: Fix when https://github.com/nearprotocol/nearcore/issues/1839 gets resolved
      const errorMessage = `[${response.error.code}] ${response.error.message}: ${response.error.data}`;
      const isTimeout = response.error.data === "Timeout" || errorMessage.includes("Timeout error") || errorMessage.includes("query has timed out");

      if (isTimeout) throw new TypedError(errorMessage, "TimeoutError");
      const type = getErrorTypeFromErrorMessage(response.error.data, response.error.name);
      throw new TypedError(errorMessage, type);
    }

    return response.result;
  }
}

export default NearRpcProvider;
