export type NotificationKind = "feed_build";

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
  /** When true, FeedView shows the full building screen for this job. */
  focused: boolean;
  activity: string[];
  topicLabel?: string;
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
