export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />
}

export function SkeletonRows({ rows = 5, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-16" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`card-pad space-y-4 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <div className="flex gap-3">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 flex-1" />
      </div>
    </div>
  )
}

export default Skeleton
