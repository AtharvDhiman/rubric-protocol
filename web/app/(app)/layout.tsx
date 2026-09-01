import { WalletProvider } from "@/components/WalletProvider";
import { AppShell } from "@/components/AppShell";
import { DEMO_MODE } from "@/lib/demo";

/**
 * Layout for the three app screens. The landing page deliberately sits outside
 * this group: it is a different surface (dark, no chrome) and it must not pay
 * the cost of loading wallet adapters.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WalletProvider>
      <AppShell demoMode={DEMO_MODE}>{children}</AppShell>
    </WalletProvider>
  );
}
