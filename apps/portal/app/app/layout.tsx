import type { ReactNode } from "react";
import { DashboardShellClient } from "./dashboard-shell-client";

export default function AppLayout({ children }: { children: ReactNode }) {
  return <DashboardShellClient>{children}</DashboardShellClient>;
}
