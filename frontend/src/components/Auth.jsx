
import { useState } from "react";
import { ArrowRight, Mail, Lock, User, Send } from "lucide-react";
import api from "../services/api";
import "./Auth.css";

function Auth({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isRegister
        ? "/auth/register"
        : "/auth/login";

      const payload = isRegister
        ? { name, email, password }
        : { email, password };

      const response = await api.post(endpoint, payload);
      const { token, user } = response.data;

      localStorage.setItem("tempomail_token", token);
      onLogin(user);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-logo"><Send size={23} /></div>
        <span>tempo<span>mail</span></span>
      </div>

      <div className="auth-card">
        <div className="auth-symbol"><Mail size={25} /></div>

        <p className="auth-eyebrow">EMAIL AUTOMATION, SIMPLIFIED</p>

        <h1>
          {isRegister ? "Create your account" : "Welcome back"}
        </h1>

        <p className="auth-description">
          {isRegister
            ? "Start scheduling your emails with TempoMail."
            : "Sign in to manage your email delivery."}
        </p>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <label className="auth-field">
              <span>Full name</span>
              <div className="auth-input">
                <User size={17} />
                <input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
            </label>
          )}

          <label className="auth-field">
            <span>Email address</span>
            <div className="auth-input">
              <Mail size={17} />
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input">
              <Lock size={17} />
              <input
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? "Please wait..."
              : isRegister
                ? "Create account"
                : "Sign in"}
            {!loading && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="auth-switch">
          {isRegister
            ? "Already have an account?"
            : "New to TempoMail?"}

          <button
            type="button"
            onClick={() => {
              setIsRegister(!isRegister);
              setError("");
            }}
          >
            {isRegister ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>

      <p className="auth-footer">
        Every email. Right on time.
      </p>
    </div>
  );
}

export default Auth;
