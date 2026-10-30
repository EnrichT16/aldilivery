import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * A page of the Ambassador Toolkit to print, or save as a PDF, from the browser (30 October 2026):
 * its own heading and buttons on the screen, and only the sheet itself on paper, at the size it
 * is made for. `?action=print` or `?action=pdf`, from the Toolkit's buttons, opens the print
 * window at once; for a PDF the person chooses "Save as PDF" there, as the screen says.
 */

/** Opens the browser's print window, where there is one. */
export function openPrint(): void {
  try {
    if (typeof window.print === 'function') window.print();
  } catch {
    // No print window here: the buttons stay on the screen.
  }
}

export function PrintSheet({
  title,
  pageSize,
  children,
  extra,
}: {
  /** The page's heading, on the screen only. */
  title: string;
  /** The CSS page size: "A5", "A6" or "120mm 120mm". */
  pageSize: string;
  children: ReactNode;
  /** More buttons, such as Share. */
  extra?: ReactNode;
}): JSX.Element {
  const [params] = useSearchParams();
  const action = params.get('action');
  const done = useRef(false);

  useEffect(() => {
    if (done.current || (action !== 'print' && action !== 'pdf')) return;
    done.current = true;
    // A moment for the sheet and its fonts to be drawn first.
    const timer = window.setTimeout(openPrint, 400);
    return () => window.clearTimeout(timer);
  }, [action]);

  return (
    <div className="space-y-6">
      <style>{`
        @page { size: ${pageSize}; margin: 0; }
        .print-area { overflow-x: auto; max-width: 100%; }
        @media print {
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; left: 0; top: 0; overflow: visible; }
        }
      `}</style>
      <div className="space-y-3 no-print">
        <h1 className="text-display font-bold m-0">{title}</h1>
        <p className="m-0">
          To save it as a PDF, press Download PDF, then choose &ldquo;Save as PDF&rdquo; in the
          print window.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={openPrint} className="control bg-highlight text-on-accent">
            Print
          </button>
          <button
            type="button"
            onClick={openPrint}
            className="control border-paper bg-paper/10 text-paper"
          >
            Download PDF
          </button>
          {extra}
          <Link
            to="/ambassador/home?tab=toolkit"
            className="control border-paper bg-paper/10 text-paper"
          >
            Back to the Toolkit
          </Link>
        </div>
      </div>
      <div className="print-area">{children}</div>
    </div>
  );
}
