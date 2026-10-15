import { useEffect, useLayoutEffect, useRef, useState } from "react";

// One-line label for sidebar rows. Text that doesn't fit fades out at the edge
// instead of ending in "…" and glides through the whole text like Apple's
// marquees, scrolling on until a looped copy takes the original's place: one
// pass every so often on its own, and continuously (resting between passes)
// while its row is hovered. The left edge fades in only while it moves.

const SPEED = 30; // px per second
const REST = 1600; // ms resting at the start of each hovered pass
const DELAY = 500; // ms of hover before the first pass
const AUTO_EVERY = 10000; // ms between passes on their own
const AUTO_SPACING = 1500; // ms kept between any two rows setting off
const FADE = "16px"; // left fade while moving

// When some row last began a pass on its own — shared, so rows take turns.
let lastAutoStart = -Infinity;

interface MarqueeTextProps {
  text: string;
  className?: string;
  /** The row whose hover starts the scroll. */
  hostSelector?: string;
}

export default function MarqueeText({ text, className = "", hostSelector = ".tab" }: MarqueeTextProps) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // Fits or not: the box narrows when the row's close button appears on
  // hover, on sidebar resizes, and once the UI font finishes loading.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = textRef.current;
    if (!box || !txt) return;
    const measure = () => setOverflowing(txt.offsetWidth > box.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(txt);
    return () => ro.disconnect();
  }, [text]);

  useEffect(() => {
    const box = boxRef.current;
    const track = trackRef.current;
    const txt = textRef.current;
    const host = box?.closest<HTMLElement>(hostSelector);
    if (!overflowing || !box || !track || !txt || !host) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let moving: Animation[] = [];
    let mode: "idle" | "auto" | "hover" = "idle";
    let timer = 0;

    // Scroll the track: one pass on its own, or endlessly (resting before
    // each pass) while hovered. A pass moves the copy exactly into the
    // original's place, so each one ends on the picture it started from.
    const animate = (loop: boolean) => {
      const shift = txt.offsetWidth + parseFloat(getComputedStyle(track).columnGap);
      const rest = loop ? REST : 0;
      const duration = rest + (shift / SPEED) * 1000;
      const r = rest / duration;
      const ramp = Math.min(0.04, (1 - r) / 4);
      const timing: KeyframeAnimationOptions = loop
        ? // skip into the rest so the first pass begins after DELAY, not REST
          { duration, iterations: Infinity, iterationStart: (REST - DELAY) / duration }
        : { duration };
      moving = [
        track.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(0)", offset: r },
            { transform: `translateX(${-shift}px)` },
          ],
          timing,
        ),
        box.animate(
          [
            { "--fade-l": "0px" },
            { "--fade-l": "0px", offset: r },
            { "--fade-l": FADE, offset: r + ramp },
            { "--fade-l": FADE, offset: 1 - ramp },
            { "--fade-l": "0px" },
          ],
          timing,
        ),
      ];
    };

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(autoPass, ms);
    };
    const autoPass = () => {
      if (mode !== "idle") return;
      if (document.hidden) return schedule(AUTO_EVERY);
      const now = performance.now();
      if (now - lastAutoStart < AUTO_SPACING)
        return schedule(AUTO_SPACING * (1 + Math.random()));
      lastAutoStart = now;
      mode = "auto";
      animate(false);
      moving[0].onfinish = () => {
        moving = [];
        mode = "idle";
        // hovered mid-pass: carry straight on into the hover loop
        if (host.matches(":hover")) start();
        else schedule(AUTO_EVERY);
      };
    };

    const start = () => {
      // an automatic pass finishes first, then hands over (see autoPass)
      if (mode !== "idle") return;
      clearTimeout(timer);
      mode = "hover";
      animate(true);
    };
    const stop = () => {
      if (mode !== "hover") return;
      const t = getComputedStyle(track).transform;
      const x = t === "none" ? 0 : new DOMMatrixReadOnly(t).m41;
      moving.forEach((a) => a.cancel());
      moving = [];
      mode = "idle";
      schedule(AUTO_EVERY);
      if (x > -1) return; // still resting at the start
      // Mid-pass: dip out, snap home, fade back in — rather than rewinding.
      track.animate(
        [
          { transform: `translateX(${x}px)`, opacity: 1 },
          { transform: `translateX(${x}px)`, opacity: 0, offset: 0.4 },
          { transform: "translateX(0)", opacity: 0, offset: 0.4 },
          { transform: "translateX(0)", opacity: 1 },
        ],
        { duration: 300, easing: "ease-out" },
      );
    };

    host.addEventListener("mouseenter", start);
    host.addEventListener("mouseleave", stop);
    // It may start overflowing while already hovered (the close button
    // appearing is what narrowed it).
    if (host.matches(":hover")) start();
    // Stagger the first pass so long titles don't all set off together.
    else schedule(2000 + Math.random() * (AUTO_EVERY - 2000));
    return () => {
      host.removeEventListener("mouseenter", start);
      host.removeEventListener("mouseleave", stop);
      if (mode === "hover") stop();
      else moving.forEach((a) => a.cancel());
      clearTimeout(timer);
    };
  }, [overflowing, text, hostSelector]);

  return (
    <span
      ref={boxRef}
      className={`marquee${overflowing ? " overflowing" : ""}${className ? ` ${className}` : ""}`}
    >
      <span ref={trackRef} className="marquee-track">
        {/* data-text feeds the working-shine overlay (sidebar.css) */}
        <span ref={textRef} data-text={text}>{text}</span>
        {overflowing && <span aria-hidden="true" data-text={text}>{text}</span>}
      </span>
    </span>
  );
}
