let latestPayload = null;
let slides = [];
let currentSlideIndex = 0;
let slideTimer = null;
let clockTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDefaultDuration() {
  const seconds = Number(latestPayload?.settings?.slide_duration || 12);
  return Math.max(seconds, 3) * 1000;
}

function showFallbackLogo() {
  const logoImg = byId('logoImg');
  const logoText = byId('logoText');

  logoImg.style.display = 'none';
  logoText.style.display = 'block';
}

function updateLogo(logoPath) {
  const logoImg = byId('logoImg');
  const logoText = byId('logoText');
  const normalizedPath = String(logoPath || '').trim();

  if (!normalizedPath) {
    logoImg.removeAttribute('src');
    showFallbackLogo();
    return;
  }

  logoImg.onload = () => {
    logoImg.style.display = 'block';
    logoText.style.display = 'none';
  };

  logoImg.onerror = () => {
    logoImg.removeAttribute('src');
    showFallbackLogo();
  };

  if (logoImg.getAttribute('src') !== normalizedPath) {
    showFallbackLogo();
    logoImg.src = normalizedPath;
    return;
  }

  if (logoImg.complete && logoImg.naturalWidth > 0) {
    logoImg.style.display = 'block';
    logoText.style.display = 'none';
  }
}

function updateHeader() {
  const settings = latestPayload?.settings || {};
  byId('eventName').textContent = settings.event_name || 'Herzlich Willkommen';
  byId('eventSubtitle').textContent = settings.event_subtitle || '';
  byId('eventDate').textContent = settings.event_date || '';
  updateLogo(settings.logo_path);
}

function overviewSlides(programItems) {
  const result = [];
  for (let index = 0; index < programItems.length; index += 8) {
    result.push({
      type: 'overview',
      items: programItems.slice(index, index + 8),
      page: Math.floor(index / 8) + 1,
      total: Math.ceil(programItems.length / 8),
      duration: getDefaultDuration(),
    });
  }
  return result;
}

function buildSlideFromQueueItem(queueItem, data) {
  const programItems = data.programItems || [];
  const notices = data.notices || [];
  const media = data.media || [];
  const customSlides = data.customSlides || [];

  switch (queueItem.slide_type) {
    case 'welcome':
      return [{ type: 'welcome', duration: getDefaultDuration() }];
    case 'overview':
      return overviewSlides(programItems);
    case 'program': {
      const item = programItems.find((entry) => entry.id === queueItem.reference_id);
      return item ? [{ type: 'program', data: item, duration: getDefaultDuration() }] : [];
    }
    case 'notice': {
      const item = notices.find((entry) => entry.id === queueItem.reference_id);
      return item ? [{ type: 'notice', data: item, duration: getDefaultDuration() }] : [];
    }
    case 'media': {
      const item = media.find((entry) => entry.id === queueItem.reference_id);
      return item ? [{ type: 'media', data: item, duration: (Number(item.duration) || Number(latestPayload?.settings?.slide_duration) || 12) * 1000 }] : [];
    }
    case 'custom': {
      const item = customSlides.find((entry) => entry.id === queueItem.reference_id);
      return item ? [{ type: 'custom', data: item, duration: (Number(item.duration) || Number(latestPayload?.settings?.slide_duration) || 12) * 1000 }] : [];
    }
    default:
      return [];
  }
}

function buildSlides(data) {
  const queue = Array.isArray(data.queue) && data.queue.length ? data.queue.filter((item) => item.enabled !== 0) : [];
  const baseSlides = [];

  if (queue.length) {
    queue.forEach((queueItem) => {
      baseSlides.push(...buildSlideFromQueueItem(queueItem, data));
    });

    queue
      .filter((item) => Number(item.repeat_every) > 0)
      .forEach((queueItem) => {
        const interval = Number(queueItem.repeat_every);
        const extraSlides = buildSlideFromQueueItem(queueItem, data);
        if (!extraSlides.length || interval <= 0) return;

        for (let index = interval; index < baseSlides.length; index += interval + 1) {
          baseSlides.splice(index, 0, ...extraSlides.map((slide) => ({ ...slide })));
        }
      });
  }

  if (!baseSlides.length) {
    baseSlides.push({ type: 'welcome', duration: getDefaultDuration() });
    baseSlides.push(...overviewSlides(data.programItems || []));
    (data.notices || []).forEach((item) => baseSlides.push({ type: 'notice', data: item, duration: getDefaultDuration() }));
  }

  slides = baseSlides;
}

