export const APP_VIEWPORT_LOCK_CLASS = 'app-viewport-lock';
export const APP_HEIGHT_VAR = '--app-height';
export const APP_OFFSET_VAR = '--app-offset-top';

const VIEWPORT_META_DEFAULT = 'width=device-width, initial-scale=1.0';
const VIEWPORT_META_LOCKED =
  'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';

function viewportMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="viewport"]');
}

function visualViewportBox() {
  const visualViewport = window.visualViewport;
  if (!visualViewport) {
    return { height: window.innerHeight, offsetTop: 0 };
  }
  return { height: visualViewport.height, offsetTop: visualViewport.offsetTop };
}

function applyViewportBox() {
  const html = document.documentElement;
  const { height, offsetTop } = visualViewportBox();
  html.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
  html.style.setProperty(APP_OFFSET_VAR, `${offsetTop}px`);
}

export function lockAppViewport() {
  const html = document.documentElement;
  html.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  html.scrollTop = 0;
  document.body.scrollTop = 0;
  html.style.removeProperty('scroll-behavior');
  html.classList.add(APP_VIEWPORT_LOCK_CLASS);

  const meta = viewportMeta();
  const previousMeta = meta?.getAttribute('content') ?? VIEWPORT_META_DEFAULT;
  meta?.setAttribute('content', VIEWPORT_META_LOCKED);
  applyViewportBox();

  const sync = () => {
    window.scrollTo(0, 0);
    applyViewportBox();
  };

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener('resize', sync);
  visualViewport?.addEventListener('scroll', sync);
  window.addEventListener('resize', sync);

  return () => {
    visualViewport?.removeEventListener('resize', sync);
    visualViewport?.removeEventListener('scroll', sync);
    window.removeEventListener('resize', sync);
    html.classList.remove(APP_VIEWPORT_LOCK_CLASS);
    html.style.removeProperty(APP_HEIGHT_VAR);
    html.style.removeProperty(APP_OFFSET_VAR);
    meta?.setAttribute('content', previousMeta);
  };
}
