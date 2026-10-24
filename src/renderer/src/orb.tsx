import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './bridge';
import './orb.css';

/**
 * The desktop orb: a tiny always-on-top window that sits anywhere on the desktop. Hover (a moment) or click it to
 * open the quick launcher. Drag it to move it. It never takes keyboard focus.
 */
function Orb() {
  const [tint, setTint] = useState('#7c5cff');
  const [hot, setHot] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    void api.settings.get().then((r) => setTint(r.settings.tint));
    const off = api.onShow(() => void api.settings.get().then((r) => setTint(r.settings.tint)));
    return off;
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--tint', tint);
  }, [tint]);
  const enter = () => {
    setHot(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => api.orb.open(), 320);
  };
  const leave = () => {
    setHot(false);
    window.clearTimeout(timer.current);
  };
  return (
    <div className={`dorb${hot ? ' hot' : ''}`} onMouseEnter={enter} onMouseLeave={leave} onClick={() => api.orb.open()} title="FATAAK · hover or click to ask">
      <div className="orb-ring" />
      <div className="orb-core" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Orb />
  </React.StrictMode>,
);
