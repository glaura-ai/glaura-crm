// Shared 5-star rating display. Clamps out-of-range ratings (scraped data
// can carry 0-10 scales or junk) so rendering never throws.
export function Stars({ rating }: { rating: number | null }) {
  if (rating == null || !Number.isFinite(rating)) return null;
  const full = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span className="text-amber-400" title={`${rating.toFixed(1)}/5`}>
      {"★".repeat(full)}
      <span className="text-slate-200">{"★".repeat(5 - full)}</span>
    </span>
  );
}
