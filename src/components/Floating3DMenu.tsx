import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface MenuItem {
  id: string;
  label: string;
  image: string;
  accent?: string;
}

export interface Floating3DMenuProps {
  items: MenuItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
  /** minimum number of trays drawn (empty ones are shown as empty trays) */
  minSlots?: number;
  /** 'grid': landing view, two icon-only cells per tray and the door stays open */
  layout?: 'list' | 'grid';
  /** a product is on show: door shut, needle still */
  busy?: boolean;
  /** landing view: set once to swing the door open; it then stays open */
  doorOpen?: boolean;
}

const W = 300;         // printer width (px)
const D = 190;         // printer depth (px)
const SLOT_LIST = 66;       // height of one tray bay
const HEAD = 84;       // printer head zone above the trays (gantry, toolhead, vent)
const FOOT = 30;       // print bed zone below the trays
const TRAY = 5;        // aluminium tray thickness
const SPRING = { type: 'spring', stiffness: 190, damping: 17, mass: 0.9 } as const;
const INSTANT = { duration: 0 } as const;
const FONT = '"Inter","SF Pro Display","Helvetica Neue",system-ui,sans-serif';

// soft anodised graphite plate: a faint top highlight and a darker underside, no bright metal
const brushed = 'linear-gradient(180deg,#6d675c 0%,#58534a 50%,#413d37 100%)'; // warm cream-tinted plate, kept low and subtle

const face = (extra: CSSProperties): CSSProperties => ({ position: 'absolute', pointerEvents: 'none', ...extra });

/**
 * The menu is a 3D printer drawn as a real 3D box (front, right side and top faces) seen from a tilted angle.
 * Each option sits on its own aluminium tray inside the chamber; the focused one is lit white, the rest are dark.
 */
