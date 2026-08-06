// Service worker de Teia Bakery.
//
// ⚠️ HACE UNA SOLA COSA: guardar los archivos de /_astro/ para que la app abra rapido.
// Nada mas. Ni HTML, ni la API, ni las navegaciones.
//
// El HTML NO se cachea nunca porque esta app es un gate: /catalogo muestra precios mayoristas
// DISTINTOS segun la lista de cada cliente y /administradora esta detras de una clave. Una copia
// guardada podria mostrarle a un comercio los precios de otra lista o sobrevivir a un "Salir".
//
// Las NAVEGACIONES pasan derecho al navegador (ver la nota en el handler): interceptarlas rompia
// la entrada en iPhone y, en el panel, el cartel de usuario/contrasena.
//
// Lo UNICO que se cachea es /_astro/ : esos archivos llevan un hash de contenido en el nombre, o
// sea que al cambiar cambian de nombre. Es imposible que queden viejos.
//
// 🔧 MANTENIMIENTO: no hay que acordarse de nada al cambiar un icono, el logo o una foto — esas
// cosas no se cachean. Subir VERSION solo si alguna vez se cambia QUE se cachea.

const VERSION = 'teia-v3';
const CACHE = VERSION;

self.addEventListener('install', (evento) => {
  // Nada que precargar: el worker no sirve contenido propio, solo guarda lo que ya se pidio.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Solo GET: un POST (entrar, hacer un pedido, guardar en el panel) jamas se toca.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Otro origen (fuentes de Google, fotos en Supabase): pasa derecho, no lo administramos.
  if (url.origin !== self.location.origin) return;

  // El panel: fuera del service worker por completo (ver la nota de arriba sobre el 401).
  if (url.pathname === '/administradora' || url.pathname.startsWith('/administradora/')) return;

  // La API nunca se cachea: son datos vivos y privados.
  if (url.pathname.startsWith('/api/')) return;

  // ⚠️ LAS NAVEGACIONES NO SE TOCAN. Pasan derecho al navegador.
  //
  // Se interceptaban para mostrar una pagina de cortesia sin conexion, y eso ROMPIA la entrada en
  // iPhone: cuando /catalogo redirige (sesion ausente o vencida) devuelve un 302 sin
  // Content-Type; al pasar esa redireccion por el worker, Safari no la sigue — muestra
  // "¿Quieres descargar 'catalogo'?" y el comercio se queda afuera sin entender por que.
  // (WebKit y las redirecciones opacas devueltas desde un service worker.)
  //
  // No se pierde nada que importe: esta app necesita red igual (el catalogo y los precios son
  // vivos, no se puede pedir sin conexion). Menos interceptacion = menos casos raros.
  if (req.mode === 'navigate') return;

  // Archivos con hash en el nombre: primero el cache (rapido y sirve offline), si no se baja.
  if (url.pathname.startsWith('/_astro/')) {
    evento.respondWith(
      caches.match(req).then((guardado) =>
        guardado ||
        fetch(req).then((res) => {
          // 'basic' = misma procedencia y respuesta completa; no guardamos opacas ni parciales.
          if (res && res.status === 200 && res.type === 'basic') {
            const copia = res.clone();
            evento.waitUntil(caches.open(CACHE).then((c) => c.put(req, copia)));
          }
          return res;
        })
      )
    );
  }

  // Cualquier otra cosa: sin respondWith, la maneja el navegador como siempre.
});

// ---- Notificaciones de pedidos nuevos ----------------------------------------------------
// Solo llegan si la administradora activo los avisos desde el panel. El servidor manda el aviso
// firmado; aca se muestra. Sin permiso o sin suscripcion, nada de esto corre nunca.

