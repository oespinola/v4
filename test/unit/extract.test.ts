import { describe, expect, it } from 'vitest';
import { extractFields } from '../../src/domain/extract.ts';
import { alerts, fakeImage } from '../fixtures/alerts.ts';
import { FakeExtractor } from '../fakes/index.ts';

const noSl = alerts.kaia.replace(/SL: .*\n/, '');

function msg(text: string) {
  let downloads = 0;
  return {
    text,
    downloadImage: async () => {
      downloads++;
      return fakeImage;
    },
    downloads: () => downloads,
  };
}

describe('extracción regex → IA (FR-003 a FR-005, FR-059)', () => {
  it('con el texto completo no llama a la IA ni descarga la imagen (AC-20)', async () => {
    const ia = new FakeExtractor();
    const m = msg(alerts.kaia);
    const r = await extractFields(m, ia);
    expect(r.complete).toBe(true);
    expect(ia.calls).toHaveLength(0);
    expect(m.downloads()).toBe(0);
  });

  it('completa desde la imagen solo los datos que faltan (AC-14)', async () => {
    const ia = new FakeExtractor({ sl: 0.0414 });
    const m = msg(noSl);
    const r = await extractFields(m, ia);
    expect(ia.calls).toEqual([{ text: noSl, image: fakeImage, missing: ['sl'] }]);
    expect(r).toEqual({
      complete: true,
      fields: { ticker: 'KAIA', entry: 0.0402, target: { price: 0.038 }, sl: 0.0414, riskLevel: 'Alto' },
    });
  });

  it('lo que sacó el regex manda sobre lo que devuelve la IA', async () => {
    const ia = new FakeExtractor({ ticker: 'OTRO', entry: 999, sl: 0.0414 });
    const r = await extractFields(msg(noSl), ia);
    expect(r.complete && r.fields).toMatchObject({ ticker: 'KAIA', entry: 0.0402, sl: 0.0414 });
  });

  it('si la IA no completa lo que falta, queda incompleta con los faltantes (AC-21)', async () => {
    const r = await extractFields(msg(noSl), new FakeExtractor({}));
    expect(r).toMatchObject({ complete: false, missing: ['sl'] });
  });

  it('si la IA falla, los datos cuentan como faltantes (FR-059)', async () => {
    const ia = new FakeExtractor(async () => {
      throw new Error('timeout');
    });
    const r = await extractFields(msg(noSl), ia);
    expect(r).toMatchObject({ complete: false, missing: ['sl'] });
  });

  it.fails('sin extractor (sin key de IA) queda incompleta sin descargar la imagen (AC-76)', async () => {
    const m = msg(noSl);
    const r = await extractFields(m, null);
    expect(r).toMatchObject({ complete: false, missing: ['sl'] });
    expect(m.downloads()).toBe(0);
  });

  it('si falla la descarga de la imagen, igual le pasa el texto a la IA', async () => {
    const ia = new FakeExtractor({ sl: 0.0414 });
    const r = await extractFields(
      {
        text: noSl,
        downloadImage: async () => {
          throw new Error('r');
        },
      },
      ia,
    );
    expect(ia.calls[0]?.image).toBeNull();
    expect(r.complete).toBe(true);
  });
});
