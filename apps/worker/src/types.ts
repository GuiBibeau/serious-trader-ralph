export type LoopConfig = {
  enabled: boolean;
  policy?: Record<string, unknown>;
  updatedAt?: string;
};

export type Env = {
  WAITLIST_DB: D1Database;
  CONFIG_KV: KVNamespace;
  LOGS_BUCKET: R2Bucket;
  ADMIN_TOKEN?: string;
  LOOP_ENABLED_DEFAULT?: string;
  ALLOWED_ORIGINS?: string;
};
