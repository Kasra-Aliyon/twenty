export interface QueueJobOptions {
  id?: string;
  priority?: number;
  retryLimit?: number;
  backoff?: number | { type: 'fixed' | 'exponential'; delay: number };
  delay?: number;
}

export interface QueueCronJobOptions extends QueueJobOptions {
  repeat: {
    every?: number;
    pattern?: string;
    limit?: number;
  };
}
