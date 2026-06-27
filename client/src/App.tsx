import { useCallback, useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import PostView from "./components/PostView";
import HermesChat from "./components/HermesChat";
import { api } from "./api";
import type { Post, PostSummary, PostStatus } from "./types";

type View = "writer" | "chat";

export default function App() {
  const [view, setView] = useState<View>("writer");
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    if (selectedId != null) loadPost(selectedId);
    else setPost(null);
  }, [selectedId, loadPost]);

  // Poll so changes made by the Hermes agent show up live.
  useEffect(() => {
    if (view !== "writer") return;
    const t = setInterval(() => {
      loadPosts();
      if (selectedId != null) loadPost(selectedId);
    }, 4000);
    return () => clearInterval(t);
  }, [loadPosts, loadPost, selectedId, view]);

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

  return (
    <div className={`app ${view === "chat" ? "app-chat" : ""}`}>
      {view === "writer" && (
        <Sidebar
          posts={posts}
          selectedId={selectedId}
          onSelect={(id) => {
            setView("writer");
            setSelectedId(id);
          }}
          onCreate={create}
          onStatusChange={changeStatus}
          onOpenChat={() => setView("chat")}
        />
      )}
      <main className={`main ${view === "chat" ? "main-chat" : ""}`}>
        {view === "chat" ? (
          <HermesChat onBack={() => setView("writer")} />
        ) : (
          <>
            {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}
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
