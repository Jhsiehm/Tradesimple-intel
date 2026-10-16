import { useEffect, useState, type CSSProperties } from 'react';
import './palettePreview.css';
const core = [['Midnight', 'midnight'], ['Atlas Green', 'atlas'], ['Ivory', 'ivory'], ['Stone', 'stone'], ['Slate', 'slate'], ['Brass', 'brass']];
const chroma = [['Ocean Blue', 'blue'], ['Amber', 'amber'], ['Crimson', 'crimson'], ['Violet', 'violet'], ['Cyan', 'cyan'], ['Lime', 'lime'], ['Orange', 'orange'], ['Pink', 'pink']];
const luminance = (hex: string) => {
  const c = hex.replace('#', '').match(/.{2}/g)?.map(v => { const s = parseInt(v, 16) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }) || [];
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
};
const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
export function PalettePreview() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [surface, setSurface] = useState('--bg');
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const keys = [...core.map(([, key]) => `--tsi-core-${key}`), ...chroma.map(([, key]) => `--tsi-chroma-${key}`), '--bg', '--amber', '--cyan', '--green', '--nay'];
    setValues(Object.fromEntries(keys.map(key => [key, css.getPropertyValue(key).trim()])));
  }, []);
  const cards = (items: string[][], prefix: string) => items.map(([name, key]) => {
    const token = `${prefix}${key}`, hex = values[token], ratio = hex && values[surface] ? contrast(hex, values[surface]) : null;
    return <article key={key} className="palette-card" style={{ '--swatch': `var(${token})` } as CSSProperties}>
      <div className="palette-color" aria-hidden="true"/><h3>{name}</h3><code>{hex || '…'}</code><code>{token}</code>
      <div className="palette-tones" aria-label="Tint, base, and shade"><span>Tint +25% ivory</span><span>Base</span><span>Shade +30% midnight</span></div>
      <div className="palette-sample" style={{ background: `var(${surface})` }}>Aa · Research 012345</div>
      <p>{ratio ? `${ratio.toFixed(2)}:1 · ${ratio >= 4.5 ? 'AA normal text' : ratio >= 3 ? 'AA large text only' : 'Below text thresholds'}` : 'Calculating contrast…'}</p>
    </article>;
  });
  return <main className="palette-preview"><header><p className="palette-eyebrow">TRADESIMPLE INTEL / DESIGN STUDY 01</p><h1>Extended chromatic palette</h1><p>Development preview. Existing terminal surfaces and semantic colors remain unchanged.</p><a href="#research">Return to Research ↗</a></header>
    <section className="palette-controls"><label>Contrast sample background <select value={surface} onChange={e => setSurface(e.target.value)}><option value="--bg">Existing terminal</option><option value="--tsi-core-midnight">Proposed midnight</option><option value="--tsi-core-ivory">Ivory</option></select></label><p>Ratios use opaque sRGB foreground/background pairs. Text thresholds: 4.5:1 normal, 3:1 large. Swatches and tinted variants are decorative; each eventual visualization needs its own review.</p></section>
    <section><h2>01 / Core brand</h2><div className="palette-grid">{cards(core, '--tsi-core-')}</div></section>
    <section><h2>02 / Extended chromatic</h2><div className="palette-grid">{cards(chroma, '--tsi-chroma-')}</div></section>
    <section><h2>03 / Existing and proposed accents</h2><p>These are comparisons, not replacements. Vote and market meanings stay with their existing tokens.</p><div className="palette-comparisons">{[['Amber', '--amber', '--tsi-chroma-amber'], ['Cyan', '--cyan', '--tsi-chroma-cyan'], ['Positive / lime', '--green', '--tsi-chroma-lime'], ['Negative / crimson', '--nay', '--tsi-chroma-crimson']].map(([name, old, next]) => <article key={name}><h3>{name}</h3><p style={{ color: `var(${old})` }}>Existing · {values[old]}</p><p style={{ color: `var(${next})` }}>Proposed · {values[next]}</p></article>)}</div></section>
    <section><h2>04 / Pairing studies</h2><div className="palette-pairings"><article><h3>Ivory × midnight</h3><p>Quiet surfaces, precise typography.</p></article><article><h3>Cyan × atlas</h3><p>Selected categories with explicit labels.</p></article><article><h3>Brass × midnight</h3><p>Restrained structural accents.</p></article></div></section><footer>Stage A only · no visualization mappings changed · relationship graph pilot awaits review.</footer>
  </main>;
}
