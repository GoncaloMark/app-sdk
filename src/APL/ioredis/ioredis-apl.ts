import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import Redis from "ioredis";

import { getOtelTracer, OTEL_APL_SERVICE_NAME } from "../../open-telemetry";
import { APL, AplConfiguredResult, AplReadyResult, AuthData } from "../apl";
import { createAPLDebug } from "../apl-debug";

/**
 * Configuration options for IORedisAPL
 */
type IORedisAPLConfig = {
  /** Redis client instance to use for storage */
  client: Redis;
  /** Optional key to use for the hash collection. Defaults to "saleor_app_auth" */
  hashCollectionKey?: string;
};

/**
 * Redis implementation of the Auth Persistence Layer (APL).
 * This class provides Redis-based storage for Saleor App authentication data.
 */
export class IORedisAPL implements APL {
  private debug = createAPLDebug("IORedisAPL");

  private tracer = getOtelTracer();

  private client: Redis;

  private hashCollectionKey: string;

  constructor(config: IORedisAPLConfig) {
    this.client = config.client;
    this.hashCollectionKey = config.hashCollectionKey || "saleor_app_auth";

    this.debug("Redis APL initialized");
  }

  private async ensureConnection(): Promise<void> {
    if (this.client.status !== "ready") {
      this.debug("Connecting to Redis...");
      await this.client.connect();
      this.debug("Connected to Redis");
    }
  }

  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    await this.ensureConnection();

    this.debug("Will get auth data from Redis for %s", saleorApiUrl);

    return this.tracer.startActiveSpan(
      "IORedisAPL.get",
      {
        attributes: {
          saleorApiUrl,
          [SemanticAttributes.PEER_SERVICE]: OTEL_APL_SERVICE_NAME,
        },
        kind: SpanKind.CLIENT,
      },
      async (span) => {
        try {
          const authData = await this.client.hget(this.hashCollectionKey, saleorApiUrl);

          this.debug("Received response from Redis");

          if (!authData) {
            this.debug("AuthData is empty for %s", saleorApiUrl);
            span.setStatus({ code: SpanStatusCode.OK }).end();
            return undefined;
          }

          const parsedAuthData = JSON.parse(authData) as AuthData;
          span.setStatus({ code: SpanStatusCode.OK }).end();
          return parsedAuthData;
        } catch (e) {
          this.debug("Failed to get auth data from Redis");
          this.debug(e);

          span.recordException(e as Error);
          span
            .setStatus({
              code: SpanStatusCode.ERROR,
              message: "Failed to get auth data from Redis",
            })
            .end();

          throw e;
        }
      },
    );
  }

  async set(authData: AuthData): Promise<void> {
    await this.ensureConnection();

    this.debug("Will set auth data in Redis for %s", authData.saleorApiUrl);

    return this.tracer.startActiveSpan(
      "IORedisAPL.set",
      {
        attributes: {
          saleorApiUrl: authData.saleorApiUrl,
          appId: authData.appId,
          [SemanticAttributes.PEER_SERVICE]: OTEL_APL_SERVICE_NAME,
        },
        kind: SpanKind.CLIENT,
      },
      async (span) => {
        try {
          await this.client.hset(
            this.hashCollectionKey,
            authData.saleorApiUrl,
            JSON.stringify(authData),
          );

          this.debug("Successfully set auth data in Redis");
          span.setStatus({ code: SpanStatusCode.OK }).end();
        } catch (e) {
          this.debug("Failed to set auth data in Redis");
          this.debug(e);

          span.recordException(e as Error);
          span
            .setStatus({
              code: SpanStatusCode.ERROR,
              message: "Failed to set auth data in Redis",
            })
            .end();

          throw e;
        }
      },
    );
  }

  async delete(saleorApiUrl: string): Promise<void> {
    await this.ensureConnection();

    this.debug("Will delete auth data from Redis for %s", saleorApiUrl);

    return this.tracer.startActiveSpan(
      "IORedisAPL.delete",
      {
        attributes: {
          saleorApiUrl,
          [SemanticAttributes.PEER_SERVICE]: OTEL_APL_SERVICE_NAME,
        },
        kind: SpanKind.CLIENT,
      },
      async (span) => {
        try {
          await this.client.hdel(this.hashCollectionKey, saleorApiUrl);

          this.debug("Successfully deleted auth data from Redis");
          span.setStatus({ code: SpanStatusCode.OK }).end();
        } catch (e) {
          this.debug("Failed to delete auth data from Redis");
          this.debug(e);

          span.recordException(e as Error);
          span
            .setStatus({
              code: SpanStatusCode.ERROR,
              message: "Failed to delete auth data from Redis",
            })
            .end();

          throw e;
        }
      },
    );
  }

  async getAll(): Promise<AuthData[]> {
    await this.ensureConnection();

    this.debug("Will get all auth data from Redis");

    return this.tracer.startActiveSpan(
      "IORedisAPL.getAll",
      {
        attributes: {
          [SemanticAttributes.PEER_SERVICE]: OTEL_APL_SERVICE_NAME,
        },
        kind: SpanKind.CLIENT,
      },
      async (span) => {
        try {
          const allData: {
            [x: string]: string;
          } = await this.client.hgetall(this.hashCollectionKey);

          this.debug("Successfully retrieved all auth data from Redis");
          span.setStatus({ code: SpanStatusCode.OK }).end();

          return Object.values(allData || {}).map((data) => JSON.parse(data) as AuthData);
        } catch (e) {
          this.debug("Failed to get all auth data from Redis");
          this.debug(e);

          span.recordException(e as Error);
          span
            .setStatus({
              code: SpanStatusCode.ERROR,
              message: "Failed to get all auth data from Redis",
            })
            .end();

          throw e;
        }
      },
    );
  }

  async isReady(): Promise<AplReadyResult> {
    try {
      await this.ensureConnection();
      const ping = await this.client.ping();
      return ping === "PONG"
        ? { ready: true }
        : { ready: false, error: new Error("Redis server did not respond with PONG") };
    } catch (error) {
      return { ready: false, error: error as Error };
    }
  }

  async isConfigured(): Promise<AplConfiguredResult> {
    try {
      await this.ensureConnection();
      const ping = await this.client.ping();
      return ping === "PONG"
        ? { configured: true }
        : { configured: false, error: new Error("Redis connection not configured properly") };
    } catch (error) {
      return { configured: false, error: error as Error };
    }
  }
}
