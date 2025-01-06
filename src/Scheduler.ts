import { EventEmitter } from 'events';
import { Base } from './Base';
import { TaskManager } from './TaskManager';
import { Task, TaskProgress, TaskStatus } from './types/Task';

export class Scheduler<Payload> extends Base {
  private taskManager: TaskManager<Payload>;
  private eventEmitter: EventEmitter;
  private running: boolean = false;
  private pollInterval: number = 1000;
  private readonly PROCESSING_SET = 'tasks:processing';
  private readonly LOCK_PREFIX = 'task:lock:';
  private readonly LOCK_TTL = 30;

  constructor(redisUrl: string, queueName: string) {
    super(redisUrl);
    this.taskManager = new TaskManager<Payload>(redisUrl, queueName);
    this.eventEmitter = new EventEmitter();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger.info("Scheduler starting");

    while (this.running) {
      try {
        const task = await this.taskManager.getNextTask();
        if (!task) {
          this.logger.debug("No tasks available");
          await new Promise(resolve => setTimeout(resolve, this.pollInterval));
          continue;
        }

        this.logger.debug("Processing task", { taskId: task.id });
        const locked = await this.acquireLock(task.id);
        if (!locked) {
          this.logger.debug("Failed to acquire lock", { taskId: task.id });
          continue;
        }

        // Add to processing set
        await this.redis.zadd(this.PROCESSING_SET, Date.now(), task.id);

        // Emit task to workers
        this.eventEmitter.emit('task', task);
      } catch (error) {
        this.logger.error("Scheduler error", { error });
        await new Promise(resolve => setTimeout(resolve, this.pollInterval));
      }
    }
  }

  async stop(): Promise<void> {
    this.logger.info("Scheduler stopping");
    this.running = false;
  }

  onTask(callback: (task: Task<Payload>) => Promise<void>): void {
    this.eventEmitter.on('task', callback);
  }

  private async acquireLock(taskId: string): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}${taskId}`;

    const acquired = await this.redis.set(
      lockKey,
      'locked',
      'EX',
      this.LOCK_TTL,
      'NX'
    );

    return acquired === 'OK';
  }

  async reportTaskComplete(taskId: string, result?: any): Promise<void> {
    await this.taskManager.updateTaskStatus(taskId, TaskStatus.COMPLETED, result);
    await this.cleanupTask(taskId);
  }

  async reportTaskFailed(taskId: string, error: string): Promise<void> {
    const task = await this.taskManager.getTask(taskId);
    if (!task)
      throw new Error(`Task not found: ${taskId}`);

    if (task.attempts >= task.maxAttempts) {
      await this.taskManager.updateTaskStatus(taskId, TaskStatus.FAILED, undefined, error);
      return;
    }

    await this.taskManager.scheduleTaskRetry(taskId, error);
    await this.cleanupTask(taskId);
  }

  private async cleanupTask(taskId: string): Promise<void> {
    const multi = this.redis.multi();
    multi.zrem(this.PROCESSING_SET, taskId);
    multi.del(`${this.LOCK_PREFIX}${taskId}`);
    await multi.exec();
  }

  async reportProgress(
    taskId: string,
    progress: TaskProgress
  ): Promise<void> {
    await this.taskManager.updateTaskProgress(taskId, progress);
  }
}
