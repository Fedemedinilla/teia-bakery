// Respuesta para cuando NO SE PUDO LEER la base (red caída, 5xx transitorio de Supabase).
//
// Existe para distinguir dos cosas que antes se confundían: "esta cuenta ya no existe" (hay que
// cerrarle la sesión) y "ahora mismo no pude preguntar" (NO hay que tocarle nada). Confundirlas
// significaba que un solo error pasajero le destruía al comercio su sesión de 90 días y lo
// mandaba de vuelta a tipear el CUIT.
//
// Devuelve 503 (no 500): es temporal y así lo entienden los buscadores y los reintentos.
// ⚠️ Nunca manda Set-Cookie: la sesión queda intacta y al recargar sigue adentro.
// La página es autocontenida —estilos en línea, sin imágenes ni fuentes— porque si la base
// falló, lo último que queremos es depender de que cargue algo más.

export function respuestaNoDisponible(): Response {
  const html = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Un momento — Teia Bakery</title>
<meta name="robots" content="noindex" />
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         background:#F4ECDE; color:#33291F;
         font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .caja { max-width:400px; text-align:center; }
  .marca { font-size:13px; letter-spacing:.18em; text-transform:uppercase; color:#A89681; margin:0 0 22px; }
  h1 { font-size:21px; font-weight:600; margin:0 0 10px; }
  p { font-size:15px; line-height:1.55; color:#7C6D5C; margin:0 0 20px; }
  a { display:inline-block; padding:11px 20px; border-radius:999px; background:#B0684C;
      color:#fff; text-decoration:none; font-size:14px; font-weight:600; }
</style>
</head><body>
  <div class="caja">
    <p class="marca">Teia Bakery</p>
    <h1>Volvé a intentar en un momento</h1>
    <p>No pudimos conectarnos justo ahora. No perdiste nada: tu sesión sigue abierta y tu pedido
       está donde lo dejaste.</p>
    <a href="">Reintentar</a>
  </div>
</body></html>`;

  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '30',
    },
  });
}
