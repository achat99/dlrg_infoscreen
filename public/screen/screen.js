let latestPayload = null;
let slides = [];
let currentSlideIndex = 0;
let slideTimer = null;
let clockTimer = null;
let programRefreshTimer = null;
let lastRenderableSignature = '';

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

function formatProgramDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatProgramTimeRange(startAt, endAt, fallback = '') {
  const startDate = startAt ? new Date(startAt) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return fallback || '';
  }

  const startText = startDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const endDate = endAt ? new Date(endAt) : null;
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return startText;
  }

  const endText = endDate.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `${startText}–${endText}`;
}

function isProgramItemOnCurrentDay(item, now = new Date()) {
  const startDate = item?.start_at ? new Date(item.start_at) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return true;
  }

  const effectiveEndValue = item?.effective_end_at || item?.end_at;
  const endDate = effectiveEndValue ? new Date(effectiveEndValue) : new Date(startDate.getTime() + 90 * 60 * 1000);
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return true;
  }

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const nextDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return startDate < nextDayStart && endDate >= dayStart;
}

function isCurrentOrFutureProgramItem(item, now = new Date()) {
  const startDate = item?.start_at ? new Date(item.start_at) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return true;
  }

  const effectiveEndValue = item?.effective_end_at || item?.end_at;
  const endDate = effectiveEndValue ? new Date(effectiveEndValue) : new Date(startDate.getTime() + 90 * 60 * 1000);
  if (!endDate || Number.isNaN(endDate.getTime())) {
    return true;
  }

  return endDate >= now;
}

function getRenderablePayload(payload = {}) {
  const programItems = (payload.programItems || []).filter((item) => isProgramItemOnCurrentDay(item) && isCurrentOrFutureProgramItem(item));

  return {
    ...payload,
    programItems,
    queue: [],
  };
}

function getDefaultDuration() {
  const seconds = Number(latestPayload?.settings?.slide_duration || 12);
  return Math.max(seconds, 3) * 1000;
}

function getSlideKey(slide = {}) {
  if (slide.type === 'program') {
    return `program:${slide.data?.id ?? slide.data?.title ?? ''}`;
  }
  if (slide.type === 'notice') {
    return `notice:${slide.data?.id ?? slide.data?.title ?? ''}`;
  }
  if (slide.type === 'media') {
    return `media:${slide.data?.id ?? slide.data?.filename ?? slide.data?.stream_url ?? ''}`;
  }
  if (slide.type === 'custom') {
    return `custom:${slide.data?.id ?? slide.data?.title ?? ''}`;
  }
  if (slide.type === 'overview') {
    return `overview:${(slide.items || []).map((item) => item.id).join(',')}`;
  }
  return slide.type || 'slide';
}

function isVideoMediaItem(item = {}) {
  return String(item.type || '').toLowerCase() === 'video' || /\.(mp4|webm)$/i.test(item.filename || '');
}

function isStreamMediaItem(item = {}) {
  return String(item.type || '').toLowerCase() === 'stream' && Boolean(item.stream_url);
}

function isRtmpOrRtspStream(item = {}) {
  return String(item.type || '').toLowerCase() === 'stream'
    && (/^rtmp[se]?:\/\//i.test(item.stream_url || '') || /^rtsps?:\/\//i.test(item.stream_url || ''));
}

function getEffectiveStreamUrl(item = {}) {
  const url = item.stream_url || '';
  if (/^rtmp[se]?:\/\//i.test(url) || /^rtsps?:\/\//i.test(url)) {
    return `/stream-hls/${item.id}/index.m3u8`;
  }
  return url;
}

function getYouTubeEmbedUrl(url) {
  const watchMatch = String(url).match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!watchMatch) return null;
  return `https://www.youtube.com/embed/${watchMatch[1]}?autoplay=1&mute=1&controls=0&rel=0`;
}

function getMediaFallbackDuration(item = {}) {
  const seconds = Number(item.duration) || Number(latestPayload?.settings?.slide_duration) || 12;
  return Math.max(seconds, 3) * 1000;
}

function getRenderableSignature(payload = {}) {
  const renderData = getRenderablePayload(payload);
  return JSON.stringify({
    programIds: (renderData.programItems || []).map((item) => `${item.id}:${item.effective_end_at || item.end_at || ''}`),
    noticeIds: (renderData.notices || []).map((item) => `${item.id}:${item.title || ''}:${item.text || ''}`),
    mediaIds: (renderData.media || []).map((item) => `${item.id}:${item.filename || ''}:${item.title || ''}:${item.caption || ''}:${item.duration || ''}:${item.stream_url || ''}`),
    customIds: (renderData.customSlides || []).map((item) => `${item.id}:${item.title || ''}:${item.content || ''}:${getCustomSlideImages(item).join(',')}:${item.duration || ''}`),
  });
}

