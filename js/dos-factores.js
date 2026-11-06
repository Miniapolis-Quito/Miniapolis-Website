/**
 * Verificación en dos pasos, desde la cuenta.
 *
 * Todo el panel se dibuja aquí y se usa en dos sitios: dentro de «Mi cuenta»
 * para los clientes y en un diálogo propio, desde la cabecera, para el personal
 * y el máster. El QR lo genera el servidor como imagen: la página no carga
 * ninguna librería de terceros y la política de contenidos sigue cerrada.
 */
import { el, render, mostrarAviso, mostrarErroresCampo, conCarga, brindis, confirmar, esqueleto } from './ui.js';
import { api, getUsuario } from './api.js';

const TITULO = 'Verificación en dos pasos';

/** Campo de código, siempre igual: numérico, sin autocorrección y ancho justo. */
function campoCodigo(id, etiqueta = 'Código de 6 dígitos') {
  return el(
    'div',
    { class: 'campo' },
    el('label', { for: id }, etiqueta),
    el('input', {
      id,
      name: 'code',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      maxlength: '11',
      placeholder: '000000',
      autocapitalize: 'characters',
      spellcheck: 'false',
      required: true,
    }),
    el('div', { class: 'campo__error' }),
  );
}

/** Los códigos de respaldo, con qué hacer con ellos. */
function bloqueDeCodigos(codigos) {
  const texto = codigos.join('\n');
  const marca = getUsuario()?.email ? `Códigos de respaldo de ${getUsuario().email}` : 'Códigos de respaldo';

  return el(
    'div',
    { class: 'tarjeta tarjeta--suave mt' },
    el('h4', { class: 'sin-margen' }, 'Tus códigos de respaldo'),
    el(
      'p',
      { class: 'tenue pequeno' },
      'Guárdalos donde puedas encontrarlos sin el teléfono. Cada uno sirve una sola vez y son la única forma de entrar si pierdes la aplicación.',
    ),
    el(
      'ul',
      { class: 'lista-codigos' },
      codigos.map((codigo) => el('li', {}, el('code', {}, codigo))),
    ),
    el(
      'div',
      { class: 'fila-acciones' },
      el(
        'button',
        {
          class: 'boton boton--fantasma boton--chico',
          type: 'button',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(`${marca}\n\n${texto}\n`);
              brindis('Códigos copiados.', 'ok');
            } catch {
              brindis('Tu navegador no deja copiar; apúntalos a mano.', 'alerta');
            }
          },
        },
        'Copiar',
      ),
      el(
        'button',
        {
          class: 'boton boton--fantasma boton--chico',
          type: 'button',
          onClick: () => {
            const archivo = new Blob([`${marca}\n\n${texto}\n`], { type: 'text/plain;charset=utf-8' });
            const enlace = el('a', {
              href: URL.createObjectURL(archivo),
              download: 'codigos-de-respaldo-miniapolis.txt',
            });
            enlace.click();
            URL.revokeObjectURL(enlace.href);
          },
        },
        'Descargar',
      ),
    ),
  );
}

/**
 * Dibuja el panel dentro de `contenedor` y se encarga de recargarlo cuando algo
 * cambia. Devuelve una función para volver a pintarlo desde fuera.
 */
