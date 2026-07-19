import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import PostView from "./components/PostView";
import FeedView from "./components/FeedView";
import ResearchView from "./components/ResearchView";
import HomeNavTabs from "./components/HomeNavTabs";
import UserMenu from "./components/UserMenu";
import NotificationCenter, {
  NotificationToastHost,
} from "./components/NotificationCenter";
import CronSettings from "./pages/CronSettings";
import WaitlistPage from "./pages/WaitlistPage";
import OnboardingPage from "./pages/OnboardingPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import MuselyAgentBootScreen from "./components/MuselyAgentBootScreen";
import { useAuth } from "./auth/AuthContext";
import { useMuselyAgentBoot } from "./hooks/useMuselyAgentBoot";
import { useNotifications } from "./notifications/NotificationContext";
import { api } from "./api";
import type { Post, PostSummary } from "./types";

type View = "feed" | "write" | "research" | "settings" | "profile";

const isAdminRoute = () =>
  window.location.pathname.replace(/\/+$/, "").toLowerCase() === "/admin";

export default function App() {
  const { user, loading, logout, refresh } = useAuth();
  const onboarded = Boolean(user?.onboarded);
  const {
    phase: agentPhase,
    bootMode: agentBootMode,
    error: agentError,
    retry: retryAgent,
    attempt: agentBootAttempt,
  } = useMuselyAgentBoot(user, onboarded);
  const { focusedFeedJob, backgroundFeedJob } = useNotifications();
  const [view, setView] = useState<View>("feed");
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landingNotice, setLandingNotice] = useState<string | null>(null);
  const [adminRoute] = useState(isAdminRoute);
  const [cronSeed, setCronSeed] = useState<{ name?: string; prompt?: string } | null>(null);
  const [discussPostId, setDiscussPostId] = useState<number | null>(null);

  const goToView = useCallback(
    (next: View) => {
      if (next !== "feed" && focusedFeedJob?.status === "running") {
        backgroundFeedJob(focusedFeedJob.id);
      }
      setView(next);
    },
    [focusedFeedJob, backgroundFeedJob]
  );

  const openWriteFromNotification = useCallback(
    (postId?: number) => {
      goToView("write");
      if (postId != null) setSelectedId(postId);
    },
    [goToView]
  );

  const openFeedFromNotification = useCallback(
    (opts?: { discussPostId?: number }) => {
      goToView("feed");
      if (opts?.discussPostId != null) setDiscussPostId(opts.discussPostId);
    },
    [goToView]
  );

  const clearDiscussPostId = useCallback(() => setDiscussPostId(null), []);

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
    if (!user || !onboarded) return;
    loadPosts();
  }, [user, onboarded, loadPosts]);

  useEffect(() => {
    if (!user || selectedId == null) {
      if (!user) setPost(null);
      return;
    }
    loadPost(selectedId);
  }, [user, selectedId, loadPost]);

  useEffect(() => {
    if (!user || view !== "write") return;
    const t = setInterval(() => {
      loadPosts();
      if (selectedId != null) loadPost(selectedId);
    }, 4000);
    return () => clearInterval(t);
  }, [user, loadPosts, loadPost, selectedId, view]);

  const refreshPosts = useCallback(async () => {
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

  // First-time users pick their topics before we ever provision an agent.
  if (!onboarded) {
    return <OnboardingPage user={user} onComplete={refresh} />;
  }

  // Full-screen boot experience only for first-time provisioning or a hard
  // error. Returning users never see a "waking up" screen — their agent is
  // woken lazily by the first activity that needs it (feed refresh, writing queue, …).
  if (agentPhase === "preparing" || agentPhase === "error") {
    return (
      <MuselyAgentBootScreen
        user={user}
        phase={agentPhase}
        bootMode={agentBootMode}
        error={agentPhase === "error" ? agentError : null}
        onRetry={agentPhase === "error" ? retryAgent : undefined}
        bootKey={agentBootAttempt}
      />
    );
  }

  // Briefly checking agent status (idle/checking): a light neutral loader.
  if (agentPhase !== "ready") {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-mark">M</div>
          <p className="login-loading">Loading…</p>
        </div>
      </div>
    );
  }

  // Full-screen sub-views reachable from the header/sidebar.
  if (view === "settings") {
    return (
      <>
        <div className="app app-chat">
          <main className="main main-chat">
            <CronSettings
              seed={cronSeed}
              onBack={() => {
                setCronSeed(null);
                goToView("write");
              }}
            />
          </main>
        </div>
        <NotificationToastHost
          onOpenFeed={openFeedFromNotification}
          onOpenWriting={openWriteFromNotification}
        />
      </>
    );
  }

  if (view === "profile") {
    return (
      <>
        <div className="app app-chat">
          <main className="main main-chat">
            <ProfilePage
              user={user}
              onBack={() => goToView("feed")}
              onSaved={refresh}
              onOpenSettings={() => {
                setCronSeed(null);
                goToView("settings");
              }}
              onLogout={logout}
            />
          </main>
        </div>
        <NotificationToastHost
          onOpenFeed={openFeedFromNotification}
          onOpenWriting={openWriteFromNotification}
        />
      </>
    );
  }

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <span className="wl-brand-mark">M</span>
          <span className="home-brand-name">Musely</span>
        </div>
        <HomeNavTabs view={view} onChange={(id) => goToView(id)} />
        <div className="home-user">
          <NotificationCenter
            onOpenFeed={openFeedFromNotification}
            onOpenWriting={openWriteFromNotification}
          />
          <UserMenu
            user={user}
            onOpenProfile={() => goToView("profile")}
            onOpenSettings={() => {
              setCronSeed(null);
              goToView("settings");
            }}
            onLogout={logout}
          />
        </div>
      </header>

      <div className="home-body">
        {view === "feed" ? (
          <FeedView
            user={user}
            discussPostId={discussPostId}
            onDiscussPostHandled={clearDiscussPostId}
          />
        ) : view === "research" ? (
          <ResearchView user={user} />
        ) : (
          <div className="app">
            <Sidebar
              posts={posts}
              selectedId={selectedId}
              onSelect={(id) => {
                goToView("write");
                setSelectedId(id);
              }}
              onCreate={create}
            />
            <main className="main">
              {error && (
                <div className="error-bar" onClick={() => setError(null)}>
                  {error}
                </div>
              )}
              {post ? (
                <PostView
                  post={post}
                  onChanged={refreshPosts}
                  onDeleted={handleDeleted}
                  onOpenSchedule={(seed) => {
                    setCronSeed(seed ?? null);
                    goToView("settings");
                  }}
                />
              ) : (
                <div className="placeholder">
                  <div className="placeholder-mark">H</div>
                  <h2>Start writing with Musely Agent</h2>
                  <p>
                    Create a new piece, drop your idea and thoughts, then leave instructions for the AI.
                    Every round of feedback produces a new tracked version.
                  </p>
                </div>
              )}
            </main>
          </div>
        )}
      </div>
      <NotificationToastHost
        onOpenFeed={openFeedFromNotification}
        onOpenWriting={openWriteFromNotification}
      />
    </div>
  );
}
