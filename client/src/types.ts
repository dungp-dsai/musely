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
