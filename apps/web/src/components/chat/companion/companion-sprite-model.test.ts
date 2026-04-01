import { describe, expect, it } from 'vitest';
import {
  createCompanionSpriteBones,
  renderCompanionFace,
  renderCompanionSprite,
  spriteFrameCount,
} from './companion-sprite-model.js';

describe('companion-sprite-model', () => {
  it('creates stable sprite bones for the same seed', () => {
    const first = createCompanionSpriteBones('buddy@example.com');
    const second = createCompanionSpriteBones('buddy@example.com');

    expect(first).toEqual(second);
  });

  it('returns the expected frame count and hat line for sprite rendering', () => {
    const sprite = renderCompanionSprite(
      {
        eye: '✦',
        hat: 'crown',
        rarity: 'rare',
        shiny: false,
        species: 'duck',
      },
      0,
    );

    expect(spriteFrameCount('duck')).toBe(3);
    expect(sprite[0]).toContain('^^^');
    expect(sprite.join('')).toContain('✦');
  });

  it('renders a compact face string from sprite bones', () => {
    const face = renderCompanionFace({
      eye: '@',
      hat: 'none',
      rarity: 'common',
      shiny: false,
      species: 'robot',
    });

    expect(face).toBe('[@@]');
  });
});
