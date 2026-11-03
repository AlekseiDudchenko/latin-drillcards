/** Shared look and preference of the audio controls: the word card and every exercise page use these. */
const AUTO_SPEECH_KEY = 'dc_v2_word_auto_speak';
let autoSpeechFallback = true;
/** One switch for all exercises; on by default, as on the word cards. */
export function autoSpeechEnabled(): boolean {
  try { const stored = localStorage.getItem(AUTO_SPEECH_KEY); return stored === null ? autoSpeechFallback : stored !== '0'; }
  catch { return autoSpeechFallback; }
}
export function setAutoSpeech(enabled: boolean): void {
  autoSpeechFallback = enabled;
  try { localStorage.setItem(AUTO_SPEECH_KEY, enabled ? '1' : '0'); } catch { /* Keep the preference for this page if storage is unavailable. */ }
}

const SVG = 'http://www.w3.org/2000/svg';
/** The auto-speech switch, as on the word card: one shared preference, speaker icon on a sliding thumb. */
export function autoSpeechSwitch(label: string, onToggle: () => void): HTMLButtonElement {
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'dc-speak'; toggle.dataset.focusKey = 'auto-speech';
  toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(autoSpeechEnabled()));
  toggle.setAttribute('aria-label', label); toggle.title = label;
  const thumb = document.createElement('span'); thumb.className = 'dc-speak-thumb'; thumb.setAttribute('aria-hidden', 'true'); thumb.append(speakerIcon()); toggle.append(thumb);
  toggle.addEventListener('click', () => { setAutoSpeech(!autoSpeechEnabled()); onToggle(); });
  return toggle;
}

/** Shown while the text is being read: the next click stops it. */
export function stopIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('aria-hidden', 'true');
  const square = document.createElementNS(SVG, 'rect');
  for (const [name, value] of Object.entries({ x: '6', y: '6', width: '12', height: '12', rx: '2', fill: 'currentColor' })) square.setAttribute(name, value);
  svg.append(square); return svg;
}

export function speakerIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attributes] of [['path', { d: 'M11 5 6 9H3v6h3l5 4z', fill: 'currentColor' }], ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }],
    ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]] as const) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    svg.append(node);
  }
  return svg;
}
