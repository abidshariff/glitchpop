import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import './styles/tailwind.css';
import { Floating3DMenu, type MenuItem } from './components/Floating3DMenu';

/** Bridges the vanilla three.js page and the React menu. */
export function mountMenu(host: HTMLElement, items: MenuItem[], onSelect: (i: number) => void) {
  let active = 0;
  const listeners = new Set<() => void>();
  const store = {
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    get: () => active,
  };
  function Menu() {
    const a = useSyncExternalStore(store.subscribe, store.get);
    return <Floating3DMenu items={items} activeIndex={a} onSelect={onSelect} />;
  }
  // keep the whole printer on screen on short windows
  const fit = () => { const k = Math.min(0.9, (innerHeight - 24) / 900); host.style.transform = `translateY(-50%) scale(${k})`; };
  fit(); addEventListener('resize', fit);
  createRoot(host).render(<Menu />);
  return { setActive(i: number) { if (i !== active) { active = i; listeners.forEach(l => l()); } } };
}
