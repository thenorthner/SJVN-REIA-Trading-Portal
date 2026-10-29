import { describe, it, expect, beforeEach } from 'vitest';
import { domTranslator } from './translator.js';

// React re-renders a t() string into the same text node when the language
// changes. The translator must take that new text as the original instead of
// writing the previous language back over it (which lasted until a reload).
describe('domTranslator language switch', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><span></span></div>';
    root = document.getElementById('root');
    domTranslator.setLang('en');
  });

  it('keeps the text React writes for the newly chosen language', () => {
    const node = document.createTextNode('ऊर्जा मंत्रालयाच्या अखत्यारीतील');
    root.querySelector('span').appendChild(node);

    domTranslator.setLang('mr');
    expect(node.nodeValue).toBe('ऊर्जा मंत्रालयाच्या अखत्यारीतील');

    node.nodeValue = 'ઊર્જા મંત્રાલય હેઠળ'; // React's re-render for Gujarati
    domTranslator.setLang('gu');
    expect(node.nodeValue).toBe('ઊર્જા મંત્રાલય હેઠળ');

    node.nodeValue = 'A Navratna CPSE'; // React's re-render for English
    domTranslator.setLang('en');
    expect(node.nodeValue).toBe('A Navratna CPSE');
  });

  it('still restores English text it translated itself', () => {
    const node = document.createTextNode('Dashboard');
    root.querySelector('span').appendChild(node);
    domTranslator.setLang('hi');
    expect(node.nodeValue).not.toBe('Dashboard');
    domTranslator.setLang('en');
    expect(node.nodeValue).toBe('Dashboard');
  });
});
