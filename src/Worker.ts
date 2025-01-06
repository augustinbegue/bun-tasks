import { Scheduler } from './Scheduler';
import { Task } from './types/Task';

export abstract class Worker<Payload> {
  protected scheduler: Scheduler<Payload>;
  private running: boolean = false;

  constructor(redisUrl: string, queueName: string) {
    this.scheduler = new Scheduler<Payload>(redisUrl, queueName);
  }

  protected async reportProgress(
    taskId: string,
    percent: number,
    message?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.scheduler.reportProgress(taskId, {
      percent,
      message,
      metadata
    });
  }

  abstract process(
    task: Task<Payload>,
    reportProgress: (percent: number, message?: string, metadata?: Record<string, any>) => Promise<void>
  ): Promise<any>;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.scheduler.onTask(async (task: Task<Payload>) => {
      try {
        // Bind progress reporting to this specific task
        const boundProgressReport = this.reportProgress.bind(this, task.id);
        await this.scheduler.stop();
        const result = await this.process(task, boundProgressReport);
        await this.scheduler.reportTaskComplete(task.id, result);
        await this.scheduler.start();
      } catch (error) {
        if (error instanceof Error)
          await this.scheduler.reportTaskFailed(task.id, error.message);
        else
          await this.scheduler.reportTaskFailed(task.id, JSON.stringify(error));
      }
    });

    await this.scheduler.start();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.scheduler.stop();
  }
}
