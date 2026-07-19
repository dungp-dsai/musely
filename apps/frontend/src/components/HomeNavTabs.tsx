type PrimaryTab = "feed" | "write" | "research";

export const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "research", label: "Research" },
  { id: "write", label: "Write" },
];

/** Quiet text tabs — identity is the brand, not chrome. */
export default function HomeNavTabs({
  view,
  onChange,
}: {
  view: PrimaryTab;
  onChange: (id: PrimaryTab) => void;
}) {
  return (
    <nav className="home-tabs" role="tablist" aria-label="Main">
      {PRIMARY_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={view === tab.id}
          className={`home-tab ${view === tab.id ? "active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
