export type PostStatus = "pending" | "in_progress";
export type Source = "user" | "ai";
export type FeedbackStatus = "pending" | "in_progress" | "done";

export interface Version {
  id: number;
  post_id: number;
  version_number: number;
  title: string;
  content: string;
  note: string;
  source: Source;
  created_at: string;
}

export interface Feedback {
  id: number;
  post_id: number;
  version_id: number | null;
  context: string;
  context_from: number | null;
  context_to: number | null;
  content: string; // task instruction for the AI
  status: FeedbackStatus;
  resolved_version_id: number | null;
  created_at: string;
  resolved_at: string | null;
  /** Latest ai_task_work.created_at for this task (if any). */
  last_work_at?: string | null;
  work_count?: number;
}

export interface PostSummary {
  id: number;
  title: string;
  idea: string;
  draft_content: string;
  status: PostStatus;
  created_at: string;
  updated_at: string;
  version_count: number;
  pending_feedback: number;
}

export interface Post extends PostSummary {
  versions: Version[];
  feedback: Feedback[];
}

export interface AiTaskWork {
  id: number;
  task_id: number;
  result: string;
  created_at: string;
}

export interface AiJobReport {
  id: number;
  post_id: number;
  version_number: number;
  summary_action_report: string;
  created_at: string;
}

export interface AiTaskChatMessage {
  id: number;
  task_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface TaskThread {
  task: Feedback;
  post: { id: number; title: string; draft_content: string } | null;
  work: AiTaskWork[];
  report: AiJobReport | null;
  messages: AiTaskChatMessage[];
}

export interface UserTopics {
  interests: string;
  write: string[];
  read: string[];
}

export interface UserPreferences {
  onboarded: boolean;
  topics: UserTopics;
}

export interface FeedSource {
  label: string;
  url: string;
}

export interface FeedPost {
  id: number;
  user_id: number;
  topic: string;
  title: string;
  whats_new: string;
  why_it_matters: string;
  sources: FeedSource[];
  created_at: string;
  reaction: "up" | "down" | null;
}

export interface FeedDiscussion {
  id: number;
  user_id: number;
  post_id: number;
  hermes_session_id: string;
  created_at: string;
  updated_at: string;
}

export interface FeedDiscussionMessage {
  id: number;
  discussion_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface FeedDiscussThread {
  discussion: FeedDiscussion;
  messages: FeedDiscussionMessage[];
}

export interface FeedListResponse {
  posts: FeedPost[];
  total: number;
  limit: number;
  offset: number;
}

export interface FeedUserPrefs {
  skip_feedback_prompt: boolean;
  updated_at: string | null;
}

/** @deprecated Use FeedPost */
export interface FeedItem {
  id: number;
  user_id: number;
  topic: string;
  kind: "read" | "write";
  title: string;
  summary: string;
  url: string | null;
  created_at: string;
}
