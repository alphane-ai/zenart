import type { AdminSession } from "@/lib/types";

export async function getAdminSession(): Promise<AdminSession> {
  return {
    id: "local-dev-admin",
    name: "Local Admin",
    role: "local-dev-admin",
    environment: "local/dev"
  };
}
