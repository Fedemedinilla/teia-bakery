/**
 * Genera el par de claves VAPID para las notificaciones push del panel.
 *
 * Uso (parado DENTRO de la carpeta teia-bakery):
 *     npm run vapid
 *   o bien, desde donde sea, apuntando al archivo:
 *     node teia-bakery/scripts/vapid-keys.mjs
 *
 * (Node resuelve la dependencia `web-push` desde la ubicación del script hacia arriba, así que
 * la ruta al archivo es lo único que importa — no desde qué carpeta lo llamás.)
 *
 * Se corre UNA sola vez por proyecto. Imprime las dos variables listas para pegar en Vercel:
 *   · TEIA_VAPID_PUBLIC_KEY  → la ve el navegador, no es secreta.
 *   · TEIA_VAPID_PRIVATE_KEY → SECRETA. Va solo en las env vars (marcarla Sensitive), nunca
 *     en el repo. Si se rota, todos los teléfonos tienen que volver a activar los avisos.
 *
 * ⚠️ Al hacer el traspaso a la cuenta de la clienta se generan claves NUEVAS con este mismo
 * comando: son propias del proyecto, no se reutilizan.
 */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('');
console.log('Pegá estas dos variables en Vercel (Settings -> Environment Variables):');
console.log('');
console.log('TEIA_VAPID_PUBLIC_KEY=' + publicKey);
console.log('TEIA_VAPID_PRIVATE_KEY=' + privateKey);
console.log('');
console.log('Despues: Redeploy. La privada va marcada como Sensitive.');
console.log('');
