import { LiveRefresh } from "@/components/live-refresh";
import { DriverTabs } from "./driver-tabs";

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))]">{children}</div>
      <DriverTabs />
      <LiveRefresh scope="driver" intervalMs={10_000} notify="driver" />
    </>
  );
}
