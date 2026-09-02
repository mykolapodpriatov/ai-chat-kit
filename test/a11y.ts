// Automated accessibility assertions, run inside the normal test suite.
//
// A Storybook a11y panel catches nothing if nobody opens it; a failing test
// stops a merge. Scoped to serious/critical because axe's minor and moderate
// rules produce enough noise on partial DOM fragments to train people to
// ignore the whole report.

import axe, { type AxeResults, type Result } from 'axe-core';
import { expect } from 'vitest';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

function format(violations: Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `      ${node.html}`)
        .join('\n');
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${nodes}\n      ${violation.helpUrl}`;
    })
    .join('\n\n');
}

export async function expectNoA11yViolations(
  container: HTMLElement,
): Promise<void> {
  const results: AxeResults = await axe.run(container, {
    // jsdom has no layout or computed styles, so this rule reports nothing
    // useful here. Contrast is verified visually in Storybook instead.
    rules: { 'color-contrast': { enabled: false } },
  });

  const blocking = results.violations.filter(
    (violation) =>
      violation.impact != null && BLOCKING_IMPACTS.has(violation.impact),
  );

  expect(
    blocking,
    blocking.length > 0
      ? `Accessibility violations:\n\n${format(blocking)}`
      : '',
  ).toHaveLength(0);
}
