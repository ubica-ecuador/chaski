import { guardLinks } from './safeLinks';

const XLINK = 'http://www.w3.org/1999/xlink';
const SVG = 'http://www.w3.org/2000/svg';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An SVG link as Plot draws one for a mark's href channel. */
function plotLink(target: string): Element {
  const a = document.createElementNS(SVG, 'a');
  a.setAttributeNS(XLINK, 'href', target);
  return a;
}

describe('guardLinks', () => {
  it('neutralises a javascript: link already drawn, and keeps an ordinary one', () => {
    const root = document.createElement('div');
    const bad = root.appendChild(plotLink('javascript:alert(document.domain)'));
    const good = root.appendChild(plotLink('https://example.org/station/7'));
    const stop = guardLinks(root);
    expect(bad.getAttributeNS(XLINK, 'href')).toBe('about:blank');
    expect(good.getAttributeNS(XLINK, 'href')).toBe('https://example.org/station/7');
    stop();
  });

  it('neutralises links drawn later and links whose target changes, before anyone can click them', async () => {
    const root = document.createElement('div');
    const stop = guardLinks(root);
    const svg = root.appendChild(document.createElementNS(SVG, 'svg'));
    const later = svg.appendChild(plotLink('JaVaScRiPt:alert(1)'));
    const html = root.appendChild(document.createElement('a'));
    html.setAttribute('href', '/d/abc');
    await settle();
    html.setAttribute('href', 'javascript:alert(2)');
    await settle();
    expect(later.getAttributeNS(XLINK, 'href')).toBe('about:blank');
    expect(html.getAttribute('href')).toBe('about:blank');
    stop();
  });
});