export function montarSeguridad(contenedor) {
  const aviso = el('div', { class: 'aviso', role: 'status', hidden: true });

  async function pintar() {
    render(contenedor, esqueleto(3));
    let estado;
    try {
      estado = await api.get('/api/auth/2fa');
    } catch (error) {
      render(contenedor, el('p', { class: 'aviso aviso--error' }, error.message));
      return;
    }
    render(contenedor, estado.enabled ? vistaActiva(estado) : vistaApagada(estado));
  }

  // -------------------------------------------------------------------------
  // Sin activar
  // -------------------------------------------------------------------------

  function vistaApagada(estado) {
    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, TITULO),
      estado.pendingRequired
        ? el(
            'p',
            { class: 'aviso aviso--alerta' },
            'Esta pista exige verificación en dos pasos al personal. Hasta que la actives no podrás escanear entradas ni abrir la administración.',
          )
        : el(
            'p',
            { class: 'tenue pequeno' },
            'Añade un segundo candado a tu cuenta: además de la contraseña, pedirá un código que cambia cada 30 segundos en tu teléfono.',
          ),
      aviso,
      el(
        'button',
        {
          class: 'boton boton--principal',
          type: 'button',
          onClick: (evento) => conCarga(evento.currentTarget, empezarAlta),
        },
        'Activar verificación en dos pasos',
      ),
    );
  }

  async function empezarAlta() {
    mostrarAviso(aviso, '');
    let alta;
    try {
      alta = await api.post('/api/auth/2fa/setup');
    } catch (error) {
      mostrarAviso(aviso, error.message, 'error');
      return;
    }
    render(contenedor, vistaConfigurando(alta));
  }

  function vistaConfigurando(alta) {
    const avisoAlta = el('div', { class: 'aviso', role: 'status', hidden: true });
    const formulario = el(
      'form',
      { novalidate: true },
      campoCodigo('dos-factores-alta'),
      avisoAlta,
      el('button', { class: 'boton boton--principal', type: 'submit' }, 'Confirmar y activar'),
    );

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mostrarAviso(avisoAlta, '');
      mostrarErroresCampo(formulario, {});
      const codigo = formulario.querySelector('[name="code"]').value.trim();
      await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
        try {
          const respuesta = await api.post('/api/auth/2fa/activate', { code: codigo });
          brindis('Verificación en dos pasos activada.', 'ok');
          render(contenedor, vistaCodigosRecienCreados(respuesta));
        } catch (error) {
          mostrarErroresCampo(formulario, error.campos || {});
          mostrarAviso(avisoAlta, error.message, 'error');
        }
      });
    });

    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, TITULO),
      el(
        'ol',
        { class: 'pasos' },
        el(
          'li',
          {},
          'Instala una aplicación de autenticación (Google Authenticator, Aegis, 1Password, Microsoft Authenticator…).',
        ),
        el('li', {}, 'Escanea este código con ella:'),
      ),
      el('img', {
        class: 'qr-dos-factores',
        src: alta.qrDataUrl,
        width: '220',
        height: '220',
        alt: 'Código QR para configurar la verificación en dos pasos',
      }),
      el(
        'details',
        { class: 'mt' },
        el('summary', {}, '¿No puedes escanearlo? Escribe la clave a mano'),
        el('p', { class: 'tenue pequeno' }, 'Escribe esta clave en tu aplicación, sin espacios:'),
        el('code', { class: 'clave-manual' }, alta.secretoLegible),
      ),
      el('p', { class: 'mt' }, 'Para terminar, escribe el código que te muestra la aplicación:'),
      formulario,
      el(
        'button',
        { class: 'boton boton--fantasma boton--chico mt', type: 'button', onClick: pintar },
        'Cancelar',
      ),
    );
  }

  function vistaCodigosRecienCreados(respuesta) {
    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, TITULO),
      el('p', { class: 'aviso aviso--ok' }, 'Listo: desde ahora tu cuenta pide también el código del teléfono.'),
      respuesta.sesionesCerradas > 0
        ? el(
            'p',
            { class: 'tenue pequeno' },
            `Cerramos ${respuesta.sesionesCerradas} sesión(es) abiertas en otros dispositivos: estaban abiertas solo con la contraseña.`,
          )
        : null,
      bloqueDeCodigos(respuesta.recoveryCodes),
      el(
        'button',
        { class: 'boton boton--principal boton--bloque mt', type: 'button', onClick: pintar },
        'Ya los guardé',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Activa
  // -------------------------------------------------------------------------

  function vistaActiva(estado) {
    const avisoActiva = el('div', { class: 'aviso', role: 'status', hidden: true });
    const pocosCodigos = estado.recoveryCodesLeft <= 2;

    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, TITULO),
      el(
        'p',
        { class: 'aviso aviso--ok' },
        `Activa${estado.since ? ` desde el ${new Date(estado.since).toLocaleDateString('es-EC')}` : ''}.`,
      ),
      el(
        'p',
        { class: pocosCodigos ? 'aviso aviso--alerta' : 'tenue pequeno' },
        `Te quedan ${estado.recoveryCodesLeft} código(s) de respaldo.` +
          (pocosCodigos ? ' Genera una tanda nueva antes de quedarte sin ninguno.' : ''),
      ),
      avisoActiva,
      el(
        'div',
        { class: 'fila-acciones' },
        el(
          'button',
          {
            class: 'boton boton--fantasma',
            type: 'button',
            onClick: () => render(contenedor, vistaRenovarCodigos()),
          },
          'Generar códigos de respaldo nuevos',
        ),
        el(
          'button',
          {
            class: 'boton boton--peligro',
            type: 'button',
            onClick: async () => {
              const seguro = await confirmar({
                titulo: 'Desactivar la verificación en dos pasos',
                mensaje:
                  estado.required
                    ? 'Esta pista exige el segundo paso al personal: si la desactivas, perderás tus permisos hasta volver a activarla.'
                    : 'Tu cuenta volverá a entrar solo con la contraseña.',
                textoAceptar: 'Desactivar',
                peligro: true,
              });
              if (seguro) render(contenedor, vistaDesactivar());
            },
          },
          'Desactivar',
        ),
      ),
    );
  }

  function vistaRenovarCodigos() {
    const avisoRenovar = el('div', { class: 'aviso', role: 'status', hidden: true });
    const formulario = el(
      'form',
      { novalidate: true },
      el(
        'p',
        { class: 'tenue pequeno' },
        'Escribe el código de tu aplicación. Los códigos de respaldo anteriores dejarán de servir.',
      ),
      campoCodigo('dos-factores-renovar'),
      avisoRenovar,
      el('button', { class: 'boton boton--principal', type: 'submit' }, 'Generar códigos nuevos'),
    );

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mostrarAviso(avisoRenovar, '');
      mostrarErroresCampo(formulario, {});
      const codigo = formulario.querySelector('[name="code"]').value.trim();
      await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
        try {
          const respuesta = await api.post('/api/auth/2fa/recovery-codes', { code: codigo });
          render(
            contenedor,
            el(
              'div',
              {},
              el('h3', { class: 'sin-margen' }, TITULO),
              bloqueDeCodigos(respuesta.recoveryCodes),
              el(
                'button',
                { class: 'boton boton--principal boton--bloque mt', type: 'button', onClick: pintar },
                'Ya los guardé',
              ),
            ),
          );
        } catch (error) {
          mostrarErroresCampo(formulario, error.campos || {});
          mostrarAviso(avisoRenovar, error.message, 'error');
        }
      });
    });

    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, 'Códigos de respaldo nuevos'),
      formulario,
      el('button', { class: 'boton boton--fantasma boton--chico mt', type: 'button', onClick: pintar }, 'Volver'),
    );
  }

  function vistaDesactivar() {
    const avisoBaja = el('div', { class: 'aviso', role: 'status', hidden: true });
    const formulario = el(
      'form',
      { novalidate: true },
      el('p', { class: 'tenue pequeno' }, 'Para quitarla hacen falta tu contraseña y un código: con una sola de las dos cosas no basta.'),
      el(
        'div',
        { class: 'campo' },
        el('label', { for: 'dos-factores-password' }, 'Tu contraseña'),
        el('input', {
          id: 'dos-factores-password',
          name: 'password',
          type: 'password',
          autocomplete: 'current-password',
          required: true,
        }),
        el('div', { class: 'campo__error' }),
      ),
      campoCodigo('dos-factores-baja', 'Código (o uno de respaldo)'),
      avisoBaja,
      el('button', { class: 'boton boton--peligro', type: 'submit' }, 'Desactivar'),
    );

    formulario.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      mostrarAviso(avisoBaja, '');
      mostrarErroresCampo(formulario, {});
      const valor = (nombre) => formulario.querySelector(`[name="${nombre}"]`).value;
      await conCarga(formulario.querySelector('button[type="submit"]'), async () => {
        try {
          await api.post('/api/auth/2fa/disable', { password: valor('password'), code: valor('code').trim() });
          brindis('Verificación en dos pasos desactivada.', 'ok');
          await pintar();
        } catch (error) {
          mostrarErroresCampo(formulario, error.campos || {});
          mostrarAviso(avisoBaja, error.message, 'error');
        }
      });
    });

    return el(
      'div',
      {},
      el('h3', { class: 'sin-margen' }, 'Desactivar la verificación en dos pasos'),
      formulario,
      el('button', { class: 'boton boton--fantasma boton--chico mt', type: 'button', onClick: pintar }, 'Volver'),
    );
  }

  pintar();
  return pintar;
}

/** El mismo panel, en un diálogo propio: es el acceso desde la cabecera. */
export function abrirSeguridad() {
  const cuerpo = el('div', {});
  const dialogo = el(
    'dialog',
    { 'aria-labelledby': 'seguridad-titulo' },
    el('div', { class: 'modal__cuerpo' }, el('h2', { id: 'seguridad-titulo' }, 'Seguridad de mi cuenta'), cuerpo),
    el(
      'div',
      { class: 'modal__pie' },
      el('button', { class: 'boton boton--fantasma', type: 'button', onClick: () => cerrar() }, 'Cerrar'),
    ),
  );

  function cerrar() {
    dialogo.close();
    dialogo.remove();
  }
  dialogo.addEventListener('cancel', (evento) => {
    evento.preventDefault();
    cerrar();
  });

  document.body.append(dialogo);
  dialogo.showModal();
  montarSeguridad(cuerpo);
}
