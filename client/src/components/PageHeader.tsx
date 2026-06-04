export default function PageHeader({
  title,
  description,
  right,
  eyebrow,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="page-header flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-5">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.08em] mb-1.5">
            {eyebrow}
          </div>
        )}
        <h1 className="h-display">{title}</h1>
        {description && <p className="t-caption mt-1 page-header-desc">{description}</p>}
      </div>
      {right && (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:flex-shrink-0">
          {right}
        </div>
      )}
    </div>
  );
}
