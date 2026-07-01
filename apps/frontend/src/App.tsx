import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import PostView from "./components/PostView";
import HermesChat from "./components/HermesChat";
import CronSettings from "./pages/CronSettings";
import WaitlistPage from "./pages/WaitlistPage";
import AdminPage from "./pages/AdminPage";
import HermesBootScreen from "./components/HermesBootScreen";
import { useAuth } from "./auth/AuthContext";
import { useHermesBoot } from "./hooks/useHermesBoot";
import { api } from "./api";
import type { Post, PostSummary, PostStatus } from "./types";

type View = "writer" | "chat" | "settings";

const isAdminRoute = () =>
  window.location.pathname.replace(/\/+$/, "").toLowerCase() === "/admin";

export default function App() {
  const { user, loading, logout } = useAuth();
  const { phase: hermesPhase, error: hermesError, retry: retryHermes } = useHermesBoot(user);
  const [view, setView] = useState<View>("writer");
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landingNotice, setLandingNotice] = useState<string | null>(null);
  const [adminRoute] = useState(isAdminRoute);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth === "not_approved") {
      setLandingNotice(
        "That email isn't approved yet. Join the waiting list below — we'll email you the moment you're in."
      );
    } else if (auth === "failed") {
      setLandingNotice("Google sign-in failed. Please try again.");
    }
    if (auth) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const loadPosts = useCallback(async () => {
    try {
      const list = await api.listPosts();
      setPosts(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadPost = useCallback(async (id: number) => {
    try {
      setPost(await api.getPost(id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadPosts();
  }, [user, loadPosts]);

  useEffect(() => {
    if (!user || selectedId == null) {
      if (!user) setPost(null);
      return;
    }
    loadPost(selectedId);
  }, [user, selectedId, loadPost]);

  useEffect(() => {
    if (!user || view !== "writer") return;
    const t = setInterval(() => {
      loadPosts();
      if (selectedId != null) loadPost(selectedId);
    }, 4000);
    return () => clearInterval(t);
  }, [user, loadPosts, loadPost, selectedId, view]);

  const refresh = useCallback(async () => {
    await loadPosts();
    if (selectedId != null) await loadPost(selectedId);
  }, [loadPosts, loadPost, selectedId]);

  const create = async (data: { title: string; idea: string }) => {
    const created = await api.createPost(data);
    await loadPosts();
    setSelectedId(created.id);
  };

  const handleDeleted = async () => {
    setSelectedId(null);
    setPost(null);
    await loadPosts();
  };

  const changeStatus = async (id: number, status: PostStatus) => {
    try {
      await api.updatePost(id, { status });
      await loadPosts();
      if (selectedId === id) await loadPost(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (adminRoute) {
    return <AdminPage />;
  }

  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-mark">M</div>
          <p className="login-loading">Loading…</p>
        </div>
      </div>
    );
  }

  // Pre-launch: everyone lands on the waiting list. Only admin-approved emails
  // get a session from the Google OAuth callback, so any signed-out visitor —
  // approved or not — sees this page until they successfully sign in.
  if (!user) {
    return (
      <WaitlistPage
        notice={landingNotice}
        onDismissNotice={() => setLandingNotice(null)}
      />
    );
  }

  if (hermesPhase !== "ready") {
    return (
      <HermesBootScreen
        user={user}
        error={hermesPhase === "error" ? hermesError : null}
        onRetry={hermesPhase === "error" ? retryHermes : undefined}
      />
    );
  }

  return (
    <div className={`app ${view === "chat" || view === "settings" ? "app-chat" : ""}`}>
      {view === "writer" && (
        <Sidebar
          posts={posts}
          selectedId={selectedId}
          user={user}
          onSelect={(id) => {
            setView("writer");
            setSelectedId(id);
          }}
          onCreate={create}
          onStatusChange={changeStatus}
          onOpenChat={() => setView("chat")}
          onOpenSettings={() => setView("settings")}
          onLogout={logout}
        />
      )}
      <main className={`main ${view === "chat" || view === "settings" ? "main-chat" : ""}`}>
        {view === "chat" ? (
          <HermesChat userId={user.id} onBack={() => setView("writer")} />
        ) : view === "settings" ? (
          <CronSettings onBack={() => setView("writer")} />
        ) : (
          <>
            {error && (
              <div className="error-bar" onClick={() => setError(null)}>
                {error}
              </div>
            )}
            {post ? (
              <PostView post={post} onChanged={refresh} onDeleted={handleDeleted} />
            ) : (
              <div className="placeholder">
                <div className="placeholder-mark">H</div>
                <h2>Start writing with Hermes</h2>
                <p>
                  Create a new piece, drop your idea and thoughts, then leave instructions for the AI.
                  Every round of feedback produces a new tracked version.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
