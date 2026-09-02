import { AsyncLocalStorage } from 'node:async_hooks';

export const alsUsuarioOperativo = new AsyncLocalStorage();

/** Guarda el usuario del request para los hooks de notificación. */
export function contextoUsuarioMiddleware(req, res, next) {
  alsUsuarioOperativo.run({ req }, next);
}

export function usuarioActualContexto() {
  const store = alsUsuarioOperativo.getStore();
  if (!store) return null;
  return store.req?.user || store.req?.usuario || store.user || null;
}
