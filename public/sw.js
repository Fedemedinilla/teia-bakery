// Service worker de Teia Bakery.
//
// ⚠️ REGLA PRINCIPAL: NO se cachea nada privado.
// Esta app es un gate: /catalogo muestra precios mayoristas DISTINTOS segun la lista de cada
// cliente, y /administradora esta detras de la clave del panel. Un HTML guardado en cache podria
// (a) mostrarle a un comercio los precios de otra lista, (b) sobrevivir a un "Salir" o a una baja
// de cuenta, o (c) dejar ver el panel sin la clave. Por eso el HTML NUNCA se guarda: siempre va a
// la red, y si no hay red se muestra una pagina generica de cortesia, sin datos.
//
// ⚠️ EL PANEL NO SE TOCA. Las navegaciones a /administradora pasan derecho al navegador, sin
// pasar por aca. Motivo: el panel usa autenticacion HTTP Basic, y un 401 que llega por un fetch()
// hecho DESDE el service worker no dispara el cartel de usuario/contrasena (para el navegador esa
// request no tiene ventana asociada, asi que no pregunta y muestra el 401 pelado). Si Mica
// perdiera las credenciales guardadas, se quedaria mirando "Autenticacion requerida" sin manera
// de entrar. Dejandolo pasar, el cartel aparece siempre como corresponde.
//
// Lo UNICO que se cachea es /_astro/ : esos archivos llevan un hash de contenido en el nombre, o
// sea que al cambiar cambian de nombre. Es imposible que queden viejos.
//
// 🔧 MANTENIMIENTO: no hay que acordarse de nada al cambiar un icono, el logo o una foto — esas
// cosas ya no se cachean. El unico motivo para subir VERSION es editar offline.html (y aun asi,
// quedarse con la version vieja de una pagina que solo dice "sin conexion" no rompe nada).

const VERSION = 'teia-v2';
const CACHE = VERSION;
const OFFLINE = '/offline.html';

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' fuerza bajarla de la red: sin esto se podria instalar una copia vieja
      // que el navegador tuviera guardada en su propio cache HTTP.
      .then((c) => c.add(new Request(OFFLINE, { cache: 'reload' })))
      .then(() => self.skipWaiting())
  );
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

  // Navegaciones = HTML. SIEMPRE a la red. Sin red, pagina de cortesia; nunca HTML guardado.
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE).then((r) =>
          r || new Response('Sin conexion.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        )
      )
    );
    return;
  }

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
  evento.waitUntil(self.registration.showNotification(d.titulo || 'Nuevo pedido', opciones));
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
