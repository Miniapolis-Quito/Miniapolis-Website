/** Esquemas de validación de entrada compartidos por las rutas. */
import { z } from 'zod';
import { config } from '../config.js';

/**
 * Mensajes de error en español para todo lo que zod genera por su cuenta.
 *
 * Sin esto, un campo que falta produce "Invalid input" y ese texto en inglés
 * acaba en la pantalla del usuario, que ve el resto de la aplicación en
 * español. Los mensajes escritos en cada esquema mandan sobre estos, que son
 * el respaldo para lo que nadie se molestó en redactar.
 */
z.config({
  customError: (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        // El dato que falta y el que llega con otro tipo son errores distintos
        // para quien rellena el formulario, aunque zod los junte.
        if (issue.input === undefined || issue.input === null) return 'Este dato es obligatorio.';
        if (issue.expected === 'number') return 'Debe ser un número.';
        if (issue.expected === 'string') return 'Debe ser un texto.';
        if (issue.expected === 'boolean') return 'Debe ser sí o no.';
        return 'El formato no es válido.';

      case 'too_small':
        if (issue.origin === 'string') {
          return issue.minimum === 1
            ? 'Este dato es obligatorio.'
            : `Debe tener al menos ${issue.minimum} caracteres.`;
        }
        if (issue.origin === 'number') return `Debe ser ${issue.minimum} o más.`;
        if (issue.origin === 'array') return `Debe tener al menos ${issue.minimum} elemento(s).`;
        return 'El valor es demasiado pequeño.';

      case 'too_big':
        if (issue.origin === 'string') return `No puede superar los ${issue.maximum} caracteres.`;
        if (issue.origin === 'number') return `Debe ser ${issue.maximum} o menos.`;
        return 'El valor es demasiado grande.';

      case 'invalid_format':
        if (issue.format === 'email') return 'El correo no tiene un formato válido.';
        if (issue.format === 'uuid') return 'El identificador no es válido.';
        if (issue.format === 'datetime') return 'La fecha no tiene un formato válido.';
        return 'El formato no es válido.';

      case 'invalid_value':
        return `Valor no permitido. Opciones: ${(issue.values ?? []).join(', ')}.`;

      case 'not_multiple_of':
        return `Debe ser múltiplo de ${issue.divisor}.`;

      case 'unrecognized_keys':
        return 'La petición trae campos que no se esperaban.';

      default:
        // Devolver nada deja pasar el mensaje que traiga el propio esquema
        // (los de `.refine`, por ejemplo), que siempre es más concreto.
        return undefined;
    }
  },
});

const trimmed = (max) => z.string().trim().max(max);

export const emailSchema = trimmed(254)
  .min(5, 'Correo demasiado corto.')
  .email('El correo no tiene un formato válido.')
  .transform((v) => v.toLowerCase());

export const nameSchema = trimmed(120)
  .min(2, 'El nombre debe tener al menos 2 caracteres.')
  .refine((v) => /\p{L}/u.test(v), 'El nombre debe contener letras.');

export const phoneSchema = trimmed(24)
  .regex(/^\+?[0-9][0-9\s-]{5,}$/, 'El teléfono no tiene un formato válido.')
  .transform((v) => v.replace(/[\s-]/g, ''));

export const passwordSchema = z
  .string()
  .min(config.security.minPasswordLength, `La contraseña debe tener al menos ${config.security.minPasswordLength} caracteres.`)
  .max(200, 'La contraseña es demasiado larga.');

export const roleSchema = z.enum(['master', 'staff', 'customer']);
export const packSizeSchema = z.number().int().min(1).max(500);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: nameSchema,
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Ingresa tu contraseña.').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** Un token de recuperación: 32 bytes en base64url. */
const tokenRecuperacionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, 'Este enlace no es válido o ya caducó. Pide uno nuevo desde la página de acceso.');

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetTokenSchema = z.object({ token: tokenRecuperacionSchema });

export const resetPasswordSchema = z.object({
  token: tokenRecuperacionSchema,
  newPassword: passwordSchema,
});

export const updateProfileSchema = z
  .object({
    fullName: nameSchema.optional(),
    phone: phoneSchema.nullish().or(z.literal('').transform(() => null)),
    emailReminders: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios que aplicar.');

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: nameSchema,
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  role: roleSchema.default('customer'),
  password: passwordSchema.optional(),
});

