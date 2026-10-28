// `pnpm latency`: p95 de clasificación y de aceptación de la entrada sobre el log (SC-001, SC-002),
// por alertas solo con texto y con imagen. Sale con 1 si alguna medición con lote completo falla.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../src/config.ts';
import { latencyReport, MIN_BATCH } from '../src/latency.ts';

loadDotEnv();
const file = path.join(process.env.SIGNALBRIDGE_DATA_DIR?.trim() || 'data', 'alerts.log');
if (!existsSync(file)) {
  console.error(`No existe ${file}: corré la app en DRY primero.`);
  process.exit(1);
}
const report = latencyReport(readFileSync(file, 'utf8').split('\n'));
for (const r of report) {
  const p = r.p95 === null ? '—' : `${(r.p95 / 1000).toFixed(2)} s`;
  const verdict = r.ok === null ? `lote incompleto (${r.n}/${MIN_BATCH})` : r.ok ? 'OK' : 'FALLA';
  console.log(`${r.name.padEnd(30)} p95 ${p.padStart(8)}  límite ${r.limitMs / 1000} s  n=${r.n}  ${verdict}`);
}
process.exit(report.some((r) => r.ok === false) ? 1 : 0);
