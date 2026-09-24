# LiveKit en Coolify (solo video) — checklist

Arnald (plataforma) se queda en el servidor principal.
Este Coolify solo corre **LiveKit** para que las llamadas no tumben Arnald.

## Por qué falló “Docker Image” ayer

1. **Puerto interno 80** — LiveKit escucha en **7880**, no en 80.
2. **DNS mismatch** — `livekit.grupoproser.com.co` no apunta a la IP de este Coolify.
3. Imagen sola con `--dev` / sin `livekit.yaml` no sirve en producción.

## Qué hacer en Coolify (pantalla actual)

### A) DNS (obligatorio)

En tu DNS (Cloudflare / proveedor del dominio):

| Tipo | Nombre | Valor |
|------|--------|--------|
| A | `livekit` | IP pública del **servidor Coolify de videollamadas** |

Quita o corrige `www.livekit` si no lo usas (mejor un solo host sin www).

Espera propagación y que Coolify deje de decir **DNS mismatch**.

### B) Resource: Docker Compose (no Docker Image)

1. En **SERVICIO DE VIDEO LLAMADAS → production** → **+ New Resource**.
2. Elige **Docker Compose** (no Git de Arnald, no Docker Image sola).
3. Pega el contenido de `docker-compose.livekit.prod.yml` del backend, **o** usa el repo `grupoproser-backend` y selecciona ese archivo.
4. Sube / crea también `livekit.yaml` (copia de `livekit.yaml.example` con keys reales).

### C) Keys

En una PC con Docker:

```bash
docker run --rm livekit/livekit-server:v1.8.4 generate-keys
```

Pega `API Key` y `API Secret` en `livekit.yaml` bajo `keys:`.

### D) Dominio en Coolify

- Domain: `https://livekit.grupoproser.com.co`
- **Internal port: 7880** (cambiar el 80 que aparece ahora)
- Redirect HTTP→HTTPS: Enabled
- Sin `www` si no hay DNS para www

### E) Firewall del VPS Coolify

Abrir:

- TCP **7880**, **7881**
- UDP **50000–60000**

### F) Arnald principal (otro servidor)

En el `.env` del **backend Arnald de producción** (no en Coolify):

```env
LIVEKIT_URL=wss://livekit.grupoproser.com.co
LIVEKIT_PUBLIC_URL=wss://livekit.grupoproser.com.co
LIVEKIT_API_KEY=<misma_key>
LIVEKIT_API_SECRET=<mismo_secret>
```

Reinicia solo ese backend y prueba una videollamada.

## Archivos en el repo

- `docker-compose.livekit.prod.yml`
- `livekit.yaml.example`
- Este checklist: `docs/DEPLOY-LIVEKIT-COOLIFY.md`
