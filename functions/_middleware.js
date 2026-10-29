/** Solo consolida hosts de esta publicación; conserva ruta y atribución. */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (['www.racinghobbiesec.com', 'miniapolis-website.pages.dev'].includes(url.hostname)) {
    url.protocol = 'https:';
    url.hostname = 'racinghobbiesec.com';
    return Response.redirect(url.href, 301);
  }
  return context.next();
}