self.addEventListener('push', (evento) => {
  let d = {};
  try { d = evento.data ? evento.data.json() : {}; } catch { d = {}; }

  const opciones = {
    body: d.cuerpo || 'Entro un pedido nuevo.',
    icon: '/icons/admin-192.png',
    badge: '/icons/admin-192.png',
    lang: 'es-AR',
    data: { url: d.url || '/administradora#pedidos' },
  };

  // Un aviso por pedido: dos pedidos distintos NUNCA se pisan (que se pisen seria perder uno
  // de vista). Si la etiqueta llegara a repetirse, `renotify` hace que igual SUENE en vez de
  // reemplazar en silencio: en Windows, reemplazar sin renotify no muestra banner ni sonido y
  // parece que el aviso no llego. Mejor un aviso repetido que un pedido perdido.
  if (d.tag) {
    opciones.tag = 'teia-' + d.tag;
    opciones.renotify = true; // ojo: renotify sin tag lanza TypeError, por eso va acá adentro
  }

  // showNotification es OBLIGATORIO: el navegador exige que todo push se traduzca en algo
  // visible. Si no, deja de mandar los siguientes.
  const mostrar = self.registration.showNotification(d.titulo || 'Nuevo pedido', opciones);

  // Globo con el numero de pedidos pendientes sobre el icono de la app.
  // El aviso momentaneo se pierde entre otras notificaciones; el globo QUEDA hasta que se miren
  // los pedidos. Es lo que pidio Mica: "un puntito o un uno... por si justo no veo cuando llega".
  // Si el numero no vino (no se pudo contar), no se toca: borrarlo diria "no tenes nada".
  let globo = Promise.resolve();
  if (typeof d.pendientes === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    try {
      globo = d.pendientes > 0
        ? self.navigator.setAppBadge(d.pendientes)
        : self.navigator.clearAppBadge();
    } catch (e) { globo = Promise.resolve(); }
  }

  // ⚠️ allSettled y NO all. Antes era Promise.all([aviso, globo]).catch(()=>{}): si setAppBadge
  // rechazaba —y en Windows/Edge rechaza en varios escenarios— el waitUntil se resolvia ANTES de
  // que el aviso terminara de pintarse. Un push que no muestra nada visible incumple
  // userVisibleOnly, y el navegador castiga eso: deja de entregar los siguientes o directamente da
  // de baja la suscripcion. Es la explicacion mas probable del "llego una sola vez y nunca mas".
  // Con allSettled, el globo no puede voltear al aviso: son dos cosas independientes.
  evento.waitUntil(Promise.allSettled([mostrar, globo]));
});

// El navegador puede ROTAR la suscripcion por su cuenta (vence, se renueva la clave, el sistema
// la recicla). Cuando pasa, la direccion vieja que tiene el servidor queda muerta: el aviso sale,
// devuelve 410 y la fila se borra sola — el navegador sigue diciendo "activados" y el servidor ya
// no tiene a quien avisarle. Nadie se entera hasta que se pierde un pedido.
// Aca se vuelve a dar de alta la direccion nueva. Todo blindado: si algo falla, falla callado,
// porque igual existe la re-sincronizacion al abrir el panel (ver ActivarAvisos.astro).
// Ojo: Safari/iOS puede no disparar nunca este evento — por eso hacen falta los dos mecanismos.
self.addEventListener('pushsubscriptionchange', (evento) => {
  evento.waitUntil((async () => {
    try {
      let sub = evento.newSubscription;
      if (!sub) {
        const vieja = evento.oldSubscription;
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vieja && vieja.options && vieja.options.applicationServerKey,
        });
      }
      if (!sub) return;
      const j = sub.toJSON();
      await fetch('/api/admin/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, // JSON obligatorio: checkOrigin de Astro
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }),
      });
    } catch (e) { /* sin ruido: el panel lo vuelve a intentar al abrirse */ }
  })());
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || '/administradora#pedidos';

  // Si el panel ya esta abierto se le da foco en vez de abrir otra ventana encima.
  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if (v.url.includes('/administradora') && 'focus' in v) return v.focus();
      }
      return self.clients.openWindow(destino);
    })
  );
});
