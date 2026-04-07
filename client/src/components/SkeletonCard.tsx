export function SkeletonNoteCard() {
  return (
    <div className="note-card skeleton-container" style={{ cursor: 'default' }}>
      <div className="skeleton skeleton-img" />
      <div className="skeleton skeleton-text short" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text" style={{ width: '80%' }} />
    </div>
  );
}

export function SkeletonPhotoCard() {
  return (
    <div className="gallery-polaroid skeleton-container" style={{ background: '#fff', paddingBottom: 40 }}>
      <div className="skeleton" style={{ width: '100%', aspectRatio: '1/1', borderRadius: 2 }} />
      <div className="skeleton skeleton-text" style={{ width: '60%', margin: '14px auto 0' }} />
    </div>
  );
}
