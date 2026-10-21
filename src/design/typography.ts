/** Canvas cannot inherit CSS fonts. Read the same tokens used by DOM and SVG text.
 * Existing ResizeObservers redraw geometry; text widths are measured with this font. */
export function canvasTypography(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  return {
    family: style.getPropertyValue("--font-ui").trim() || style.fontFamily,
    size: Number.parseFloat(style.getPropertyValue("--text-meta")) || 12,
  };
}
