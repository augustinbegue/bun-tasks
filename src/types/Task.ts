export interface Task<Payload> {
  id: string;
  payload: Payload;
  priority: Priority;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  maxAttempts: number;
  result?: any;
  error?: string;
  progress?: TaskProgress;
}

export interface TaskProgress {
  percent: number;
  message?: string;
  metadata?: Record<string, any>;
}

export enum Priority {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum TaskStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING'
}

export interface TaskStatusUpdate<T> {
  taskId: string;
  status: TaskStatus;
  result?: any;
  error?: string;
}

export interface TaskProgressUpdate<T> {
  taskId: string;
  progress: TaskProgress;
}

export type TaskStatusCallback<T> = (update: TaskStatusUpdate<T>) => void | Promise<void>;
export type TaskProgressCallback<T> = (update: TaskProgressUpdate<T>) => void | Promise<void>;
