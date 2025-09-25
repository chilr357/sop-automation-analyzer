const init = async () => {
  try {
    const api = window.desktopAPI;
    if (!api) {
      throw new Error('Desktop bridge is unavailable');
    }

    const info = await api.getAppInfo();
    const versionLabel = document.getElementById('version');
    if (versionLabel) {
      versionLabel.textContent = info?.version ? `Version ${info.version}` : 'Ready';
    }

    const startUrl = await api.getStartUrl();
    if (!startUrl) {
      throw new Error('Missing start URL');
    }

    const iframe = document.getElementById('app-frame');
    const reloadButton = document.getElementById('reload');
    const externalButton = document.getElementById('open-external');

    if (reloadButton) {
      reloadButton.addEventListener('click', () => {
        if (iframe) {
          iframe.src = startUrl;
        }
      });
    }

    if (externalButton) {
      externalButton.addEventListener('click', () => api.openExternal(startUrl));
    }

    if (iframe) {
      iframe.src = startUrl;
    }
  } catch (error) {
    console.error('Failed to load SOP Automation Analyzer web app', error);
    const errorBanner = document.getElementById('error-banner');
    if (errorBanner) {
      errorBanner.textContent = 'Unable to load the web application. Please ensure the build assets are available.';
      errorBanner.removeAttribute('hidden');
    }
  }
};

window.addEventListener('DOMContentLoaded', init);
