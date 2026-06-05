import dns from 'dns';

/**
 * Atlas usa registros SRV; algunos DNS de red (p. ej. routers ZTE) los rechazan.
 * Misma lógica que scripts/ (MONGO_DNS_SERVERS, MONGO_SKIP_PUBLIC_DNS).
 */
export function applyMongoDnsServers() {
  if (process.env.MONGO_SKIP_PUBLIC_DNS === '1') {
    if (process.env.MONGO_DNS_SERVERS) {
      dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
      console.log('🌐 DNS MongoDB: servidores personalizados (MONGO_DNS_SERVERS)');
    }
    return;
  }

  if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()));
    console.log('🌐 DNS MongoDB: servidores personalizados (MONGO_DNS_SERVERS)');
    return;
  }

  dns.setServers(['8.8.8.8', '1.1.1.1']);
  console.log('🌐 DNS MongoDB: 8.8.8.8, 1.1.1.1 (evita fallos SRV en DNS de red local)');
}

applyMongoDnsServers();
