// Re-mounted on every page change (unlike the layout), so each page — or its loading
// skeleton — fades in instead of snapping. Changing ?date= keeps the same page and doesn't flash.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
