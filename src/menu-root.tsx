import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import './styles/tailwind.css';
import { Floating3DMenu, type MenuItem } from './components/Floating3DMenu';

/** Bridges the vanilla three.js page and the React menu. */
export function mountMenu(host: HTMLElement, items: MenuItem[], onSelect: (i: number) => void) {
  let active = -1, busy = false, doorOpen = false;
  const listeners = new Set<() => void>();
  const store = {
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    get: () => active,
    getBusy: () => busy,
    getDoor: () => doorOpen,
  };
  function Menu() {
    const a = useSyncExternalStore(store.subscribe, store.get);
    const b = useSyncExternalStore(store.subscribe, store.getBusy);
    const d = useSyncExternalStore(store.subscribe, store.getDoor);
    return <Floating3DMenu busy={b} doorOpen={d} items={items} activeIndex={a} onSelect={onSelect} layout="grid" minSlots={3} />;
  }
  // keep the whole printer on screen on short windows
  const fit = () => { const k = Math.min(1.3, (innerHeight - 230) / 500); host.style.transform = `translate(-50%,-50%) scale(${Math.max(0.6, k)})`; host.dispatchEvent(new Event('fit')); };
  fit(); addEventListener('resize', fit);
  createRoot(host).render(<Menu />);
  return { setDoorOpen(o: boolean) { if (o !== doorOpen) { doorOpen = o; listeners.forEach(l => l()); } }, setBusy(b: boolean) { if (b !== busy) { busy = b; listeners.forEach(l => l()); } }, setActive(i: number) { if (i !== active) { active = i; listeners.forEach(l => l()); } } };
}