export const updateUserSchema = z
  .object({
    fullName: nameSchema.optional(),
    phone: phoneSchema.nullish().or(z.literal('').transform(() => null)),
    role: roleSchema.optional(),
    status: z.enum(['active', 'suspended']).optional(),
    email: emailSchema.optional(),
    emailReminders: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No hay cambios que aplicar.');

export const issuePackSchema = z.object({
  userId: z.string().uuid('Selecciona un cliente válido.'),
  size: packSizeSchema,
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  paymentMethod: z.enum(['efectivo', 'transferencia', 'tarjeta', 'cortesia', 'otro']).optional(),
  paymentReference: trimmed(120).optional(),
  note: trimmed(500).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
  allowStaticQr: z.boolean().optional(),
});

export const adjustPackSchema = z.object({
  delta: z.number().int().min(-500).max(500).refine((v) => v !== 0, 'El ajuste no puede ser cero.'),
  reason: trimmed(300).min(3, 'Explica el motivo del ajuste.'),
});

export const updatePackSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'cancelled']).optional(),
    note: trimmed(500).nullish(),
    expiresAt: z.string().datetime({ offset: true }).nullish(),
    allowStaticQr: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No hay cambios que aplicar.');

/**
 * Hora de una lectura que el escáner guardó sin conexión. Las dos marcas son
 * del reloj del teléfono y el servidor solo usa su diferencia, así que van
 * juntas o no van.
 */
const lecturaDiferida = {
  capturedAt: z.string().datetime({ offset: true, message: 'La hora de lectura no es una fecha válida.' }).optional(),
  sentAt: z.string().datetime({ offset: true, message: 'La hora de envío no es una fecha válida.' }).optional(),
};
const conHorasJuntas = (esquema) =>
  esquema.refine((v) => (v.capturedAt === undefined) === (v.sentAt === undefined), {
    message: 'La hora de lectura y la de envío deben ir juntas.',
    path: ['capturedAt'],
  });

export const scanSchema = conHorasJuntas(
  z.object({
    payload: z.string().trim().min(1, 'El código está vacío.').max(512),
    deviceLabel: trimmed(60).optional(),
    idempotencyKey: trimmed(80).optional(),
    ...lecturaDiferida,
  }),
);

export const manualRedeemSchema = conHorasJuntas(
  z.object({
    code: trimmed(40).min(4, 'Ingresa el código del pack.'),
    deviceLabel: trimmed(60).optional(),
    idempotencyKey: trimmed(80).optional(),
    ...lecturaDiferida,
  }),
);

export const resolveOfflineRejectionSchema = z.object({
  note: trimmed(300).min(3, 'Explica cómo se resolvió.'),
});

// ---------------------------------------------------------------------------
// Avisos a clientes
// ---------------------------------------------------------------------------

const TIPOS_DE_AVISO = ['purchase', 'low_balance', 'depleted', 'expiring', 'inactive'];
const TIPOS_DE_RECORDATORIO = ['low_balance', 'depleted', 'expiring', 'inactive'];

const entero = (minimo, maximo, mensaje) =>
  z.number({ message: mensaje }).int(mensaje).min(minimo, mensaje).max(maximo, mensaje);

export const notificationSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    kinds: z.object(Object.fromEntries(TIPOS_DE_AVISO.map((tipo) => [tipo, z.boolean().optional()]))).strict().optional(),
    lowBalanceThreshold: entero(1, 10, 'Indica entre 1 y 10 entradas.').optional(),
    daysBeforeExpiry: entero(1, 60, 'Indica entre 1 y 60 días.').optional(),
    inactiveDays: entero(7, 365, 'Indica entre 7 y 365 días.').optional(),
    sendFromHour: entero(0, 23, 'Elige una hora entre 0 y 23.').optional(),
    sendUntilHour: entero(1, 24, 'Elige una hora entre 1 y 24.').optional(),
    whatsappCountryCode: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, 'Escribe el prefijo del país con 1 a 4 dígitos y sin el signo +, por ejemplo 593.')
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'No hay cambios que aplicar.');

export const notificationContactSchema = z.object({
  userId: z.string().uuid('El cliente no es válido.'),
  channel: z.enum(['whatsapp', 'phone']),
  kind: z.enum(TIPOS_DE_RECORDATORIO),
});

export const notificationTestSchema = z.object({
  kind: z.enum(TIPOS_DE_AVISO).default('low_balance'),
});

export const voidRedemptionSchema = z.object({
  reason: trimmed(300).min(3, 'Explica el motivo de la anulación.'),
});

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/** Historial de avisos: la paginación de siempre y, si se pide, un estado. */
export const notificationListSchema = paginationSchema.extend({
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'discarded', 'logged']).optional(),
  userId: z.string().uuid('El cliente no es válido.').optional(),
});

/**
 * Valida `data` con `schema` y lanza un AppError 400 con los mensajes de campo
 * si falla, para que el cliente pueda resaltar el campo correcto.
 */
export function parseOrThrow(schema, data, badRequestFactory) {
  // Una petición sin cuerpo llega como `undefined`; tratarla como un objeto
  // vacío hace que el error señale los campos que faltan en vez de dar un
  // único mensaje genérico sin campo asociado.
  const result = schema.safeParse(data === undefined || data === null ? {} : data);
  if (result.success) return result.data;
  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = Object.values(fieldErrors)[0] || 'Los datos enviados no son válidos.';
  throw badRequestFactory(first, { fields: fieldErrors });
}
