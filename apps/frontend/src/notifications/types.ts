export type NotificationKind = "feed_build" | "writing_queue";

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
   */
  focused: boolean;
  activity: string[];
  topicLabel?: string;
  /** Writing-queue jobs only. */
  postId?: number;
  postTitle?: string;
  taskCount?: number;
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
  tone: "success" | "error";
}
