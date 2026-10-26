import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Modal";

const DONE_KEY = "fj-tutorial-done";

type Step = { title: string; body: string; target: string };

// Kept to the essentials: adding music and the controls that change how a
// song plays. Each step spotlights its control when it's on screen.
const STEPS: Step[] = [
  {
    title: "Add music",
    body: "Drop an audio file anywhere on the page, or open Search to upload a file or paste a YouTube, SoundCloud or Bandcamp link. Analysis takes about half a minute.",
    target: '[data-tab-button="search"]',
  },
  {
    title: "Press play",
    body: "Play (or press Space). After the intro, the jukebox keeps jumping between moments that sound alike, so the song never has to end.",
    target: "#viz-play",
  },
  {
    title: "The arcs are the jumps",
    body: "Each arc links two beats that sound alike; a bright line flashes when it jumps. Hold Shift to force a jump now. Click an arc and press Delete to stop it being used.",
    target: "#jukebox-viz",
  },
  {
    title: "Tune the jumps",
    body: "Tuning sets how often and how far it jumps. Lower the threshold for fewer, smoother jumps; raise it for more variety.",
    target: "#tuning",
  },
  {
    title: "Mode and look",
    body: "Switch between Jukebox, Autocanonizer and Wub Machine, and pick a visual style. Styles follow the song's genre until you choose one yourself.",
    target: ".viz-actions",
  },
];

function readDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDone() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Storage blocked: the button just keeps pulsing.
  }
}

// Visible target's box, or null when the control isn't on screen (e.g. the
// tutorial was opened from another tab).
function targetRect(selector: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || (typeof el.checkVisibility === "function" && !el.checkVisibility())) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

// Header button that pulses until the tutorial has been finished or closed
// once, then goes dark; it can always reopen the tutorial.
export function Tutorial() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(readDone);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    markDone();
    setDone(true);
  }, []);

  const current = STEPS[step];

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    document
      .querySelector(current.target)
      ?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    setRect(targetRect(current.target));
  }, [open, current]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const update = () => setRect(targetRect(current.target));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, current]);

  // Keep the card out of the spotlight's way.
  const cardAtTop = rect !== null && rect.top + rect.height / 2 > window.innerHeight / 2;
  const last = step === STEPS.length - 1;
  const pad = 8;

  return (
    <>
      <button
        type="button"
        className={done ? "tutorial-button" : "tutorial-button is-fresh"}
        onClick={() => {
          setStep(0);
          setOpen(true);
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          help
        </span>
        Tutorial
      </button>
      {open &&
        createPortal(
          // Sits just under the (transparent) tutorial modal: its huge shadow
          // dims the page around a hole over the target. With no target on
          // screen it collapses to a point and simply dims everything.
          <div
            className="tutorial-spotlight"
            aria-hidden="true"
            style={
              rect
                ? {
                    top: rect.top - pad,
                    left: rect.left - pad,
                    width: rect.width + pad * 2,
                    height: rect.height + pad * 2,
                  }
                : { top: "50%", left: "50%", width: 0, height: 0 }
            }
          />,
          document.body,
        )}
      {createPortal(
        <Modal
          id="tutorial-modal"
          open={open}
          onClose={close}
          panelClassName={cardAtTop ? "tutorial-card is-top" : "tutorial-card"}
        >
          <button
            type="button"
            className="tutorial-close"
            aria-label="Close tutorial"
            onClick={close}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
          <p className="tutorial-count">
            {step + 1} / {STEPS.length}
          </p>
          <h2 className="tutorial-title">{current.title}</h2>
          <p className="tutorial-body">{current.body}</p>
          <div className="tutorial-actions">
            {step > 0 && (
              <button type="button" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button
              type="button"
              className="tutorial-next"
              onClick={() => (last ? close() : setStep(step + 1))}
            >
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
