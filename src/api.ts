import { readGlobalConfig } from "./config.js";

/** Typed client for the Capsule Control API. */
export class ApiClient {
  constructor(
    private apiUrl: string,
    private token?: string,
  ) {}

  static async fromConfig(): Promise<ApiClient> {
    const cfg = await readGlobalConfig();
    return new ApiClient(cfg.apiUrl, cfg.token);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }

  me() {
    return this.request<{ user: unknown; plan: string }>("GET", "/v1/me");
  }

  listProjects() {
    return this.request<Project[]>("GET", "/v1/projects");
  }

  createProject(input: CreateProjectInput) {
    return this.request<Project>("POST", "/v1/projects", input);
  }

  createDeployment(projectId: string, input: CreateDeploymentInput) {
    return this.request<Deployment>("POST", `/v1/projects/${projectId}/deployments`, input);
  }
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  type: "agent" | "platform";
  runtime: "js" | "python";
  subdomain: string | null;
  current_deployment?: { status: string; build_ms?: number } | null;
}

export interface CreateProjectInput {
  name: string;
  type: "agent" | "platform";
  runtime: "js" | "python";
  repo_url?: string;
}

export interface CreateDeploymentInput {
  /** Prebuilt app.wasm. */
  artifact_b64?: string;
  /** Zero-config source zip. */
  source_zip_b64?: string;
  /** Zero-config single source file. */
  source_file?: { name: string; content_b64: string };
  /** Build from the project's linked repository. */
  use_repo?: boolean;
  commit_message?: string;
  commit_sha?: string;
}

export interface Deployment {
  id: string;
  status: string;
  build_ms?: number;
}
