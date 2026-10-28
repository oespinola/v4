# Contrato: puertos internos (dominio ↔ adaptadores)

El dominio solo conoce estas interfaces; cada una tiene un adaptador real y un *fake* para tests
(Principio I, Principio IV). Firmas en TypeScript, a nivel de contrato.

## FieldExtractor (IA, FR-004, FR-059)

```ts
interface FieldExtractor {
  // Completa solo los campos de `missing`. Nunca lanza: error, timeout (8 s) o respuesta
  // inválida devuelven {} y la alerta queda "incompleta".
  extract(input: { text: string; image: Buffer | null; missing: Field[] }): Promise<Partial<RawFields>>;
}
```

Adaptador real: `claude-extractor.ts` (Claude con salida estructurada validada con zod).

## MarketData (público, FR-009, FR-015, FR-017)

```ts
interface MarketData {
  symbol(name: string): SymbolFilters | undefined;   // copia local
  ranking(): { gainers: string[]; losers: string[]; refreshedAt: Date };
  closes45m(symbol: string): Promise<number[]>;       // de velas de 15 min agrupadas, incluye la vela en curso
}
```

## Exchange (operación, modo activo, FR-021 a FR-042, FR-060)

```ts
interface Exchange {
  walletBalanceUsdt(): Promise<number>;                       // FR-024
  prepareSymbol(symbol: string, leverage: number): Promise<void>; // margen aislado + leverage
  placeLimitEntry(o: EntryOrder): Promise<OrderRef>;
  placeStopLoss(symbol: string, side: Side, price: number): Promise<OrderRef>;   // closePosition
  placeTakeProfit(symbol: string, side: Side, price: number): Promise<OrderRef>; // closePosition
  closeAtMarket(symbol: string, side: Side): Promise<OrderRef>;
  cancel(ref: OrderRef): Promise<void>;
  order(ref: OrderRef): Promise<OrderState>;
  openPositions(): Promise<PositionState[]>;
  closingFills(symbol: string, since: Date): Promise<ClosingFill[]>; // causa, PnL, comisiones
}
```

Adaptador real: `binance-trading.ts` (CCXT `binanceusdm`, Demo Trading en DRY).

## MessageSource (WhatsApp, FR-001, FR-047, FR-048, FR-057)

```ts
interface MessageSource {
  onMessage(cb: (m: IncomingMessage) => void): void;
  onEdit(cb: (e: IncomingEdit) => void): void;
  onConnectionChange(cb: (up: boolean) => void): void;
}
```

## Clock

`now()` y temporizadores inyectables, para testear el plazo de 3 minutos, las 24 h de duplicados y los
120 s del ranking sin esperar.
