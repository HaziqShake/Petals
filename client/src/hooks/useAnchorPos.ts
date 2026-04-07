import { useState, useEffect, useRef } from 'react';

export function useAnchorPos(id: string, x: number, y: number) {
  const [pos, setPos] = useState({ left: x + '%', top: y + '%' });
  const frames = useRef(0);

  useEffect(() => {
    let animationFrame: number;
    let lastTop: number | null = null;
    let lastLeft: number | null = null;

    const tick = () => {
      const anchor = document.getElementById(`anchor-${id}`);
      const parent = document.querySelector('.notebook-card');
      if (anchor && parent) {
        const aRect = anchor.getBoundingClientRect();
        const pRect = parent.getBoundingClientRect();
        
        // Calculate where the sticker should be based on the anchor's physical position + pixel offsets x,y
        const left = aRect.left - pRect.left + x;
        const top = aRect.top - pRect.top + y;
        
        // Update DOM State if moved > 0.5px
        if (Math.abs(left - (lastLeft || 0)) > 0.5 || Math.abs(top - (lastTop || 0)) > 0.5 || frames.current < 10) {
          lastLeft = left;
          lastTop = top;
          setPos({ left: left + 'px', top: top + 'px' });
          frames.current++;
        }
      } else {
        setPos({ left: x + '%', top: y + '%' });
      }
      animationFrame = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(animationFrame);
  }, [id, x, y]);

  return pos;
}
