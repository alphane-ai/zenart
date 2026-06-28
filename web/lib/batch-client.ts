"use client";

import { ZenariApiClient } from "./generated/zenart-api";

export type BatchStatus = "queued" | "running" | "partial_succeeded" | "succeeded" | "failed" | "cancelled" | "blocked";
export type ChildTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";

export type PromptContext = {
  text: string;
  selected_object_ids?: string[];
  reference_asset_ids?: string[];
  brand_kit_id?: string;
  model_hints?: string[];
  tool_hint?: string;
};

export type GenerationChildTask = {
  id: string;
  batch_id: string;
  tenant_id: string;
  status: ChildTaskStatus;
  provider_id: string;
  model_id: string;
  tool_type: string;
  seed?: string;
  retry_count: number;
  max_retries: number;
  quota_estimate_units: number;
  quota_committed_units: number;
  quota_refunded_units: number;
  asset_id?: string;
  canvas_object_id?: string;
  trace_id: string;
  visible_trace_ref?: string;
  failure_code?: string;
  failure_message?: string;
  review_reason?: string;
  metadata?: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type BatchGenerationRequest = {
  id: string;
  tenant_id: string;
  user_id: string;
  project_id: string;
  workspace_id: string;
  prompt_context: PromptContext;
  requested_count: number;
  allowed_models?: string[];
  quota_reservation_id: string;
  quota_estimated_units: number;
  quota_committed_units: number;
  quota_refunded_units: number;
  trace_id: string;
  status: BatchStatus;
  children: GenerationChildTask[];
  metadata?: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type GenerationChildTaskPage = {
  items: GenerationChildTask[];
};

export type BatchProgress = {
  batch_id: string;
  status: BatchStatus;
  requested_count: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  blocked: number;
  retryable: number;
};

export interface BatchClient {
  getBatchGeneration(batchId: string): Promise<BatchGenerationRequest>;
  listBatchGenerationChildren(batchId: string): Promise<GenerationChildTaskPage>;
  getBatchGenerationProgress(batchId: string): Promise<BatchProgress>;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export class ApiBatchClient implements BatchClient {
  private readonly apiClient: ZenariApiClient;

  constructor(baseUrl = "/api/v1") {
    this.apiClient = new ZenariApiClient(normalizeBaseUrl(baseUrl));
  }

  getBatchGeneration(batchId: string) {
    return this.apiClient.request<BatchGenerationRequest>("getBatchGeneration", {
      pathParams: {
        batch_id: batchId
      }
    });
  }

  listBatchGenerationChildren(batchId: string) {
    return this.apiClient.request<GenerationChildTaskPage>("listBatchGenerationChildren", {
      pathParams: {
        batch_id: batchId
      }
    });
  }

  getBatchGenerationProgress(batchId: string) {
    return this.apiClient.request<BatchProgress>("getBatchGenerationProgress", {
      pathParams: {
        batch_id: batchId
      }
    });
  }
}

export const createBatchClient = (baseUrl = "/api/v1"): BatchClient => new ApiBatchClient(baseUrl);
