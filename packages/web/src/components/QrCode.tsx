/**
 * A QR code drawn in the app (Anthony, 30 October 2026: the Ambassador Toolkit), so every flyer,
 * card and agreement sheet carries the Ambassador's own link and can only be made here. Encoded
 * with the QR encoder already in the app for the product scanner, drawn as one SVG path.
 *
 * For a screen reader it is one image named for what it does, with the link written beside it
 * wherever it is shown, so nobody needs to scan it.
 */

import { QRCodeDecoderErrorCorrectionLevel, QRCodeEncoder } from '@zxing/library';
import { useMemo } from 'react';

/** The dark squares of the code for this text, as rows of true and false. */
export function qrMatrix(text: string): boolean[][] {
  const matrix = QRCodeEncoder.encode(text, QRCodeDecoderErrorCorrectionLevel.M).getMatrix();
  const rows: boolean[][] = [];
  for (let y = 0; y < matrix.getHeight(); y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < matrix.getWidth(); x += 1) row.push(matrix.get(x, y) === 1);
    rows.push(row);
  }
  return rows;
}

export function QrCode({
  value,
  label,
  className = '',
  dark = '#0B1F3A',
}: {
  value: string;
  /** What scanning it does: "QR code for Ada's link to join as a Runner". */
  label: string;
  className?: string;
  dark?: string;
}): JSX.Element {
  const { size, path } = useMemo(() => {
    const rows = qrMatrix(value);
    const margin = 2;
    let d = '';
    rows.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x + margin} ${y + margin}h1v1h-1z`;
      });
    });
    return { size: rows.length + margin * 2, path: d };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
      data-qr-value={value}
    >
      <rect width={size} height={size} fill="#FFFFFF" />
      <path d={path} fill={dark} />
    </svg>
  );
}
