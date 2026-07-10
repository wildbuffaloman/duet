# duet — instalación beta (macOS)

> duet es un terminal con canvas: trabajas en el terminal con un agente (Claude Code) y todo lo
> visual que genera — charts, tablas, reportes, previews — aparece como tarjetas vivas en un panel
> al lado, en vez de morir como texto.

## Requisitos

- Mac con chip Apple Silicon (M1 o posterior). *¿Tu Mac es Intel? Avísame y te preparo otro build.*
- macOS 12 (Monterey) o posterior.
- Nada más: no hay que instalar Node, npm ni ninguna dependencia — el instalador trae todo.

## Instalar

1. Abre el archivo `duet_x.y.z_aarch64.dmg`.
2. Arrastra **duet** a la carpeta **Aplicaciones**.

## Primera apertura (importante)

La app todavía no está firmada con certificado de Apple, así que macOS la bloquea la primera vez:

1. Abre duet desde Aplicaciones → macOS muestra el aviso de "desarrollador no identificado".
2. Ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta el aviso de duet y pulsa
   **Abrir de todos modos** (te lo pide una sola vez).

Alternativa por terminal (mismo efecto, una sola vez):

```sh
xattr -cr /Applications/duet.app
```

## Primer uso

Al abrir duet ves un terminal normal. La magia:

1. Divide el panel (botón **⊞** al pasar el mouse) y elige **canvas** para el panel nuevo.
2. En el panel de terminal, pega esto y pulsa Enter:

   ```sh
   echo '<title>hola</title><h1 style="font-family:sans-serif">hola, duet</h1>' > "$DUET_CANVAS/hola.html"
   ```

   La tarjeta aparece en el canvas al instante. Cualquier proceso que escriba un `.html` en esa
   carpeta pinta una tarjeta — esa es toda la API.

3. El resto (usarlo con Claude Code, el demo completo, troubleshooting) está en la
   **Guía de Usuario** que te mandé por correo.

## Feedback

Mándame todo sin filtro — qué no se entendió, qué se sintió lento, dónde te trabaste, qué
esperabas que hiciera y no hizo. Crudo es mejor que pulido.
