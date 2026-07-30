// Service worker de Teia Bakery.
//
// ⚠️ REGLA PRINCIPAL: NO se cachea nada privado.
// Esta app es un gate: /catalogo muestra precios mayoristas DISTINTOS segun la lista de cada
// cliente, y /administradora esta detras de la clave del panel. Un HTML guardado en cache podria
// (a) mostrarle a un comercio los precios de otra lista, (b) sobrevivir a un "Salir" o a una baja
// de cuenta, o (c) dejar ver el panel sin la clave. Por eso el HTML NUNCA se guarda: siempre va a
// la red, y si no hay red se muestra una pagina generica de cortesia, sin datos.
//
// Solo se cachean archivos estaticos: /_astro/ (llevan hash de contenido en el nombre, asi que es
// imposible que queden viejos), los iconos y el logo.
//
// 🔧 MANTENIMIENTO: los iconos y el logo NO llevan hash, asi que si alguna vez se cambia una de
// esas imagenes SIN cambiarle el nombre, hay que subir el numero de VERSION de aca abajo. Al
// activarse, el worker borra todo cache que no coincida con VERSION y se rebajan las nuevas.
//
// Actualizaciones: como el HTML siempre sale de la red, un deploy nuevo se ve en la proxima
// apertura. skipWaiting + clients.claim hacen que la version nueva tome el control enseguida,
// sin que nadie tenga que "actualizar" nada a mano.

const VERSION = 'teia-v1';
const CACHE = VERSION;
const OFFLINE = '/offline.html';

// Lo minimo para poder responder sin red. Nada de esto es privado.
const PRECARGA = [OFFLINE, '/icons/cliente-192.png', '/icons/admin-192.png'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECARGA))
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

// Rutas de archivos estaticos seguros de cachear (todos con nombre versionado o inmutables).
const ESTATICO = /^\/(_astro|icons|img)\//;

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Solo GET: un POST (entrar, hacer un pedido, guardar en el panel) jamas se toca.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Otro origen (fuentes de Google, fotos en Supabase): pasa derecho, no lo administramos.
  if (url.origin !== self.location.origin) return;

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

  // Estaticos: primero el cache (rapido y sirve offline), y si no esta se baja y se guarda.
  if (ESTATICO.test(url.pathname) || url.pathname === '/logo-teia.png') {
    evento.respondWith(
      caches.match(req).then((guardado) =>
        guardado ||
        fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return res;
        })
      )
    );
  }

  // Cualquier otra cosa: sin respondWith, la maneja el navegador como siempre.
});
