import { Base } from './Base';
import { REDIS_CHANNELS } from './constants';
import {
  Priority,
  Task,
  TaskProgress,
  TaskProgressCallback,
  TaskStatus,
  TaskStatusCallback
} from './types/Task';

export class TaskManager<Payload> extends Base {
  protected TASK_QUEUE = 'tasks:queue';
  private statusCallback?: TaskStatusCallback<Payload>;
  private progressCallback?: TaskProgressCallback<Payload>;

  constructor(redisUrl: string, queueName: string) {
    super(redisUrl);
    this.TASK_QUEUE = queueName ? `tasks:queue:${queueName}` : this.TASK_QUEUE;
    this.setupSubscriptions();
  }

  private async setupSubscriptions() {
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(REDIS_CHANNELS.TASK_STATUS, async (err) => {
      this.logger.error("Error subscribing to task status", { err });
    });

    await subscriber.subscribe(REDIS_CHANNELS.TASK_PROGRESS, async (err) => {
      this.logger.error("Error subscribing to task progress", { err });
    });

    subscriber.on('message', async (channel, message) => {
      if (channel === REDIS_CHANNELS.TASK_STATUS && this.statusCallback) {
        await this.statusCallback(JSON.parse(message));
      } else if (channel === REDIS_CHANNELS.TASK_PROGRESS && this.progressCallback) {
        await this.progressCallback(JSON.parse(message));
      }
    });
  }

  onStatusChange(callback: TaskStatusCallback<Payload>): void {
    this.statusCallback = callback;
  }

  onProgressUpdate(callback: TaskProgressCallback<Payload>): void {
    this.progressCallback = callback;
  }

  private getPriorityScore(priority: Priority): number {
    const now = Date.now();
    switch (priority) {
      case Priority.HIGH: return now;
      case Priority.MEDIUM: return now + 1000;
      case Priority.LOW: return now + 2000;
      default: return now + 1000;
    }
  }

  async createTask(
    payload: Payload,
    priority: Priority = Priority.MEDIUM
  ): Promise<Task<Payload>> {
    this.logger.debug("Creating new task", { priority });
    const task: Task<Payload> = {
      id: crypto.randomUUID(),
      payload,
      priority,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: 0,
      maxAttempts: 3
    };

    try {
      await this.redis
        .multi()
        .hset(`task:${task.id}`, {
          ...task,
          payload: JSON.stringify(task.payload),
        })
        .zadd(this.TASK_QUEUE, this.getPriorityScore(priority), task.id)
        .hgetall(`task:${task.id}`)
        .exec();
      this.logger.info("Task created successfully", { taskId: task.id });
      return task;
    } catch (error) {
      this.logger.error("Failed to create task", { error });
      throw error;
    }
  }

  private parseTaskFromRedis(taskId: string, taskData: Record<string, string>): Task<Payload> {
    try {
      return {
        id: taskId,
        payload: JSON.parse(taskData.payload),
        status: taskData.status as TaskStatus,
        createdAt: new Date(taskData.createdAt),
        updatedAt: new Date(taskData.updatedAt),
        attempts: Number(taskData.attempts),
        maxAttempts: Number(taskData.maxAttempts),
        priority: taskData.priority as Priority,
        ...(taskData.result && { result: JSON.parse(taskData.result) }),
        ...(taskData.error && { error: taskData.error }),
        ...(taskData.progress && { progress: JSON.parse(taskData.progress) })
      };
    } catch (error) {
      this.logger.error("Error parsing task from Redis", { taskId, error });
      if (error instanceof SyntaxError)
        throw new Error(`Error parsing task: ${error.message}`);
      else
        throw error;
    }
  }

  async getTask(taskId: string): Promise<Task<Payload> | null> {
    const taskData = await this.redis.hgetall(`task:${taskId}`);
    if (!taskData) return null;

    return this.parseTaskFromRedis(taskId, taskData);
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    result?: any,
    error?: string
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const updates = {
      status,
      updatedAt: new Date().toISOString(),
      attempts: Number(task.attempts) + 1,
      ...(result && { result: JSON.stringify(result) }),
      ...(error && { error })
    };

    await this.redis.hset(`task:${taskId}`, updates);
    await this.redis.publish(REDIS_CHANNELS.TASK_STATUS, JSON.stringify({ taskId, status, result, error }));
  }

  async updateTaskProgress(
    taskId: string,
    progress: TaskProgress
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const updates = {
      progress: JSON.stringify(progress),
      updatedAt: new Date().toISOString()
    };

    await this.redis.hset(`task:${taskId}`, updates);
    await this.redis.publish(REDIS_CHANNELS.TASK_PROGRESS, JSON.stringify({ taskId, progress }));
  }

  async getNextTask(): Promise<Task<Payload> | null> {
    const res = await this.redis.zpopmin(this.TASK_QUEUE);
    const taskId = res[0];
    if (!taskId) return null;

    try {
      const taskData = await this.getTask(taskId);
      if (!taskData) throw new Error(`Task not found: ${taskId}`);
      return taskData;
    } catch (error) {
      this.logger.error("Error getting next task", { taskId, error });
      await this.scheduleTaskRetry(taskId, 'Error getting next task');
      return null;
    }
  }

  async scheduleTaskRetry(taskId: string, error: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const backoffDelay = Math.pow(2, Number(task.attempts)) * 1000;
    this.logger.info("Scheduling task retry", { taskId, attempts: task.attempts, backoffDelay });
    await this.redis.zadd(
      this.TASK_QUEUE,
      Date.now() + backoffDelay,
      task.id
    );
  }
}
