# Teia Bakery — Roadmap v1.1

> Alcance y origen de cada pedido: `teia/V1.1-ALCANCE.md` (fuera del repo).
> Este documento es el plan de **ejecución**: qué se toca, en qué orden, y con qué se verifica
> cada paso antes de que lo vea la clienta.

---

## El principio que manda sobre todo lo demás

**La app está en producción y Mica la está usando hoy con pedidos reales.** Entraron pedidos del
2/9 al 7/9 y dos de sus clientes ya le comentaron que está buena.

De ahí salen cuatro reglas que no se negocian en esta versión:

1. **Nada se prueba contra su Drive ni contra su base.** Las pruebas van contra un Google propio y
   una Supabase falsa. Su cuenta no se toca ni para mirar.
2. **Ningún cambio puede voltear ni demorar una confirmación de pedido.** Si Google falla, el
   pedido se confirma igual y el remito sigue estando. Esa garantía ya existe en el código y esta
   versión no la puede debilitar.
3. **Se despliega de noche**, cerca de las 3 AM, que es cuando ya corre el barrido. Es el único
   momento en que este trabajo y su jornada se cruzan.
4. **Si algo queda dudoso, no entra.** Preferimos entregar dos cambios sólidos que tres con uno
   temblando.

---

## Etapa 0 — Preparación (antes de escribir código)

- [x] Repo limpio, `main` sin cambios pendientes (verificado: último commit `7760a4f`).
- [x] Mapa del código y auditoría de riesgo previa, por agentes en paralelo sobre cada subsistema
      que se toca. **Ningún renglón se escribe antes de tener ese mapa.**
- [x] **Rama `v1.1`.** No se commitea a `main`: `main` despliega solo a producción.
- [x] **Instrumentos de prueba, sin tocar producción.** `scripts/fake-drive.ts` intercepta
      `globalThis.fetch` y responde como Drive; `scripts/fake-supabase.ts` hace lo mismo con
      PostgREST y Storage. Ninguno requiere un cambio en `src/`: el arnés no puede introducir el
      bug que busca. `scripts/dev-fake-supabase.mjs` levanta un servidor real en `:54321` para
      mirar el panel en el navegador con datos con forma verdadera.
- [x] **`.env.development.local`** (ignorado por git) apunta el dev server a esa base falsa y deja
      `GOOGLE_OAUTH_*` **vacío**. Consecuencia buscada: ninguna prueba local puede pegarle al Drive
      de nadie. ⚠️ Mientras ese archivo exista, `npm run dev` NO usa el `.env` de siempre — hay que
      levantar antes `node scripts/dev-fake-supabase.mjs`, o borrarlo.
- [ ] Un OAuth de Google **propio** para ejercitar Drive de verdad (escalón 2). Pendiente.

---

## Etapa 1 — El deploy de esta noche

Tres cambios que viajan juntos porque comparten archivo y momento.

### A · Carpeta "Remitos para imprimir"

Al confirmar un pedido, el remito se sube **también** a una carpeta plana `Remitos para imprimir`
dentro de `Remitos Teia/`. Es el mismo PDF que ya se archiva; cambia el destino, no el contenido.

La carpeta se auto-crea y **se marca** con `appProperties`, igual que la raíz y la planilla. Esa
marca es lo que garantiza que siempre se encuentre la misma: si un día se creara una carpeta nueva,
la que Mica compartió con la encargada quedaría vieja y el local dejaría de ver remitos sin que
nadie se entere. Es el modo de falla más caro de todo el cambio, y la marca es lo que lo cierra.

Toca: `src/lib/google.ts`, `src/pages/api/admin/archive.ts`.

### B · Botón "Mandar a imprimir"

En cada pedido confirmado y archivado, al lado de "📤 Compartir". Sirve para dos cosas que el
automático no cubre: volver a mandar un remito que ella ya borró de la carpeta, y los pedidos que
se confirmaron **antes** de esta versión.

Toca: un endpoint nuevo bajo `src/pages/api/admin/`, más el markup y el handler del panel.

### C · Renombrar "📊 Planilla"

Pasa a decir **"📊 Ventas y productos"**. Es una cadena de texto, y es el cambio con mejor relación
esfuerzo/efecto de toda la versión: Mica tiene el recuento a un toque desde el panel y no lo vio
porque el botón no le decía nada. Verificado el 7/9 — la planilla existe, se actualiza, y ese botón
la abre.

Toca: `src/pages/administradora.astro`, una línea.

### Verificación, en cuatro escalones

Ninguno se saltea, y ninguno se declara pasado sin haber **mirado la salida**, no el código.

| # | Dónde | Qué prueba | Estado |
|---|---|---|---|
| 1 | Local, fakes en memoria | La lógica entera: orden de operaciones, qué pasa si Google falla, papelera, carreras, nombres hostiles | ✅ 46 + 9 + 24 aserciones |
| 1b | Local, navegador con base falsa | Que el panel renderice, el botón aparezca en el estado correcto, el endpoint rechace lo que debe, y el layout entre en 375px | ✅ hecho |
| 2 | Local, **mi** cuenta de Google real | Que Drive de verdad se comporte como el fake cree | ⬜ pendiente |
| 3 | Deploy de preview (rama `v1.1`) | Que compile y que la CSP no rompa nada. **Antes hay que confirmar con `vercel env ls` que las env vars son Production-only**, o el preview escribiría en su Drive y su base | ⬜ pendiente |
| 4 | Producción, de noche | Una confirmación real de punta a punta | ⬜ pendiente |

