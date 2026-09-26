'use client';

import { useEffect, useState } from 'react';

// Isolate the once-per-second update from the posts and dashboard state.
export function UtcClock() {
  const [clock, setClock] = useState('— — : — — : — —');
  useEffect(() => {
    const ticker = setInterval(() => setClock(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(ticker);
  }, []);
  return <span className="clock">{clock}<small>UTC</small></span>;
}
