import { describe, expect, it } from 'vitest';

describe('smoke', () => {
  it('el entorno de tests corre', () => {
    expect(1 + 1).toBe(2);
  });
});
