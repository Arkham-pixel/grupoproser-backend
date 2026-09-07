/**
 * Dry-run / apply: compara estados cierre ARNALD vs Excel y reencola gaps.
 * Uso:
 *   node scripts/reconcileAlfaExcelEstadoGaps.js
 *   node scripts/reconcileAlfaExcelEstadoGaps.js --apply
 */
import '../config/loadEnv.js';
import dns from 'dns';
if (process.env.MONGO_SKIP_PUBLIC_DNS !== '1') dns.setServers(['8.8.8.8', '1.1.1.1']);
import mongoose from 'mongoose';
import { reconcileAlfaExcelEstadoGaps } from '../services/alfaExcelOutboundService.js';

const APPLY = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGO_URI_DIRECT || process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 25000,
});

try {
  const summary = await reconcileAlfaExcelEstadoGaps({ apply: APPLY });
  console.log(
    JSON.stringify(
      {
        event: APPLY ? 'RECONCILE_APPLIED' : 'RECONCILE_DRY_RUN',
        ...summary,
        items: undefined,
      },
      null,
      2
    )
  );
  if (!APPLY) {
    console.log(JSON.stringify({ hint: 'Use --apply para reencolar gaps' }));
  }
} finally {
  await mongoose.disconnect();
}
