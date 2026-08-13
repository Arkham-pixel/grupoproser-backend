import '../config/loadEnv.js';
import { listFolder, getFolderByPath } from '../services/microsoftGraphService.js';

async function tryPath(p) {
  try {
    const meta = await getFolderByPath(p);
    console.log('META OK', p, { id: meta?.id, name: meta?.name, folder: Boolean(meta?.folder) });
  } catch (e) {
    console.log('META FAIL', p, e.message);
  }
  try {
    const r = await listFolder(p, { top: 50 });
    const kids = r.children || [];
    console.log(
      'LIST OK',
      p,
      'count',
      kids.length,
      kids.slice(0, 30).map((c) => `${c.name}${c.folder ? '/' : ''}`)
    );
  } catch (e) {
    console.log('LIST FAIL', p, e.message);
  }
}

await tryPath('SEGUROS ALFA');
await tryPath('SEGUROS ALFA/PÓLIZAS');
await tryPath('SEGUROS ALFA/POLIZAS');
await tryPath('SEGUROS ALFA/' + 'P\u00D3LIZAS');
await tryPath('SEGUROS ALFA/CONTROL Y SEGUIMIENTO');
await tryPath('SEGUROS ALFA/PÓLIZAS/88187559');
