export type NotificationKind = "feed_build" | "writing_queue" | "feed_discuss";

export type NotificationStatus = "running" | "done" | "error" | "cancelled";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  status: NotificationStatus;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  /**
   * Feed: full-screen building UI.
   * Writing queue: keep queue panel open / highlight progress for this post.
   * Feed discuss: open discuss panel for this feed post.
   */
  focused: boolean;
  activity: string[];
  topicLabel?: string;
  /** Writing-queue / feed-discuss jobs. */
  postId?: number;
  postTitle?: string;
  taskCount?: number;
  /** Live assistant draft while a discuss reply streams. */
  streamingReply?: string;
  /** Pending user comment for discuss jobs. */
  userMessage?: string;
  runKey: number;
  /** Wall-clock start of this run — survives remounts when returning from background. */
  startedAt: number;
  error?: string | null;
  postCount?: number;
}

export interface NotificationToast {
  id: string;
  title: string;
  body: string;
  tone: "success" | "error" | "info";
}
