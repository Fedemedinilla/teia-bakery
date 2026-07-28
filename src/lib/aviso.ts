import { env } from './supabase';

// Aviso por mail cuando entra un pedido nuevo (Resend, REST puro — sin SDK, igual que
// el resto de las integraciones de esta app).
//
// Por qué mail y no WhatsApp: la Cloud API de Meta exige alta de empresa, un número
// dedicado que deja de servir en la app normal, plantillas aprobadas y costo por
// conversación. Para ~60 pedidos al mes no compra nada. Detalle completo en
// teia/aviso-pedidos-resend-vs-whatsapp.md.
//
// El envío es BEST-EFFORT: el pedido del cliente ya está guardado cuando esto corre, así
// que un fallo del mail no puede voltear el pedido ni demorarlo más de unos segundos.

export type ItemAviso = { name: string; pack_label?: string; qty: number; line_total: number };

export type DatosAviso = {
  order_number: string;
  comercio: string;
  cuit?: string | null;
  contacto: string;
  direccion: string;
  notas?: string;
  total: number;
  items: ItemAviso[];
  panelUrl: string;
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const pesos = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

export function avisoConfigurado(): boolean {
  return Boolean(env('RESEND_API_KEY') && env('TEIA_ALERT_EMAIL'));
}

export function armarHtml(d: DatosAviso): string {
  // Tablas y estilos en línea: los clientes de correo no soportan flex, grid ni <style>.
  // Paleta de Teia: marrón oscuro sobre crema.
  const filas = d.items.map((it) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #E8E0D6;color:#2D2119;font-size:14px">
        ${esc(it.name)}${it.pack_label ? ` <span style="color:#8A7A6D">· ${esc(it.pack_label)}</span>` : ''}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #E8E0D6;color:#8A7A6D;font-size:14px;text-align:center;white-space:nowrap">
        ${esc(it.qty)}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #E8E0D6;color:#2D2119;font-size:14px;text-align:right;white-space:nowrap">
        ${pesos(it.line_total)}
      </td>
    </tr>`).join('');

  const dato = (k: string, v: string) => `
    <tr>
      <td style="padding:3px 12px 3px 0;color:#8A7A6D;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td>
      <td style="padding:3px 0;color:#2D2119;font-size:13px">${v}</td>
    </tr>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;background:#FFFFFF;border:1px solid #E8E0D6;border-radius:10px">
    <tr><td style="padding:26px 26px 0">
      <div style="color:#8A7A6D;font-size:11px;letter-spacing:.18em;text-transform:uppercase">Teia Bakery · Pedidos mayoristas</div>
      <div style="color:#2D2119;font-size:22px;font-weight:600;margin-top:6px">Entró un pedido nuevo</div>
      <div style="color:#8A7A6D;font-size:14px;margin-top:4px">${esc(d.order_number)} · ${esc(d.comercio)}</div>
    </td></tr>

    <tr><td style="padding:18px 26px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        ${dato('Comercio', esc(d.comercio) + (d.cuit ? ` <span style="color:#8A7A6D">· CUIT ${esc(d.cuit)}</span>` : ''))}
        ${dato('Contacto', esc(d.contacto))}
        ${dato('Entrega', esc(d.direccion))}
        ${d.notas ? dato('Aclaraciones', esc(d.notas)) : ''}
      </table>
    </td></tr>

    <tr><td style="padding:18px 26px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <th align="left" style="padding-bottom:6px;border-bottom:2px solid #2D2119;color:#2D2119;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Producto</th>
          <th align="center" style="padding-bottom:6px;border-bottom:2px solid #2D2119;color:#2D2119;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Cant.</th>
          <th align="right" style="padding-bottom:6px;border-bottom:2px solid #2D2119;color:#2D2119;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:600">Importe</th>
        </tr>
        ${filas}
        <tr>
          <td colspan="2" style="padding:12px 0 0;color:#2D2119;font-size:16px;font-weight:600">Total</td>
          <td style="padding:12px 0 0;color:#2D2119;font-size:16px;font-weight:600;text-align:right;white-space:nowrap">${pesos(d.total)}</td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="padding:22px 26px 26px">
      <a href="${esc(d.panelUrl)}" style="display:inline-block;background:#2D2119;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:600">Ver en el panel</a>
      <div style="color:#8A7A6D;font-size:12px;margin-top:14px;line-height:1.5">
        El pedido está en la solapa Pedidos, esperando que lo confirmes. Al confirmarlo se genera el remito.
      </div>
    </td></tr>
  </table>
</body></html>`;
}

function armarTexto(d: DatosAviso): string {
  const items = d.items
    .map((it) => `  ${it.qty} x ${it.name}${it.pack_label ? ` (${it.pack_label})` : ''} — ${pesos(it.line_total)}`)
    .join('\n');
  return [
    `Entró un pedido nuevo — ${d.order_number}`, '',
    `Comercio: ${d.comercio}${d.cuit ? ` (CUIT ${d.cuit})` : ''}`,
    `Contacto: ${d.contacto}`,
    `Entrega: ${d.direccion}`,
    d.notas ? `Aclaraciones: ${d.notas}` : '',
    '', items, '',
    `Total: ${pesos(d.total)}`, '',
    `Ver en el panel: ${d.panelUrl}`,
  ].filter((l) => l !== '').join('\n');
}

/**
 * Manda el aviso. Nunca lanza: devuelve true/false y deja el motivo en los logs.
 * Sin `RESEND_API_KEY` o `TEIA_ALERT_EMAIL` no hace nada (igual que el resto de las
 * integraciones: la app funciona sin ellas).
 */
export async function avisarPedidoNuevo(d: DatosAviso): Promise<boolean> {
  const apiKey = env('RESEND_API_KEY');
  const to = env('TEIA_ALERT_EMAIL');
  if (!apiKey || !to) return false;

  const from = env('TEIA_ALERT_FROM') || 'Teia Bakery <pedidos@kyndredai.com>';

  // Timeout propio: el pedido ya está guardado y el cliente está esperando la respuesta.
  // Si Resend no contesta en 6 segundos, se abandona el aviso, no el pedido.
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), 6000);

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Pedido nuevo ${d.order_number} — ${d.comercio} — ${pesos(d.total)}`,
        html: armarHtml(d),
        text: armarTexto(d),
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      console.error(`[aviso] Resend respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('[aviso] no se pudo enviar:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    return false;
  } finally {
    clearTimeout(reloj);
  }
}
