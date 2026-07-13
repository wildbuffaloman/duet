# duet — Guía de instalación (macOS)

**duet** es una terminal-agente en mosaico: cada panel es una terminal real o un *canvas* que
renderiza tarjetas HTML en vivo. Corre 100% local en tu Mac (`127.0.0.1`), no expone nada a
internet. Esta guía te lleva de cero a duet abierto en ~3 minutos.

> **Versión:** 0.2.1 · **Archivo:** `duet_0.2.1_aarch64.dmg`

---

## 1. Requisitos

- **Mac con Apple Silicon** (M1, M2, M3 o M4). *No corre en Macs Intel* — el build es `aarch64`.
  - ¿Dudas? Menú  → *Acerca de esta Mac*. Si dice "Chip Apple M…", estás bien.
- **macOS 12 (Monterey) o superior.**
- No necesitas instalar Node ni nada más: la app viene autocontenida.

---

## 2. Instalar

1. Abre el archivo **`duet_0.2.1_aarch64.dmg`** (doble clic). Se monta una ventana.
2. **Arrastra el ícono de `duet` a la carpeta `Aplicaciones`.**
3. Expulsa el disco montado (clic derecho sobre él en el escritorio → *Expulsar*).

> **¿Vienes de la v0.2.0?** (esto es para ti, Mangan) Primero **cierra duet** si está abierto
> (clic derecho en el ícono del Dock → *Salir*), y **borra la versión vieja**: arrastra
> `Aplicaciones/duet` a la Papelera antes de copiar la nueva. Luego sigue el paso 2.

---

## 3. Primer arranque (importante)

duet no está firmada por un "desarrollador identificado" de Apple, así que la **primera vez**
macOS la bloquea por seguridad. Es normal — solo hay que autorizarla una vez. Elige **una** de
las dos vías:

### Vía A — Terminal (la más confiable, un comando)

Abre la app **Terminal** y pega esto (te pedirá tu contraseña de Mac):

```sh
xattr -dr com.apple.quarantine /Applications/duet.app
```

Después abre duet normal desde Aplicaciones. Listo, no vuelve a molestar.

### Vía B — Sin terminal

1. Doble clic en `duet` → aparece un aviso de que no se puede abrir. Dale **Cancelar** (no
   "Mover a la papelera").
2. Ve a  **→ Ajustes del Sistema → Privacidad y Seguridad**.
3. Baja hasta el mensaje *"Se bloqueó el uso de 'duet'…"* y pulsa **Abrir de todos modos**.
4. Confirma con **Abrir**.

---

## 4. Qué verás y tour de 60 segundos

Al abrir, duet levanta su servidor local y muestra una terminal. Todo pasa dentro de esa ventana.

1. **Dividir un panel.** Pasa el mouse sobre un panel y haz clic en **⊞** (dividir a la derecha)
   o **⊟** (dividir abajo). Elige *terminal* o *canvas* para el panel nuevo.
2. **Redimensionar.** Arrastra la línea entre dos paneles.
3. **Probar el canvas en vivo.** En un panel de terminal, con un panel *canvas* visible al lado,
   escribe:

   ```sh
   echo '<title>hola</title><h1 style="font-family:sans-serif">hola, duet</h1>' > "$DUET_CANVAS/hola.html"
   ```

   La tarjeta aparece en el panel canvas casi al instante. Si reescribes ese mismo archivo, la
   tarjeta se actualiza en su sitio.

---

## 5. Usarla con Claude Code

Corre `claude` dentro de cualquier panel de terminal de duet: hereda automáticamente las variables
`$DUET_SESSION` y `$DUET_CANVAS`. A partir de ahí, cuando le pidas algo visual ("gráfica las ventas
del mes", "muéstrame la tabla") en vez de dibujitos ASCII te escribe una tarjeta HTML viva en el
panel canvas de al lado.

---

## 6. Solución de problemas

| Síntoma | Qué hacer |
| --- | --- |
| *"No se puede abrir porque Apple no puede comprobarla"* | Es el paso 3. Usa la Vía A (el comando `xattr`). |
| *"duet está dañada y no se puede abrir"* | También es la cuarentena: aplica la Vía A. La app **no** está dañada. |
| La ventana abre pero se queda en blanco / sin responder | Era el bug de la v0.2.0 (servidor no arrancaba). **La v0.2.1 lo corrige.** Verifica que instalaste la 0.2.1 y que borraste la vieja. |
| "No corre" en una Mac Intel | Esta versión es solo Apple Silicon. Avísale a Alberto y te pasamos un build compatible. |
| El puerto 7433 está ocupado | Cierra otra instancia de duet. duet reusa el servidor si ya hay uno corriendo. |

---

¿Algo no cuadra? Escríbele a Alberto con una captura del mensaje que veas y lo resolvemos.
