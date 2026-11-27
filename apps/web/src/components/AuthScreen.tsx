/**
 * @file Login and Immich account linking for unauthenticated sessions, plus single sign-on when the API offers it.
 */

import { useEffect, useState } from "react";
import { getAuthProviders, oidcLoginUrl, type AuthProviders, type LoginProvider } from "../lib/api";

type Props = {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, provider: LoginProvider) => Promise<void>;
};

/** Messages for the fixed `sso_error` codes the API's SSO callback redirects with. */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  unavailable: "Single sign-on is unavailable right now. Try again in a moment.",
  expired: "That sign-in took too long or was started in another tab. Please try again.",
  denied: "Sign-in was cancelled at the login provider.",
  no_account:
    "You signed in, but no Treemich account matches that login. Ask your Treemich admin to add your email address.",
  conflict: "This Treemich account is already linked to a different single sign-on login.",
  failed: "Single sign-on didn't work. Please try again."
};

const readSsoError = (search: string) => {
  const code = new URLSearchParams(search).get("sso_error");
  return code ? (SSO_ERROR_MESSAGES[code] ?? SSO_ERROR_MESSAGES.failed!) : null;
};

/** Drops `sso_error` from the address bar so a reload doesn't show the message again. */
const clearSsoErrorFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("sso_error")) {
    return;
  }
  params.delete("sso_error");
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  );
};

export const AuthScreen = ({ busy, error, onSubmit }: Props) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [provider, setProvider] = useState<LoginProvider>("treemich");
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [ssoError] = useState(() => readSsoError(window.location.search));

  useEffect(() => {
    clearSsoErrorFromUrl();
    let cancelled = false;
    void getAuthProviders().then((result) => {
      if (!cancelled) {
        setProviders(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      provider === "immich" &&
      !window.confirm(
        "Legacy Immich migration login should only be used once. Using it again can clear or overwrite your Treemich data and force a start over. Continue?"
      )
    ) {
      return;
    }
    await onSubmit(email, password, provider);
  };
  const errorId = error ? "auth-screen-error" : undefined;
  const immichWarningId = provider === "immich" ? "auth-immich-migration-warning" : undefined;
  const sso = providers?.oidc ?? null;
  const showPasswordLogin = providers?.passwordLogin ?? true;

  return (
    <main className="auth-screen">
      <section className="card auth-card stack">
        <h1>Sign in to Treemich</h1>
        {ssoError ? (
          <p className="auth-error" role="alert">
            {ssoError}
          </p>
        ) : null}
        {sso ? (
          <a className="auth-sso-button" href={oidcLoginUrl}>
            {sso.label}
          </a>
        ) : null}
        {sso && showPasswordLogin ? (
          <p className="auth-divider" aria-hidden="true">
            or
          </p>
        ) : null}
        {showPasswordLogin ? (
          <>
            <div className="stack">
              <p className="hint">
                Use your Treemich email and password. On a fresh install, the first sign-in creates the first
                standalone Treemich account.
              </p>
              <p className="hint">
                Existing legacy Immich-login users can choose the Immich migration login below once, then sign
                in with Treemich afterward and manage Immich linking from inside the app.
              </p>
            </div>
            <form
              className="stack"
              onSubmit={(event) => void handleSubmit(event)}
              aria-describedby={[errorId, immichWarningId].filter(Boolean).join(" ") || undefined}
            >
              <label className="field-group">
                <span className="field-label">Sign-in method</span>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as LoginProvider)}
                >
                  <option value="treemich">Treemich account</option>
                  <option value="immich">Legacy Immich migration login</option>
                </select>
              </label>
              {provider === "immich" ? (
                <p id={immichWarningId} className="hint hint--danger" role="status">
                  Use Immich migration login only once. Selecting it again can clear or overwrite your
                  Treemich data and force you to start over. After migrating, sign in with your Treemich
                  account.
                </p>
              ) : null}
              <label className="field-group">
                <span className="field-label">Email</span>
                <input
                  name="email"
                  autoComplete="username"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={errorId}
                />
              </label>
              <label className="field-group">
                <span className="field-label">Password</span>
                <input
                  name="password"
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={errorId}
                />
              </label>
              {error ? (
                <p id={errorId} className="auth-error" aria-live="polite">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={busy} className={sso ? "secondary-button" : undefined}>
                {busy ? "Signing in..." : "Sign in"}
              </button>
            </form>
          </>
        ) : error ? (
          <p className="auth-error" aria-live="polite">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
};
