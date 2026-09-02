// Guards the guard.
//
// `expectNoA11yViolations` is only worth having if it can fail. A misconfigured
// axe run — wrong rule set, a container that is empty by the time it runs, a
// swallowed promise — passes silently and every component looks accessible.
// These two cases are ones axe is certain to flag, so a green suite here means
// the harness is live.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from './a11y';

describe('expectNoA11yViolations', () => {
  it('fails on an input with no accessible name', async () => {
    const { container } = render(<input type="text" />);

    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it('fails on an image with no alt text', async () => {
    const { container } = render(<img src="/example.png" />);

    await expect(expectNoA11yViolations(container)).rejects.toThrow();
  });

  it('passes on markup that is actually labelled', async () => {
    const { container } = render(
      <>
        <label htmlFor="name">Name</label>
        <input id="name" type="text" />
      </>,
    );

    await expectNoA11yViolations(container);
  });
});
