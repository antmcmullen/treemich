/**
 * @file AuthScreen single sign-on: provider discovery via `GET /auth/providers`, the SSO button, SSO-only mode,
 * and the `sso_error` messages the API callback redirects with.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthScreen } from "./AuthScreen";

const reactTestEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;

const stubProviders = (response: (() => Promise<Response>) | Error) => {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (!url.includes("/auth/providers")) {
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    }
    return response instanceof Error ? Promise.reject(response) : response();
  }) as unknown as typeof globalThis.fetch;
};

const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );

const render = async (): Promise<{ container: HTMLDivElement; root: Root }> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AuthScreen busy={false} error={null} onSubmit={vi.fn()} />);
  });
  // let the providers fetch resolve
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });
  }
  return { container, root };
};

describe("AuthScreen single sign-on", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    document.body.innerHTML = "";
  });

  it("shows the SSO button above the password form when SSO is configured", async () => {
    stubProviders(json({ passwordLogin: true, oidc: { label: "McMullen login" } }));
    const { container, root } = await render();

    const link = container.querySelector("a.auth-sso-button") as HTMLAnchorElement | null;
    expect(link?.textContent).toBe("McMullen login");
    expect(link?.getAttribute("href")).toBe("/api/auth/oidc/login");
    expect(container.querySelector("form")).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')?.className).toBe("secondary-button");

    act(() => root.unmount());
  });

  it("hides the password form in SSO-only mode", async () => {
    stubProviders(json({ passwordLogin: false, oidc: { label: "Sign in with SSO" } }));
    const { container, root } = await render();

    expect(container.querySelector("a.auth-sso-button")?.textContent).toBe("Sign in with SSO");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Immich migration login");

    act(() => root.unmount());
  });

  it("falls back to password-only when the providers call fails or is missing", async () => {
    for (const response of [new Error("network down"), json({ statusCode: 404 }, 404)]) {
      stubProviders(response);
      const { container, root } = await render();
      expect(container.querySelector("a.auth-sso-button")).toBeNull();
      expect(container.querySelector("form")).toBeTruthy();
      act(() => root.unmount());
      container.remove();
    }
  });

  it("explains an sso_error code and removes it from the address bar, keeping other params", async () => {
    window.history.replaceState(null, "", "/?sso_error=no_account&view=tree#top");
    stubProviders(json({ passwordLogin: true, oidc: { label: "SSO" } }));
    const { container, root } = await render();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "no Treemich account matches that login"
    );
    expect(window.location.search).toBe("?view=tree");
    expect(window.location.hash).toBe("#top");

    act(() => root.unmount());
  });

  it("shows a generic message for an unknown code and never echoes it", async () => {
    window.history.replaceState(null, "", "/?sso_error=%3Cimg%20src%3Dx%3E");
    stubProviders(json({ passwordLogin: true, oidc: null }));
    const { container, root } = await render();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Single sign-on didn't work. Please try again.");
    expect(container.innerHTML).not.toContain("<img");
    expect(window.location.search).toBe("");

    act(() => root.unmount());
  });
});
