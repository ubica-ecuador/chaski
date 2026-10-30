import { textUtil } from '@grafana/data';

const XLINK = 'http://www.w3.org/1999/xlink';

/** Sets every link under `node` (and `node` itself) to Grafana's sanitized form of its target. */
function sanitizeLinks(node: Node): void {
  if (!(node instanceof Element)) {
    return;
  }
  const links = node.localName === 'a' ? [node, ...node.querySelectorAll('a')] : [...node.querySelectorAll('a')];
  for (const link of links) {
    for (const [namespace, name] of [
      [null, 'href'],
      [XLINK, 'href'],
    ] as const) {
      const target = link.getAttributeNS(namespace, name);
      if (target !== null) {
        const safe = textUtil.sanitizeUrl(target);
        if (safe !== target) {
          link.setAttributeNS(namespace, name, safe);
        }
      }
    }
  }
}

/**
 * Keeps the links a Mosaic spec draws under `root` safe to click. Plot writes
 * a mark's `href` channel into an <a> as it is, so a spec, or a column it maps
 * to `href`, could otherwise make a `javascript:` link that runs on Grafana's
 * origin. Grafana's own data links go through the same sanitizer. Links Mosaic
 * draws later, as the data changes, are sanitized as they appear, before any
 * click can reach them. Returns the function that stops watching.
 */
export function guardLinks(root: Element): () => void {
  sanitizeLinks(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        sanitizeLinks(record.target);
      }
      record.addedNodes.forEach(sanitizeLinks);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  return () => observer.disconnect();
}