export function Floating3DMenu({ items, activeIndex, onSelect, className = '', minSlots = 7, layout = 'list', busy = false, doorOpen = false }: Floating3DMenuProps) {
  const grid = layout === 'grid';
  const cols = items.length > 6 ? 3 : 2;   // more products -> three icons per tray, so everything stays visible
  const SLOT = grid ? 88 : SLOT_LIST;
  const reduce = useReducedMotion() ?? false;
  const slots = grid ? Math.max(minSlots, Math.ceil(items.length / cols)) : Math.max(minSlots, items.length);   // trays rendered (extra ones scroll)
  const H = minSlots * (SLOT + TRAY) + TRAY + 62 + HEAD + FOOT;   // body height shows `minSlots` trays at once
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    el.scrollTo({ top: Math.max(0, activeIndex * (SLOT + TRAY) - (SLOT + TRAY) * 2), behavior: reduce ? 'auto' : 'smooth' });
  }, [activeIndex, reduce]);

  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false); // true only once the door has finished opening
  const closeTimer = useRef<number>(0);
  const enter = () => { if (busy || grid) return; window.clearTimeout(closeTimer.current); setOpen(true); };
  const leave = () => { if (grid) return; window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => { setOpen(false); setReady(false); }, 350); };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => { setOpen(doorOpen); if (!doorOpen) setReady(false); }, [doorOpen]);
  const ref = useRef<HTMLDivElement>(null);
  const pick = (e: ReactPointerEvent) => {
    if (!ready) return;
    const hit = document.elementsFromPoint(e.clientX, e.clientY).find(n => n instanceof HTMLElement && n.closest('[data-bay]'));
    const idx = hit && (hit as HTMLElement).closest('[data-bay]')?.getAttribute('data-bay');
    if (idx != null && Number(idx) !== activeIndex) onSelect(Number(idx));
  };

  const filH = 0;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? INSTANT : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`relative ${className}`} style={{ width: W, height: H + filH + 30, perspective: 2100, fontFamily: FONT }}
      onPointerEnter={enter} onPointerLeave={leave} onFocus={enter} onBlur={leave} onPointerUp={pick} ref={ref}>
      <motion.div
        style={{
          position: 'absolute', left: 0, top: filH + 14, width: W, height: H,
          transformStyle: 'preserve-3d', transformOrigin: `50% 40% ${-D / 2}px`, pointerEvents: 'none',
          rotateY: grid ? 14 : 26, rotateX: grid ? -7 : -10,
        }}
      >
        {/* ───── floor shadow, lying flat under the printer ───── */}
        <div aria-hidden style={face({
          left: -D * 0.5, top: H, width: W + D * 0.5, height: D + 30, transformOrigin: 'top', transform: 'rotateX(-90deg) translateZ(-2px)',
          background: 'rgba(0,0,0,.5)', borderRadius: 28, filter: 'blur(26px)',
        })} />

        {/* ───── printer body ───── */}
        {/* left side */}
        <div aria-hidden style={face({
          left: -D, top: 0, width: D, height: H, transformOrigin: 'right', transform: 'rotateY(-90deg)', borderRadius: '22px 0 0 22px',
          background: 'linear-gradient(270deg,#5a5f68 0%,#40444b 50%,#2a2d32 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.22), inset -2px 0 0 rgba(255,255,255,.35)',
        })} />
        {/* top */}
        <div aria-hidden style={face({
          left: 0, top: -D, width: W, height: D, transformOrigin: 'bottom', transform: 'rotateX(90deg)', borderRadius: '22px 22px 0 0',
          background: 'linear-gradient(135deg,#8a8f98,#5d626a)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.3), inset 0 -2px 0 rgba(255,255,255,.35)',
        })} />
        {/* back plate (fills the gap if seen through the door) */}
        <div aria-hidden style={face({ left: 0, top: 0, width: W, height: H, transform: `translateZ(${-D}px)`, background: '#1d1f23', borderRadius: 22 })} />

        {/* front face */}
        <nav aria-label="Toys" style={{
          position: 'absolute', inset: 0, borderRadius: 22, transformStyle: 'preserve-3d', pointerEvents: 'auto',
          background: 'linear-gradient(145deg,#6a6f78 0%,#44484f 45%,#2b2e33 100%)',
          border: '1px solid rgba(255,255,255,.35)', padding: '32px 11px 11px',
          boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.6), inset 0 -3px 6px rgba(0,0,0,.4), inset 0 0 0 3px rgba(255,255,255,.06)',
        }}>
          {/* little touch screen with the CREALITY logo */}
          <div aria-hidden style={{ position: 'absolute', right: 16, top: 4, width: 118, height: 24, borderRadius: 7, background: 'linear-gradient(180deg,#16171a,#050506)',
            boxShadow: '0 0 0 1px rgba(255,255,255,.4), inset 0 1px 0 rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <svg viewBox="0 0 24 22" width="13" height="12"><path d="M12 1.5 22.5 20.5H1.5Z" fill="none" stroke="#8bd84a" strokeWidth="3.4" strokeLinejoin="round" /><path d="M7.4 16.2 12 8l4.6 8.2" fill="none" stroke="#8bd84a" strokeWidth="0" /></svg>
            <span style={{ font: '700 9.5px/1 "Inter","Helvetica Neue",system-ui,sans-serif', letterSpacing: '.14em', color: '#f2f4f7' }}>CREALITY 3D</span>
          </div>
          <div style={{ position: 'relative', height: '100%', transformStyle: 'preserve-3d' }}>
            {/* chamber */}
            <div style={{
              position: 'relative', height: '100%', overflow: 'hidden', borderRadius: 14, background: 'linear-gradient(180deg,#202227,#121316 55%,#0c0d0f)', display: 'flex', flexDirection: 'column',
              border: '1px solid #15171a', boxShadow: 'inset 0 0 26px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.18)',
            }}>
              <Screws />
              <PrinterHead reduce={reduce || busy} still={busy} />
              <div ref={scroller} style={{ position: 'relative', zIndex: 1, flex: '1 1 0', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarWidth: 'none', pointerEvents: 'auto' }}>
              {Array.from({ length: slots }).map((_, i) => {
                const it = items[i];
                return (
                  <div key={i} style={{ position: 'relative', height: SLOT + TRAY }}>
                    {grid
                      ? <div style={{ display: 'flex', height: SLOT }}>
                          {Array.from({ length: cols }, (_, c) => { const k = i * cols + c, g = items[k]; return g
                            ? <Bay key={k} idx={k} item={g} slot={SLOT} grid cols={cols} busy={busy} lit={k === activeIndex} reduce={reduce} ready={ready} onSelect={() => onSelect(k)} />
                            : <div key={k} style={{ flex: 1 }} />; })}
                        </div>
                      : it ? <Bay idx={i} item={it} slot={SLOT} lit={i === activeIndex} reduce={reduce} ready={ready} onSelect={() => onSelect(i)} /> : <div style={{ height: SLOT }} />}
                    {/* tinted shelf plate: thin edges, a soft face */}
                    <div aria-hidden style={{
                      position: 'absolute', left: 6, right: 6, bottom: 0, height: TRAY, background: brushed, borderRadius: '1.5px 1.5px 2px 2px',
                      borderTop: '0.5px solid rgba(240,228,205,.3)', borderBottom: '0.5px solid rgba(0,0,0,.5)',
                      boxShadow: '0 2px 4px -2px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,245,225,.1)',
                    }} />
                  </div>
                );
              })}
              </div>
                          </div>

            {/* glass door, hinged on the left and swung open */}
            <motion.div aria-hidden
              initial={false}
              animate={{ rotateY: open ? -122 : 0 }}
              onAnimationComplete={() => setReady(open)}
              transition={reduce ? INSTANT : { duration: 1.5, ease: [0.45, 0, 0.2, 1] }}
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 14, transformOrigin: '0% 50%',
                border: '5px solid #aeb3ba', backfaceVisibility: 'visible',
                background: 'transparent',
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.4)',
              }}>
              <span style={{ position: 'absolute', right: -9, top: '50%', width: 13, height: 96, marginTop: -48, borderRadius: 7, background: 'linear-gradient(90deg,#f4f5f7,#c9ccd2 60%,#a9adb5)', boxShadow: '0 2px 4px rgba(0,0,0,.45), inset 0 1px 0 #fff' }} />
            </motion.div>
          </div>
        </nav>

        {/* feet */}
        <div aria-hidden style={face({ left: 20, top: H, width: 34, height: 6, background: '#17181b', borderRadius: '0 0 4px 4px' })} />
        <div aria-hidden style={face({ left: W - 54, top: H, width: 34, height: 6, background: '#17181b', borderRadius: '0 0 4px 4px' })} />
      </motion.div>
    </motion.div>
  );
}

