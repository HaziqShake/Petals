import { PetalIcon } from './Icons';

interface Props {
  pullDist: number;
  isRefreshing: boolean;
  threshold: number;
}

export function PullToRefreshIndicator({ pullDist, isRefreshing, threshold }: Props) {
  const opacity = Math.min(pullDist / threshold, 1);
  const rotation = (pullDist / threshold) * 360;

  return (
    <div
      className={`pull-indicator-container ${isRefreshing ? 'refreshing' : ''}`}
      style={{
        transform: `translateY(${pullDist}px)`,
        opacity,
        transition: isRefreshing ? 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' : 'none',
      }}
    >
      <div 
        className="pull-indicator-icon"
        style={{ transform: `rotate(${rotation}deg)` }}
      >
        <PetalIcon size={24} color="var(--accent)" />
      </div>
    </div>
  );
}
