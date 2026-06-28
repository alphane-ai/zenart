"use client";

import { ZenariApiClient } from "./generated/zenart-api";

export type AssetLibraryEntryResponse = {
  id: string;
  asset?: {
    id?: string;
    asset_type?: string;
    status?: string;
    object_metadata?: {
      object_key?: string;
      created_at?: string;
    };
    storage_ref?: {
      object_key?: string;
    };
    thumbnail_ref?: {
      object_key?: string;
    };
    lineage?: {
      source?: {
        kind?: string;
        trace_id?: string;
      };
    };
    created_at?: string;
  };
  visibility: "project" | "tenant" | "private";
  favorite: boolean;
  archived: boolean;
  reusable: boolean;
  allowed_projects?: string[];
  tags?: string[];
  created_at: string;
  updated_at: string;
};

export type AssetLibraryEntryPage = {
  items: AssetLibraryEntryResponse[];
};

export type BrandKitResponse = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  logos?: Array<{ asset_id?: string; object_metadata_id?: string; usage?: string }>;
  palette?: Array<{ name: string; hex: string; role?: string }>;
  fonts?: Array<{ family: string; asset_id?: string; role?: string }>;
  guidelines?: Array<{ id: string; title: string; body: string; severity: string }>;
  source_refs?: Array<{ kind: string; asset_id?: string; trace_id?: string }>;
  project_bindings?: Array<{ project_id: string; default?: boolean }>;
  created_at: string;
  updated_at: string;
};

export type BrandKitPage = {
  items: BrandKitResponse[];
};

export type AssetLibraryEntryCreateRequest = {
  asset_id: string;
  project_id?: string;
  visibility: "project" | "tenant" | "private";
  favorite?: boolean;
  reusable?: boolean;
  allowed_projects?: string[];
  tags?: string[];
};

export type AssetLibraryEntryUpdateRequest = {
  visibility?: "project" | "tenant" | "private";
  favorite?: boolean;
  archived?: boolean;
  reusable?: boolean;
  allowed_projects?: string[];
  tags?: string[];
};

export type BrandKitWriteRequest = {
  name: string;
  status?: "draft" | "active" | "archived";
  logos: Array<{ asset_id: string; object_metadata_id?: string; usage?: string }>;
  palette: Array<{ name: string; hex: string; role?: string }>;
  fonts?: Array<{ family: string; asset_id?: string; role?: string }>;
  guidelines?: Array<{ id: string; title: string; body: string; severity?: string }>;
  source_refs?: Array<{ kind: string; asset_id?: string; object_metadata_id?: string; upload_id?: string; trace_id?: string }>;
  project_bindings?: Array<{ project_id: string; default?: boolean }>;
};

export type BrandKitUpdateRequest = Partial<BrandKitWriteRequest>;

export interface AssetLibraryClient {
  listAssetLibrary(projectId: string, status?: string): Promise<AssetLibraryEntryPage>;
  createAssetLibraryEntry(input: AssetLibraryEntryCreateRequest, idempotencyKey: string): Promise<AssetLibraryEntryResponse>;
  updateAssetLibraryEntry(entryId: string, input: AssetLibraryEntryUpdateRequest, idempotencyKey: string): Promise<AssetLibraryEntryResponse>;
  listBrandKits(projectId: string, status?: string): Promise<BrandKitPage>;
  createBrandKit(input: BrandKitWriteRequest, idempotencyKey: string): Promise<BrandKitResponse>;
  updateBrandKit(brandKitId: string, input: BrandKitUpdateRequest, idempotencyKey: string): Promise<BrandKitResponse>;
  getProjectDefaultBrandKit(projectId: string): Promise<BrandKitResponse>;
  setProjectDefaultBrandKit(projectId: string, brandKitId: string, idempotencyKey: string): Promise<BrandKitResponse>;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export class ApiAssetLibraryClient implements AssetLibraryClient {
  private readonly apiClient: ZenariApiClient;

  constructor(baseUrl = "/api/v1") {
    this.apiClient = new ZenariApiClient(normalizeBaseUrl(baseUrl));
  }

  listAssetLibrary(projectId: string, status = "active") {
    return this.apiClient.request<AssetLibraryEntryPage>("listAssetLibrary", {
      query: {
        project_id: projectId,
        status,
        page_size: "25"
      }
    });
  }

  createAssetLibraryEntry(input: AssetLibraryEntryCreateRequest, idempotencyKey: string) {
    return this.apiClient.request<AssetLibraryEntryResponse>("createAssetLibraryEntry", {
      body: input,
      idempotencyKey
    });
  }

  updateAssetLibraryEntry(entryId: string, input: AssetLibraryEntryUpdateRequest, idempotencyKey: string) {
    return this.apiClient.request<AssetLibraryEntryResponse>("updateAssetLibraryEntry", {
      pathParams: {
        entry_id: entryId
      },
      body: input,
      idempotencyKey
    });
  }

  listBrandKits(projectId: string, status = "active") {
    return this.apiClient.request<BrandKitPage>("listBrandKits", {
      query: {
        project_id: projectId,
        status,
        page_size: "25"
      }
    });
  }

  createBrandKit(input: BrandKitWriteRequest, idempotencyKey: string) {
    return this.apiClient.request<BrandKitResponse>("createBrandKit", {
      body: input,
      idempotencyKey
    });
  }

  updateBrandKit(brandKitId: string, input: BrandKitUpdateRequest, idempotencyKey: string) {
    return this.apiClient.request<BrandKitResponse>("updateBrandKit", {
      pathParams: {
        brand_kit_id: brandKitId
      },
      body: input,
      idempotencyKey
    });
  }

  getProjectDefaultBrandKit(projectId: string) {
    return this.apiClient.request<BrandKitResponse>("getProjectDefaultBrandKit", {
      pathParams: {
        project_id: projectId
      }
    });
  }

  setProjectDefaultBrandKit(projectId: string, brandKitId: string, idempotencyKey: string) {
    return this.apiClient.request<BrandKitResponse>("setProjectDefaultBrandKit", {
      pathParams: {
        project_id: projectId
      },
      body: {
        brand_kit_id: brandKitId
      },
      idempotencyKey
    });
  }
}

export const createAssetLibraryClient = (baseUrl = "/api/v1"): AssetLibraryClient => new ApiAssetLibraryClient(baseUrl);
