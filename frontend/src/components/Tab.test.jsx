import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Tab, Tabs } from './ui.jsx';

// A tab switching between selected and unselected used to re-render with both
// the `font` shorthand and a `fontWeight` longhand set on the same element.
// React warns about that because the order the two are applied is not defined,
// so the active tab's weight could be reset by the shorthand. These tests pin
// the fix: the button still takes the page's font, and weight is set by exactly
// one property.

let host;
let root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui) => act(() => root.render(ui));
const button = () => host.querySelector('button');

describe('Tab', () => {
  it('sets the font weight without the font shorthand', () => {
    render(<Tab active>Station bill</Tab>);
    const style = button().getAttribute('style');
    expect(style).toMatch(/font-weight:\s*600/);
    // The shorthand is what caused the conflict; the longhands are fine.
    expect(style).not.toMatch(/(^|;)\s*font:/);
  });

  it('still inherits the page font rather than the browser default', () => {
    render(<Tab active>Station bill</Tab>);
    const style = button().getAttribute('style');
    expect(style).toMatch(/font-family:\s*inherit/);
    expect(style).toMatch(/font-size:\s*inherit/);
  });

  it('changes weight when a tab goes from unselected to selected', () => {
    render(<Tab active={false}>Beneficiary breakup</Tab>);
    expect(button().style.fontWeight).toBe('400');

    // The re-render that produced the warning: the same element, weight flipped.
    render(<Tab active>Beneficiary breakup</Tab>);
    expect(button().style.fontWeight).toBe('600');
    expect(button().getAttribute('style')).not.toMatch(/(^|;)\s*font:/);
  });

  it('is a real button that reports its selected state', () => {
    render(<Tab active>Allocation sheet</Tab>);
    expect(button().tagName).toBe('BUTTON');
    expect(button().getAttribute('type')).toBe('button');
    expect(button().getAttribute('role')).toBe('tab');
    expect(button().getAttribute('aria-selected')).toBe('true');
  });

  it('calls onClick when activated', () => {
    let clicks = 0;
    render(<Tab active={false} onClick={() => { clicks += 1; }}>Station bill</Tab>);
    act(() => button().click());
    expect(clicks).toBe(1);
  });
});

describe('Tabs', () => {
  it('wraps its tabs in a tablist', () => {
    render(
      <Tabs>
        <Tab active>One</Tab>
        <Tab active={false}>Two</Tab>
      </Tabs>,
    );
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(host.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  });
});