function renderSlide(slide) {
  if (slide.type === 'welcome') {
    return `
      <section class="slide welcome-slide">
        <div class="welcome-title">${escapeHtml(latestPayload?.settings?.event_name || 'Herzlich Willkommen')}</div>
        <div class="welcome-sub">${escapeHtml(latestPayload?.settings?.event_subtitle || latestPayload?.settings?.event_date || '')}</div>
      </section>
    `;
  }

  if (slide.type === 'overview') {
    const pageText = slide.total > 1 ? ` (${slide.page}/${slide.total})` : '';
    return `
      <section class="slide overview-slide">
        <div class="ov-heading">Programmübersicht${pageText}</div>
        <div class="ov-list">
          ${slide.items.map((item) => `
            <div class="ov-row">
              <div>${escapeHtml(item.icon || '')}</div>
              <div class="ov-time">${escapeHtml(item.time)}</div>
              <div><strong>${escapeHtml(item.title)}</strong></div>
              <div>${escapeHtml(item.location || '')}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  if (slide.type === 'program') {
    const item = slide.data;
    return `
      <section class="slide program-slide">
        <div>
          <div class="prog-time">${escapeHtml(item.time)}</div>
          <div class="prog-location">${escapeHtml(item.location || '')}</div>
        </div>
        <div class="prog-separator"></div>
        <div>
          <div class="prog-category">${escapeHtml(item.category || '')}</div>
          <div class="prog-title">${escapeHtml(item.title)}</div>
          <div class="prog-desc">${escapeHtml(item.description || '')}</div>
          <div class="mt-3" style="font-size:44px;">${escapeHtml(item.icon || '')}</div>
        </div>
      </section>
    `;
  }

  if (slide.type === 'notice') {
    const item = slide.data;
    const warning = String(item.type || '').toLowerCase() === 'warnung';
    return `
      <section class="slide notice-slide ${warning ? 'warning' : 'info'}">
        <div class="notice-badge">${escapeHtml((item.type || 'Info').toUpperCase())}</div>
        <div class="notice-title">${escapeHtml(item.title)}</div>
        <div class="notice-text">${escapeHtml(item.text || '')}</div>
      </section>
    `;
  }

  if (slide.type === 'media') {
    const item = slide.data;
    const isVideo = /\.(mp4|webm)$/i.test(item.filename || '');
    const mediaElement = isVideo
      ? `<video src="/uploads/${escapeHtml(item.filename)}" autoplay muted loop playsinline></video>`
      : `<img src="/uploads/${escapeHtml(item.filename)}" alt="${escapeHtml(item.title || item.original_name)}" />`;

    return `
      <section class="slide media-slide">
        <figure class="media-figure">${mediaElement}</figure>
        <div>
          <div class="media-caption-title">${escapeHtml(item.title || item.original_name)}</div>
          <div class="media-caption-text">${escapeHtml(item.caption || '')}</div>
        </div>
      </section>
    `;
  }

  if (slide.type === 'custom') {
    const item = slide.data;
    const bg = item.background_color || 'transparent';
    const color = item.text_color || 'var(--text-dark)';
    const layout = item.layout || 'center';
    return `
      <section class="slide custom-slide ${escapeHtml(layout)}" style="background:${escapeHtml(bg)}; color:${escapeHtml(color)}; border-radius:24px; margin:20px; padding:40px;">
        <div class="custom-title">${escapeHtml(item.title)}</div>
        <div class="custom-content">${item.content || ''}</div>
      </section>
    `;
  }

  return '<section class="slide"></section>';
}

function renderSlides() {
  byId('slideContainer').innerHTML = slides.map(renderSlide).join('');
  byId('indicators').innerHTML = slides.map((_, index) => `<div class="slide-dot ${index === 0 ? 'active' : ''}"></div>`).join('');
}

function scheduleNext() {
  clearTimeout(slideTimer);
  if (slides.length <= 1) {
    return;
  }

  const duration = slides[currentSlideIndex]?.duration || getDefaultDuration();
  slideTimer = setTimeout(() => {
    showSlide((currentSlideIndex + 1) % slides.length);
  }, duration);
}

function updateProgressBar(duration) {
  const bar = byId('progressBar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bar.style.transition = `width ${duration}ms linear`;
      bar.style.width = '100%';
    });
  });
}

function showSlide(index) {
  const allSlides = Array.from(document.querySelectorAll('.slide'));
  const dots = Array.from(document.querySelectorAll('.slide-dot'));
  allSlides.forEach((slideEl, slideIndex) => {
    slideEl.classList.toggle('active', slideIndex === index);
  });
  dots.forEach((dot, dotIndex) => {
    dot.classList.toggle('active', dotIndex === index);
  });

  currentSlideIndex = index;
  const duration = slides[index]?.duration || getDefaultDuration();
  updateProgressBar(duration);
  scheduleNext();
}

function applyData(payload) {
  latestPayload = payload;
  updateHeader();
  buildSlides(payload);
  renderSlides();
  showSlide(0);
}

function buildPreviewSlide(payload) {
  if (!latestPayload) {
    return null;
  }
  const result = buildSlideFromQueueItem(payload, latestPayload);
  return result[0] || null;
}

function forcePreview(payload) {
  const previewSlide = buildPreviewSlide(payload);
  if (!previewSlide) {
    return;
  }

  const previousSlides = slides.slice();
  slides = [previewSlide];
  renderSlides();
  showSlide(0);

  clearTimeout(slideTimer);
  setTimeout(() => {
    slides = previousSlides.length ? previousSlides : slides;
    renderSlides();
    showSlide(Math.min(currentSlideIndex, slides.length - 1));
  }, previewSlide.duration || getDefaultDuration());
}

async function loadInitialData() {
  const response = await fetch('/api/public/screen-data');
  const data = await response.json();
  applyData(data);
}

function startClock() {
  const tick = () => {
    byId('clock').textContent = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

function setupSocket() {
  const socket = io();
  socket.on('connect', () => {
    byId('connectionIndicator').classList.remove('offline');
    socket.emit('client:register', { role: 'screen' });
  });
  socket.on('disconnect', () => {
    byId('connectionIndicator').classList.add('offline');
  });
  socket.on('screen:update', (payload) => applyData(payload));
  socket.on('screen:force-slide', (payload) => forcePreview(payload));
  socket.on('screen:reload', () => window.location.reload());
}

loadInitialData().catch(() => {
  applyData({ settings: { event_name: 'Herzlich Willkommen', event_subtitle: 'Warte auf Daten …', slide_duration: 12 }, programItems: [], notices: [], media: [], customSlides: [], queue: [] });
});
startClock();
setupSocket();
