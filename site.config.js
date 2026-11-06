/** Identidad y URLs públicas comprobadas. No contiene secretos. */
export const site = Object.freeze({
  name: 'Miniapolis #3',
  alternateName: Object.freeze([
    'Miniápolis #3',
    'Miniápolis',
    'Miniapolis',
  ]),
  url: 'https://racinghobbiesec.com/',
  language: 'es-EC',
  image: 'images/pista/miniapolis-track-wide.webp',
  logo: 'images/miniapolis-logo-oficial-400.webp',
  googleVerification: 'hDxF8oTZxJSnNkIfJyvluPNpxU3XDz-Pw_t4thXxcy0',
  bingVerification: 'F7AC396C5EF924AB08790B71B5357E40', // Token obtenido para este dominio en Bing Webmaster Tools.
  measurementId: 'G-NX90JV1VSH', // Flujo propio de Miniapolis: 16237934211, propiedad 561697306.
  // Vocabulario cerrado: no enviar texto libre de campañas a Google.
  campaignValues: {
    utm_source: ['google', 'bing', 'facebook', 'instagram', 'newsletter', 'boletin', 'whatsapp', 'racing_hobbies', 'sim_racing_ecuador'],
    utm_medium: ['organic', 'referral', 'social', 'email', 'cpc', 'paid_social', 'display', 'qr'],
    utm_campaign: [],
    utm_content: [],
    utm_term: [],
  },
});

export const publicPages = Object.freeze([
  { file: 'index.html', path: '', title: 'Miniapolis #3 | Pista RC indoor en Quito', description: 'Conoce Miniápolis #3 en Quito, Ecuador: pista indoor de asfalto para autos a control remoto. Consulta el circuito, horarios, disciplinas y campeonato F1 RC.' },
  { file: 'posiciones.html', path: 'posiciones', title: 'Campeonato F1 RC: posiciones | Miniapolis #3', description: 'Consulta la clasificación del campeonato F1 RC de Miniápolis #3 en Quito, Ecuador, temporada julio–agosto de 2026, y la información de carreras publicada por la pista.' },
  { file: 'privacidad.html', path: 'privacidad', title: 'Privacidad y cookies | Miniapolis #3', description: 'Información sobre la medición de visitas, cookies opcionales y cómo aceptar, rechazar o retirar el consentimiento en la web de Miniapolis #3.' },
]);
