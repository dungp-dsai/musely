const API_BASE = import.meta.env.VITE_API_URL || "";

export default function LoginPage({ onBack }: { onBack?: () => void }) {
  const loginUrl = `${API_BASE}/api/auth/google`;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-mark">M</div>
        <h1>Welcome back</h1>
        <p>Sign in to manage your drafts and write with Musely.</p>
        <a className="btn btn-primary login-google" href={loginUrl}>
          <GoogleIcon />
          Continue with Google
        </a>
        {onBack && (
          <button type="button" className="login-back" onClick={onBack}>
            ← Back to waiting list
          </button>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.083 36 24 36c-5.514 0-10-4.486-10-10s4.486-10 10-10c2.651 0 5.083 1.015 6.903 2.673l5.657-5.657C33.64 9.053 29.082 7 24 7 13.507 7 5 15.507 5 26s8.507 19 19 19 19-8.507 19-19c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.651 0 5.083 1.015 6.903 2.673l5.657-5.657C33.64 9.053 29.082 7 24 7 13.507 7 5 15.507 5 26c0 1.989.477 3.864 1.316 5.541l6.571-4.85z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A09.866 09.866 0 0124 37c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 41.556 16.227 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