function getCustomSlideImages(item = {}) {
  const images = Array.isArray(item.images)
    ? item.images
    : Array.isArray(item.image_paths)
      ? item.image_paths
      : [];

  return images.filter(Boolean).slice(0, 4);
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
  const renderData = getRenderablePayload(data);
  const baseSlides = [{ type: 'welcome', duration: getDefaultDuration() }];
  const programItems = renderData.programItems || [];
  const highlightedProgramItems = programItems.filter((item) => Number(item.highlight) === 1);
  const detailProgramItems = highlightedProgramItems.length ? highlightedProgramItems : programItems;

  if (programItems.length) {
    baseSlides.push(...overviewSlides(programItems));
  }

  detailProgramItems.forEach((item) => {
    baseSlides.push({ type: 'program', data: item, duration: getDefaultDuration() });
  });

  (renderData.notices || []).forEach((item) => {
    baseSlides.push({ type: 'notice', data: item, duration: getDefaultDuration() });
  });

  (renderData.media || []).forEach((item) => {
    const duration = (Number(item.duration) || Number(latestPayload?.settings?.slide_duration) || 12) * 1000;
    baseSlides.push({ type: 'media', data: item, duration });
  });

  (renderData.customSlides || []).forEach((item) => {
    const duration = (Number(item.duration) || Number(latestPayload?.settings?.slide_duration) || 12) * 1000;
    baseSlides.push({ type: 'custom', data: item, duration });
  });

  slides = baseSlides.filter((slide, index, allSlides) => {
    if (index === 0) {
      return true;
    }
    return getSlideKey(slide) !== getSlideKey(allSlides[index - 1]);
  });
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
          ${slide.items.map((item) => {
            const timeLabel = formatProgramTimeRange(item.start_at, item.end_at, item.time);
            return `
            <div class="ov-row">
              <div>${escapeHtml(item.icon || '')}</div>
              <div class="ov-time">${escapeHtml(timeLabel)}</div>
              <div><strong>${escapeHtml(item.title)}</strong></div>
              <div>${escapeHtml(item.location || '')}</div>
            </div>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }

  if (slide.type === 'program') {
    const item = slide.data;
    const timeLabel = formatProgramTimeRange(item.start_at, item.end_at, item.time);
    const locationLabel = [formatProgramDate(item.start_at), item.location || ''].filter(Boolean).join(' · ');

    return `
      <section class="slide program-slide">
        <div>
          <div class="prog-time">${escapeHtml(timeLabel)}</div>
          <div class="prog-location">${escapeHtml(locationLabel || item.location || '')}</div>
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
    const cleanTitle = String(item.title || '').trim();
    const cleanCaption = String(item.caption || '').trim();
    const metaElement = cleanTitle || cleanCaption
      ? `
          <figcaption class="media-meta">
            ${cleanTitle ? `<div class="media-caption-title">${escapeHtml(cleanTitle)}</div>` : ''}
            ${cleanCaption ? `<div class="media-caption-text">${escapeHtml(cleanCaption)}</div>` : ''}
          </figcaption>
        `
      : '';

    if (isStreamMediaItem(item)) {
      const streamUrl = getEffectiveStreamUrl(item);
      const youtubeEmbedUrl = getYouTubeEmbedUrl(streamUrl);
      const isHls = /\.m3u8(\?.*)?$/i.test(streamUrl);
      let mediaElement;
      if (youtubeEmbedUrl) {
        mediaElement = `<iframe class="stream-iframe" src="${youtubeEmbedUrl}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      } else if (isHls) {
        mediaElement = `<video class="stream-video hls-stream" data-stream-url="${escapeHtml(streamUrl)}" autoplay muted playsinline aria-label="${escapeHtml(cleanTitle || 'Stream')}"></video>`;
      } else {
        mediaElement = `<video class="stream-video" src="${escapeHtml(streamUrl)}" autoplay muted playsinline aria-label="${escapeHtml(cleanTitle || 'Stream')}"></video>`;
      }
      return `
        <section class="slide media-slide stream-slide">
          <figure class="media-figure">
            ${mediaElement}
            ${metaElement}
          </figure>
        </section>
      `;
    }

    const isVideo = /\.(mp4|webm)$/i.test(item.filename || '');
    const mediaElement = isVideo
      ? `<video src="/uploads/${escapeHtml(item.filename)}" autoplay muted playsinline preload="metadata" aria-label="${escapeHtml(cleanTitle || 'Medieninhalt')}"></video>`
      : `<img src="/uploads/${escapeHtml(item.filename)}" alt="${escapeHtml(cleanTitle || 'Bild')}" />`;

    return `
      <section class="slide media-slide">
        <figure class="media-figure">
          ${mediaElement}
          ${metaElement}
        </figure>
      </section>
    `;
  }

  if (slide.type === 'custom') {
    const item = slide.data;
    const bg = item.background_color || 'transparent';
    const color = item.text_color || 'var(--text-dark)';
    const layout = item.layout || 'center';
    const images = getCustomSlideImages(item);
    const contentMarkup = String(item.content || '').replace(/\n/g, '<br>');

    if (images.length) {
      return `
        <section class="slide custom-slide with-images ${escapeHtml(layout)}" style="background:${escapeHtml(bg)}; color:${escapeHtml(color)}; border-radius:24px; margin:20px; padding:26px;">
          <div class="custom-slide-panel">
            <div class="custom-copy">
              <div class="custom-title">${escapeHtml(item.title)}</div>
              <div class="custom-content">${contentMarkup}</div>
            </div>
            <div class="custom-image-grid count-${images.length}">
              ${images.map((fileName, index) => `
                <div class="custom-image-card image-${index + 1}">
                  <img src="/uploads/${encodeURIComponent(fileName)}" alt="${escapeHtml(item.title || `Slide Bild ${index + 1}`)}" />
                </div>
              `).join('')}
            </div>
          </div>
        </section>
      `;
    }

    return `
      <section class="slide custom-slide ${escapeHtml(layout)}" style="background:${escapeHtml(bg)}; color:${escapeHtml(color)}; border-radius:24px; margin:20px; padding:40px;">
        <div class="custom-title">${escapeHtml(item.title)}</div>
        <div class="custom-content">${contentMarkup}</div>
      </section>
    `;
  }

  return '<section class="slide"></section>';
}

function renderSlides() {
  byId('slideContainer').innerHTML = slides.map(renderSlide).join('');
  byId('indicators').innerHTML = slides.map((_, index) => `<div class="slide-dot ${index === 0 ? 'active' : ''}"></div>`).join('');
}

function getBufferedSlideDuration(index, baseDuration) {
  const resolvedBase = baseDuration || slides[index]?.duration || getDefaultDuration();
  const currentType = slides[index]?.type;
  const nextType = slides[(index + 1) % Math.max(slides.length, 1)]?.type;

  if (currentType === 'media' && nextType === 'media') {
    return resolvedBase + 1800;
  }

  if (currentType === 'media' || nextType === 'media') {
    return resolvedBase + 900;
  }

  return resolvedBase;
}

function scheduleNext(durationOverride) {
  clearTimeout(slideTimer);
  if (slides.length <= 1) {
    return;
  }

  const duration = durationOverride || getBufferedSlideDuration(currentSlideIndex);
  slideTimer = setTimeout(() => {
    showSlide((currentSlideIndex + 1) % slides.length);
  }, duration);
}

function handleActiveStreamSlide(slideIndex, slideEl) {
  const slide = slides[slideIndex];
  if (!slide || slide.type !== 'media' || !isStreamMediaItem(slide.data)) {
    return false;
  }

  // HLS-Streams initialisieren
  const hlsVideo = slideEl?.querySelector('video.hls-stream');
  if (hlsVideo) {
    const streamUrl = hlsVideo.dataset.streamUrl;
    const playVideo = () => {
      const playPromise = hlsVideo.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    };

    if (streamUrl && typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (!hlsVideo._hlsInstance) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
        });
        hlsVideo._hlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(hlsVideo);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (currentSlideIndex === slideIndex) {
            playVideo();
          }
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data?.fatal) {
            return;
          }

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }

          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }

          // Harte Fehler: Instanz verwerfen, damit beim nächsten Aktivieren neu aufgebaut wird.
          try {
            hls.destroy();
          } catch (_error) {
            // ignore destroy errors
          }
          hlsVideo._hlsInstance = null;
        });
      }
      playVideo();
    } else if (hlsVideo.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      if (!hlsVideo.src) {
        hlsVideo.src = streamUrl;
      }
      playVideo();
    } else if (streamUrl) {
      // Fallback: Quelle trotzdem setzen, falls der Browser HLS nativ doch akzeptiert.
      if (hlsVideo.src !== streamUrl) {
        hlsVideo.src = streamUrl;
      }
      playVideo();
    }
  }

  const duration = (Number(slide.data.duration) || Number(latestPayload?.settings?.slide_duration) || 30) * 1000;
  updateProgressBar(duration);
  scheduleNext(duration);
  return true;
}

function handleActiveVideoSlide(slideIndex, slideEl) {
  const video = slideEl?.querySelector('video');
  const slide = slides[slideIndex];
  if (!video || slide?.type !== 'media' || !isVideoMediaItem(slide.data)) {
    return false;
  }

  document.querySelectorAll('.media-slide video').forEach((otherVideo) => {
    if (otherVideo !== video) {
      otherVideo.pause();
      otherVideo.onended = null;
      try {
        otherVideo.currentTime = 0;
      } catch (_error) {
        // ignore seek errors on inactive videos
      }
    }
  });

  const moveNext = () => {
    if (currentSlideIndex === slideIndex && slides.length > 1) {
      showSlide((slideIndex + 1) % slides.length);
    }
  };

  const startPlayback = () => {
    const resolvedDuration = Number.isFinite(video.duration) && video.duration > 0
      ? Math.ceil(video.duration * 1000)
      : getMediaFallbackDuration(slide.data);

    clearTimeout(slideTimer);
    updateProgressBar(resolvedDuration);
    scheduleNext(resolvedDuration + 250);

    video.onended = () => {
      clearTimeout(slideTimer);
      moveNext();
    };

    try {
      video.currentTime = 0;
    } catch (_error) {
      // ignore seek errors if the browser blocks seeking temporarily
    }

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  };

  if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
    startPlayback();
  } else {
    updateProgressBar(getMediaFallbackDuration(slide.data));
    scheduleNext(getMediaFallbackDuration(slide.data));
    video.addEventListener('loadedmetadata', () => {
      if (currentSlideIndex === slideIndex) {
        startPlayback();
      }
    }, { once: true });

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }

  return true;
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
  const screenShell = document.querySelector('.screen-shell');

  allSlides.forEach((slideEl, slideIndex) => {
    slideEl.classList.toggle('active', slideIndex === index);
    if (slideIndex !== index) {
      const video = slideEl.querySelector('video');
      if (video) {
        video.pause();
        video.onended = null;
        try {
          video.currentTime = 0;
        } catch (_error) {
          // ignore seek errors on hidden videos
        }
      }
    }
  });

  dots.forEach((dot, dotIndex) => {
    dot.classList.toggle('active', dotIndex === index);
  });

  currentSlideIndex = index;
  const activeSlideEl = allSlides[index];
  const activeSlide = slides[index];
  screenShell?.classList.toggle('media-focus', activeSlide?.type === 'media');
  screenShell?.classList.toggle('stream-focus', activeSlide?.type === 'media' && isStreamMediaItem(activeSlide?.data));

  if (handleActiveStreamSlide(index, activeSlideEl)) {
    return;
  }

  if (handleActiveVideoSlide(index, activeSlideEl)) {
    return;
  }

  const duration = getBufferedSlideDuration(index);
  updateProgressBar(duration);
  scheduleNext(duration);
}

function applyData(payload, preserveCurrentSlide = false) {
  const nextSignature = getRenderableSignature(payload);
  if (preserveCurrentSlide && nextSignature === lastRenderableSignature) {
    latestPayload = payload;
    updateHeader();
    return;
  }

  latestPayload = payload;
  lastRenderableSignature = nextSignature;
  const currentSlideKey = preserveCurrentSlide ? getSlideKey(slides[currentSlideIndex]) : '';

  updateHeader();
  buildSlides(payload);
  renderSlides();

  let nextIndex = 0;
  if (preserveCurrentSlide && currentSlideKey) {
    const matchingIndex = slides.findIndex((slide) => getSlideKey(slide) === currentSlideKey);
    nextIndex = matchingIndex >= 0 ? matchingIndex : Math.min(currentSlideIndex, Math.max(slides.length - 1, 0));
  }

  showSlide(nextIndex);
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

function startProgramRefresh() {
  clearInterval(programRefreshTimer);
  programRefreshTimer = setInterval(() => {
    if (latestPayload) {
      const nextSignature = getRenderableSignature(latestPayload);
      if (nextSignature !== lastRenderableSignature) {
        applyData(latestPayload, true);
      }
    }
  }, 30000);
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
startProgramRefresh();
setupSocket();