const rail = 'linear-gradient(180deg,#e2e5ea,#9298a1 55%,#5c6068)';

/** Threaded lead screws down both sides of the chamber. */
function Screws() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
      {[2.2, 96].map(x => (
        <span key={x} style={{ position: 'absolute', left: `${x}%`, top: 8, bottom: 6, width: 6,
          background: 'repeating-linear-gradient(180deg,#4a4d55 0 2px,#202226 2px 4px)', boxShadow: '0 0 0 1px rgba(0,0,0,.55)', opacity: .85 }} />
      ))}
    </div>
  );
}

/** Above the trays: gantry rails, a toolhead that slides side to side with its nozzle needle, a purge box and the hex vent. */
function PrinterHead({ reduce, still }: { reduce: boolean; still: boolean }) {
  return (
    <div aria-hidden style={{ position: 'relative', zIndex: 1, flex: `0 0 ${HEAD}px`, pointerEvents: 'none', overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,.12)', background: 'linear-gradient(180deg,#2a2c32,#17181c)' }}>
      {/* hex vent panel, left */}
      <span style={{ position: 'absolute', left: 16, top: 34, width: 58, height: 40, borderRadius: 3, background: '#0b0c0e', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.16)',
        backgroundImage: 'repeating-linear-gradient(60deg,#565a63 0 1.4px,transparent 1.4px 7px),repeating-linear-gradient(-60deg,#565a63 0 1.4px,transparent 1.4px 7px),repeating-linear-gradient(0deg,#565a63 0 1.4px,transparent 1.4px 7px)' }} />
      {/* purge box, right */}
      <span style={{ position: 'absolute', right: 24, top: 46, width: 40, height: 26, borderRadius: 3, background: 'rgba(190,196,206,.3)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.22)' }} />
      {/* gantry rails across the full width */}
      <span style={{ position: 'absolute', left: 8, right: 8, top: 17, height: 5, borderRadius: 3, background: rail, boxShadow: '0 2px 3px rgba(0,0,0,.6)' }} />
      <span style={{ position: 'absolute', left: 8, right: 8, top: 24, height: 11, borderRadius: 3, background: 'linear-gradient(180deg,#34363c,#17181b)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.18)' }} />
      <span style={{ position: 'absolute', left: 8, right: 8, top: 37, height: 3, borderRadius: 2, background: rail }} />
      {/* the toolhead, with its needle, sliding left and right along the rails */}
      <motion.div
        animate={reduce ? { left: '40%' } : { left: ['6%', '60%', '6%'] }}
        transition={reduce ? (still ? { duration: 0.8, ease: 'easeOut' } : INSTANT) : { duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ position: 'absolute', top: 5, width: 54, height: 36 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '8px 8px 5px 5px', background: 'linear-gradient(180deg,#8a8f98,#464a51)',
          boxShadow: '0 0 0 1px rgba(0,0,0,.6), 0 6px 7px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.55)' }} />
        <span style={{ position: 'absolute', left: '50%', top: 4, marginLeft: -4, width: 8, height: 7, clipPath: 'polygon(50% 0,100% 100%,0 100%)', background: '#eef0f3' }} />
        <span style={{ position: 'absolute', left: 11, right: 11, bottom: 5, height: 13, background: 'repeating-linear-gradient(90deg,#14151a 0 1.5px,transparent 1.5px 4px)' }} />
        <span style={{ position: 'absolute', left: '50%', top: '100%', marginLeft: -6, width: 12, height: 13, borderRadius: '0 0 4px 4px', background: 'linear-gradient(90deg,#15161a,#40434a,#15161a)' }} />
        <span style={{ position: 'absolute', left: '50%', top: 'calc(100% + 12px)', marginLeft: -2.5, width: 5, height: 14, clipPath: 'polygon(0 0,100% 0,50% 100%)', background: 'linear-gradient(90deg,#b9bdc5,#f6f7f9,#8a8f98)' }} />
      </motion.div>
    </div>
  );
}

/** Below the trays: the print bed with its thin yellow edge. */
function PrintBed() {
  return (
    <div aria-hidden style={{ position: 'relative', zIndex: 1, flex: `0 0 ${FOOT}px`, pointerEvents: 'none', borderTop: '1px solid rgba(255,255,255,.1)',
      background: 'linear-gradient(180deg,#17181b,#050506)' }}>
      <span style={{ position: 'absolute', left: 14, right: 14, top: 6, height: 14, borderRadius: '3px 3px 6px 6px', background: 'linear-gradient(180deg,#26282d,#09090b)',
        boxShadow: 'inset 0 1.5px 0 #c8b32a, 0 0 0 1px rgba(255,255,255,.12)' }} />
    </div>
  );
}

function Bay({ idx, item, lit: litProp, reduce, ready, onSelect, slot, grid = false, cols = 2, busy = false }: { idx: number; ready: boolean; item: MenuItem; lit: boolean; reduce: boolean; onSelect: () => void; slot: number; grid?: boolean; cols?: number; busy?: boolean }) {
  const [hv, setHv] = useState(false);
  const lit = litProp || (grid && hv && ready && !busy);
  const img = grid ? (cols > 2 ? 62 : 72) : 54;
  return (
    <motion.button
      type="button"
      aria-current={lit}
      data-bay={idx}
      aria-disabled={!ready}
      aria-label={item.label}
      onPointerEnter={() => setHv(true)} onPointerLeave={() => setHv(false)}
      onClick={() => { if (ready) onSelect(); }}
      className="group"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: grid ? 'center' : 'flex-start', gap: 10, width: grid ? `${100 / cols}%` : '100%', flex: grid ? 1 : undefined, height: slot, padding: grid ? 0 : '0 14px 0 8px',
        border: 0, background: 'transparent', cursor: ready ? 'pointer' : 'default', pointerEvents: ready ? 'auto' : 'none', touchAction: 'manipulation', textAlign: 'left', outline: 'none', overflow: 'hidden', appearance: 'none',
      }}
    >
      {/* a soft light falling on the product: a small lamp at the top and a faint cone of light, kept inside the tray */}
      <span aria-hidden style={{
        position: 'absolute', left: '12%', right: '12%', top: 0, bottom: 4, transition: 'opacity .6s', opacity: lit ? 1 : 0,
        clipPath: 'polygon(36% 0, 64% 0, 100% 100%, 0 100%)',
        background: 'linear-gradient(180deg, rgba(255,255,255,.26) 0%, rgba(255,255,255,.07) 70%, rgba(255,255,255,0) 100%)',
      }} />
      <span aria-hidden style={{
        position: 'absolute', left: '36%', right: '36%', top: 0, height: 2, borderRadius: '0 0 4px 4px', transition: 'all .6s',
        background: lit ? '#fff' : 'rgba(255,255,255,.06)', boxShadow: lit ? '0 0 10px 2px rgba(255,255,255,.7)' : 'none',
      }} />
      <span style={{ position: 'relative', width: img, height: img, flex: 'none', display: 'grid', placeItems: 'center',
        transition: 'filter .5s, opacity .5s, transform .4s', transform: grid && hv && ready && !busy ? 'scale(1.08)' : 'none', filter: lit || grid ? 'none' : 'brightness(.62) saturate(.75)', opacity: lit || grid ? 1 : 0.92 }}>
        <img src={item.image} alt="" draggable={false} style={{ width: img, height: img, objectFit: 'contain', filter: 'drop-shadow(0 5px 6px rgba(0,0,0,.45))' }} />
      </span>
      {!grid && <span style={{
        position: 'relative', fontSize: 11.5, fontWeight: 500, letterSpacing: '.03em', lineHeight: 1.25, transition: 'color .5s',
        color: lit ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.34)',
      }}>
        {item.label}
      </span>}
    </motion.button>
  );
}

export default Floating3DMenu;
