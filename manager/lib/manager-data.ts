export type SurfaceStatus = {
  name: string;
  url: string;
  status: "ready" | "blocked" | "watch";
  owner: string;
  evidence: string;
};

export type ManagerMetric = {
  label: string;
  value: string;
  detail: string;
};

export type DeliveryLane = {
  lane: string;
  focus: string;
  state: "ready" | "blocked" | "provisional";
  nextAction: string;
};

export const apiBaseUrl =
  process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://127.0.0.1:31080";

export const surfaceStatuses: SurfaceStatus[] = [
  {
    name: "Backend API",
    url: apiBaseUrl,
    status: "ready",
    owner: "platform",
    evidence: "/healthz and /readyz"
  },
  {
    name: "User Web",
    url: process.env.NEXT_PUBLIC_MANAGER_WEB_URL ?? "http://127.0.0.1:26080",
    status: "ready",
    owner: "product",
    evidence: "workspace, projects, billing, support"
  },
  {
    name: "Admin Console",
    url: process.env.NEXT_PUBLIC_MANAGER_ADMIN_URL ?? "http://127.0.0.1:26081",
    status: "ready",
    owner: "admin",
    evidence: "review, queue, safety, audit"
  },
  {
    name: "Manager Console",
    url: process.env.NEXT_PUBLIC_MANAGER_URL ?? "http://127.0.0.1:26082",
    status: "ready",
    owner: "release manager",
    evidence: "delivery, gate, and surface status"
  }
];

export const managerMetrics: ManagerMetric[] = [
  {
    label: "Stage 0 Rev2 completion",
    value: "94.21%",
    detail: "358 of 380 checklist rows closed; release gates remain evidence-bound"
  },
  {
    label: "Open release items",
    value: "22",
    detail: "CI, staging, production billing, and launch no-go closure"
  },
  {
    label: "Execution lanes",
    value: "40",
    detail: "worker claims are provisional; master integration is dependency-gated"
  },
  {
    label: "Registered local ports",
    value: "4",
    detail: "backend, user web, admin, and manager surfaces avoid shared defaults"
  }
];

export const deliveryLanes: DeliveryLane[] = [
  {
    lane: "CI evidence",
    focus: "Installed PR/main run, Playwright smoke, Docker image build",
    state: "ready",
    nextAction: "Integrate only validator-resolvable ops/evidence/ci artifacts"
  },
  {
    lane: "Staging evidence",
    focus: "Object retention and legal/support external-user visibility",
    state: "ready",
    nextAction: "Require exact ops/evidence/staging JSON references"
  },
  {
    lane: "Production deferred",
    focus: "Paid lifecycle, refund/webhook, backup, rollback, post-deploy smoke",
    state: "provisional",
    nextAction: "Keep Stripe/payment rows open unless real production evidence exists"
  },
  {
    lane: "Release gate",
    focus: "Do-Not-Launch condition reconciliation",
    state: "blocked",
    nextAction: "Close only after CI, staging, and production dependencies are complete"
  }
];
