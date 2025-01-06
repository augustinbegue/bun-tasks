import { Redis } from 'ioredis';
import { ILogObj, Logger } from "tslog";
import { createLogger } from './utils/Logger';

export class Base {
  protected redis: Redis;
  protected logger: Logger<ILogObj>;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.logger = createLogger(this.constructor.name);
    this.logger.info("Initialized with Redis URL:", redisUrl);
  }
}