**Lo verificado en el escalón 1b, concretamente:** un pedido archivado muestra `✓ Remito · Abrir ·
Compartir · Mandar a imprimir`; uno con el archivado **fallido pero con remito** muestra el botón
igual (que es su razón de ser); uno pendiente no lo muestra. El endpoint devuelve 401 sin cookie,
400 con id inválido, 404 si no existe, 409 si está pendiente y 503 sin Google, y un cuerpo con
`path`/`folderId`/`bucket` de más se ignora entero. A 375px la fila usa 4 renglones sin desbordar
nada y el botón mide 48px de alto. El ✓ y el cartel de aviso reciben el CSS con scope (verificado
por color computado), que es el motivo de servirlos ocultos en el HTML en vez de crearlos por JS.

**Horario del deploy: 03:30–04:00. Nunca entre 02:55 y 03:15**, que es cuando corre el barrido
(`0 6 * * *` UTC = 03:00 AR). Un deploy en medio de esa corrida la parte al medio.

Antes de cualquier commit corre `npm run check`, que valida los scripts inline de los `.astro`
además de los tipos. Existe porque una vez rompí el panel con un script que ni el build miraba.

### Plan de vuelta atrás

El cambio es aditivo: no borra ni renombra nada de lo que hoy funciona. Si algo sale mal, `git
revert` del merge y un redeploy dejan la app exactamente como está ahora. La carpeta que hubiera
quedado creada en Drive es inerte — no la lee nadie más que la encargada.

---

### Lo que hay que entregarle por escrito, antes de que comparta nada

1. **No crees vos la carpeta.** Aparece sola con el primer pedido que confirmes. Compartí **esa**:
   la app solo ve los archivos que ella misma creó, así que una carpeta hecha a mano le queda
   invisible y terminarías compartiendo una que nunca recibe nada.
2. **Compartí la carpeta de impresión, nunca "📁 Remitos en Drive"** — eso es el histórico entero
   de todos los comercios.
3. **Con la cuenta de la encargada, como lectora.** No con "cualquiera con el enlace": ese link se
   reenvía y no vence nunca.
4. **Lo que ahí se ve.** El remito **no** lleva el CUIT, pero sí el nombre del comercio, su
   contacto, su dirección, cada producto con su precio unitario, el descuento y el saldo anterior.
   O sea: **a qué precio le vendés a cada uno, cuánto le vendés y si te debe plata.** Borrar el
   archivo el viernes no deshace la copia que alguien haya guardado el martes.
5. **Para vaciarla, seleccioná los archivos de adentro.** No mandes la carpeta a la papelera: si
   desaparece, dejamos de poder dejarle remitos y te avisamos con un cartel rojo en el panel.
6. **No la muevas a una unidad compartida.**
7. **Los pedidos de hoy tienen que mostrar el ✓ "en la carpeta".** Si a alguno le falta, tocale
   🖨️ Mandar a imprimir.
8. En el manual de entrega, en el paso del handoff de la cuenta de Google: *después de reconectar,
   hay que volver a compartir la carpeta*.

---

## Etapa 2 — Pestaña "Por cliente"

Un cuadro nuevo dentro de la planilla que ya existe, con selector de comercio y de ventana de
tiempo, que responde su pregunta textual: *"Chungo Devoto, últimos 3 meses, 500 chipá"*. Hoy la
planilla tiene totales por cliente y totales por producto, pero no el cruce de los dos.

Va **después** del deploy de la Etapa 1 y en su propio deploy. No se mezclan: son riesgos distintos
y quiero poder revertir uno sin tocar el otro.

---

## Etapa 3 — Lo que depende de Mica

- **La cuenta de Google de la computadora del local.** Si en esa máquina está abierta la cuenta de
  Mica, la encargada ve todo su Drive y no solo la carpeta. Es lo único que bloquea el compartir —
  no la construcción.
- **TEIA-0023 es de su cuenta de prueba** ($169.650) y cuenta como venta en todos los totales. Hay
  que anularlo o excluir esa cuenta de las estadísticas. Si no, el día que compare contra su caja
  los números no le van a cerrar y va a desconfiar de toda la planilla.

---

## Lo que NO entra en v1.1

- **Mandarle el remito por mail al cliente al confirmar.** Resend ya está conectado y le ahorraría
  un paso por pedido, pero no lo pidió. Anotado para v1.2.
- **Link directo a la planilla de cada cliente desde su ficha.** Pediría guardar ids en la base y
  no hace falta para arrancar.
- **Subcarpetas por día en la carpeta de impresión.** Lo propuse yo; ella eligió plana y borrar por
  semana. Su solución es más simple y es la correcta.
