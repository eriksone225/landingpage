(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('load', () => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0 });
  });

  const header = $('.site-header');
  const menuToggle = $('.menu-toggle');
  const navLinks = $('#navLinks');
  const progress = $('.scroll-progress');

  menuToggle?.addEventListener('click', () => {
    const isOpen = navLinks?.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
  });

  navLinks?.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      navLinks.classList.remove('is-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  const syncScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const amount = max > 0 ? window.scrollY / max : 0;
    document.documentElement.style.setProperty('--scroll', amount.toFixed(4));
    if (progress) progress.style.transform = `scaleX(${amount})`;
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  syncScroll();
  window.addEventListener('scroll', syncScroll, { passive: true });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealEls = $$('.reveal');
  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach((el) => observer.observe(el));
  }

  const filterButtons = $$('.filter-btn');
  const projectCards = $$('.project-card');
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter || 'all';
      filterButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
      projectCards.forEach((card) => {
        const categories = (card.dataset.category || '').split(' ');
        const show = filter === 'all' || categories.includes(filter);
        card.hidden = !show;
        if (show) requestAnimationFrame(() => card.classList.add('is-visible'));
      });
    });
  });

  const audio = $('#audioPlayer');
  const playButton = $('#playPause');
  const select = $('#songSelect');
  const disc = $('.music-disc');
  const title = $('#trackTitle');
  const artist = $('#trackArtist');
  const cover = $('.disc-cover');
  const fileInput = $('#songFile');
  const urlInput = $('#songUrl');
  const addUrl = $('#addUrlSong');
  const progressBar = $('#trackProgress');
  const timeCurrent = $('#timeCurrent');
  const timeDuration = $('#timeDuration');
  const volume = $('#volumeRange');
  const youtubeShell = $('#youtubeShell');

  let localObjectUrl = null;
  let activeSource = 'audio';
  let youtubePlayer = null;
  let pendingYouTube = null;
  let youtubeTimer = null;
  let youtubeScriptRequested = false;
  let currentYouTubeVideoId = null;
  let youtubeTitleRetryTimer = null;
  let hoverPreviewActive = false;
  let hoverStartedPlayback = false;
  let hoverWasPlayingBefore = false;

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  };

  const selectedOption = () => select?.selectedOptions?.[0];
  const selectedType = () => selectedOption()?.dataset.type || 'audio';

  const isYouTubePlaying = () => {
    try {
      return youtubePlayer?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
    } catch {
      return false;
    }
  };

  const isCurrentPlaying = () => {
    if (selectedType() === 'youtube') return isYouTubePlaying();
    return Boolean(audio && !audio.paused && !audio.ended);
  };

  const setPlaying = (playing) => {
    const isPlaying = Boolean(playing);
    document.body.classList.toggle('is-playing', isPlaying);
    playButton?.classList.toggle('is-playing', isPlaying);
    playButton?.setAttribute('aria-label', isPlaying ? 'Pause lagu' : 'Play lagu');
    playButton?.setAttribute('title', isPlaying ? 'Pause' : 'Play');
  };

  const resetProgress = () => {
    if (progressBar) progressBar.value = '0';
    if (timeCurrent) timeCurrent.textContent = '0:00';
    if (timeDuration) timeDuration.textContent = '0:00';
  };

  const extractYouTubeId = (rawValue) => {
    if (!rawValue) return null;
    const value = rawValue.trim();

    const plainId = value.match(/^[a-zA-Z0-9_-]{11}$/);
    if (plainId) return plainId[0];

    try {
      const url = new URL(value);
      const host = url.hostname.replace(/^www\./, '');

      if (host === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return id && id.length === 11 ? id : null;
      }

      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        const watchId = url.searchParams.get('v');
        if (watchId && watchId.length === 11) return watchId;

        const parts = url.pathname.split('/').filter(Boolean);
        const embedIndex = parts.findIndex((part) => ['embed', 'shorts', 'live'].includes(part));
        if (embedIndex >= 0 && parts[embedIndex + 1]?.length === 11) return parts[embedIndex + 1];
      }
    } catch {
      const loose = value.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/);
      return loose?.[1] || null;
    }

    return null;
  };

  const getYouTubeThumbnail = (videoId) => `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

  const findYouTubeOption = (videoId) => {
    if (!select || !videoId) return null;
    return Array.from(select.options).find((option) => option.dataset.youtubeId === videoId) || null;
  };

  const applyTrackMeta = (option) => {
    if (!option) return;
    if (title) {
      title.textContent = option.dataset.title || option.textContent.trim();
      title.classList.toggle('youtube-title-loading', option.dataset.loadingTitle === 'true');
    }
    if (artist) artist.textContent = option.dataset.artist || 'Selected track';
    if (cover && option.dataset.cover) cover.src = option.dataset.cover;
  };

  const updateYouTubeOptionMeta = (videoId, videoTitle, author) => {
    const option = findYouTubeOption(videoId) || selectedOption();
    if (!option || option.dataset.type !== 'youtube' || !videoTitle) return;

    const cleanedTitle = videoTitle.trim();
    const cleanedAuthor = author?.trim();
    option.dataset.title = cleanedTitle;
    option.dataset.artist = cleanedAuthor ? `${cleanedAuthor} · YouTube` : 'YouTube video';
    option.dataset.loadingTitle = 'false';
    option.textContent = cleanedAuthor ? `${cleanedAuthor} — ${cleanedTitle}` : `YouTube — ${cleanedTitle}`;

    if (selectedOption() === option) applyTrackMeta(option);
  };

  const syncYouTubeTitleFromPlayer = (videoId = currentYouTubeVideoId, attempt = 0) => {
    if (!videoId || !youtubePlayer?.getVideoData) return;

    window.clearTimeout(youtubeTitleRetryTimer);

    let data = null;
    try {
      data = youtubePlayer.getVideoData();
    } catch {
      data = null;
    }

    const dataVideoId = data?.video_id || videoId;
    const videoTitle = data?.title?.trim();
    const author = data?.author?.trim();

    if (videoTitle && dataVideoId === videoId) {
      updateYouTubeOptionMeta(videoId, videoTitle, author);
      return;
    }

    if (attempt < 18) {
      youtubeTitleRetryTimer = window.setTimeout(() => syncYouTubeTitleFromPlayer(videoId, attempt + 1), 350);
    }
  };

  const stopYouTubeTimer = () => {
    if (youtubeTimer) window.clearInterval(youtubeTimer);
    youtubeTimer = null;
  };

  const updateYouTubeProgress = () => {
    if (!youtubePlayer?.getDuration || activeSource !== 'youtube') return;
    const duration = youtubePlayer.getDuration();
    const current = youtubePlayer.getCurrentTime();
    if (timeDuration) timeDuration.textContent = formatTime(duration);
    if (timeCurrent) timeCurrent.textContent = formatTime(current);
    if (progressBar && duration) progressBar.value = String((current / duration) * 100);
  };

  const startYouTubeTimer = () => {
    stopYouTubeTimer();
    updateYouTubeProgress();
    youtubeTimer = window.setInterval(updateYouTubeProgress, 500);
  };

  const stopYouTube = () => {
    stopYouTubeTimer();
    if (pendingYouTube) pendingYouTube.autoplay = false;
    try {
      youtubePlayer?.stopVideo?.();
    } catch {
      // The YouTube iframe can briefly be unavailable during reloads.
    }
    if (youtubeShell) youtubeShell.hidden = true;
  };

  const pauseCurrentTrack = () => {
    if (selectedType() === 'youtube') {
      if (pendingYouTube) pendingYouTube.autoplay = false;
      try {
        youtubePlayer?.pauseVideo?.();
      } catch {
        // Keep hover-preview safe while the YouTube iframe is loading.
      }
      stopYouTubeTimer();
      setPlaying(false);
      return;
    }

    audio?.pause();
    setPlaying(false);
  };

  const loadYouTubeApi = () => {
    if (youtubeScriptRequested || window.YT?.Player) return;
    youtubeScriptRequested = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  };

  const buildYouTubePlayerVars = () => {
    const vars = {
      playsinline: 1,
      rel: 0,
      controls: 1,
      modestbranding: 1,
      enablejsapi: 1
    };

    if (window.location.protocol !== 'file:' && window.location.origin) {
      vars.origin = window.location.origin;
    }

    return vars;
  };

  const createYouTubePlayer = (videoId, autoplay = false) => {
    youtubeShell && (youtubeShell.hidden = false);
    currentYouTubeVideoId = videoId;

    youtubePlayer = new window.YT.Player('youtubePlayer', {
      videoId,
      playerVars: buildYouTubePlayerVars(),
      events: {
        onReady: (event) => {
          const target = event.target;
          target.setVolume(Math.round(Number(volume?.value ?? 1) * 100));
          if (autoplay) target.playVideo();
          else target.cueVideoById(videoId);
          updateYouTubeProgress();
          syncYouTubeTitleFromPlayer(videoId);
        },
        onStateChange: (event) => {
          const states = window.YT?.PlayerState || {};
          syncYouTubeTitleFromPlayer(currentYouTubeVideoId);

          if (event.data === states.PLAYING) {
            activeSource = 'youtube';
            setPlaying(true);
            startYouTubeTimer();
          } else if ([states.PAUSED, states.ENDED, states.CUED].includes(event.data)) {
            setPlaying(false);
            if (event.data === states.ENDED && progressBar) progressBar.value = '0';
            stopYouTubeTimer();
            updateYouTubeProgress();
          }
        }
      }
    });
  };

  const ensureYouTubePlayer = (videoId, autoplay = false) => {
    if (!videoId) return;
    activeSource = 'youtube';
    currentYouTubeVideoId = videoId;
    if (youtubeShell) youtubeShell.hidden = false;

    if (!window.YT?.Player) {
      pendingYouTube = { videoId, autoplay };
      loadYouTubeApi();
      return;
    }

    if (!youtubePlayer) {
      createYouTubePlayer(videoId, autoplay);
      return;
    }

    try {
      if (autoplay) youtubePlayer.loadVideoById(videoId);
      else youtubePlayer.cueVideoById(videoId);
      youtubePlayer.setVolume(Math.round(Number(volume?.value ?? 1) * 100));
      syncYouTubeTitleFromPlayer(videoId);
    } catch {
      pendingYouTube = { videoId, autoplay };
    }
  };

  const previousYouTubeReady = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (typeof previousYouTubeReady === 'function') previousYouTubeReady();
    if (pendingYouTube) {
      const { videoId, autoplay } = pendingYouTube;
      pendingYouTube = null;
      ensureYouTubePlayer(videoId, autoplay);
    }
  };

  const loadFromOption = (autoplay = false) => {
    if (!audio || !select) return;
    const option = selectedOption();
    if (!option) return;

    applyTrackMeta(option);
    resetProgress();

    const type = option.dataset.type || 'audio';

    if (type === 'youtube') {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      ensureYouTubePlayer(option.dataset.youtubeId, autoplay);
      return;
    }

    activeSource = 'audio';
    stopYouTube();
    audio.src = option.value;
    audio.load();
    if (autoplay) audio.play().catch(() => setPlaying(false));
  };

  const playCurrentTrack = async () => {
    const option = selectedOption();
    if (!option) return false;

    if ((option.dataset.type || 'audio') === 'youtube') {
      activeSource = 'youtube';
      const videoId = option.dataset.youtubeId;
      audio?.pause();
      if (audio) {
        audio.removeAttribute('src');
        audio.load();
      }
      ensureYouTubePlayer(videoId, true);
      return true;
    }

    stopYouTube();
    if (!audio?.src) loadFromOption(false);

    try {
      await audio.play();
      return true;
    } catch {
      setPlaying(false);
      return false;
    }
  };

  select?.addEventListener('change', () => loadFromOption(true));

  playButton?.addEventListener('click', async () => {
    const option = selectedOption();
    if (!option) return;

    if (isCurrentPlaying()) {
      pauseCurrentTrack();
      return;
    }

    await playCurrentTrack();
  });

  disc?.addEventListener('click', () => playButton?.click());

  disc?.addEventListener('pointerenter', async () => {
    if (window.matchMedia('(hover: none)').matches) return;
    hoverPreviewActive = true;
    hoverWasPlayingBefore = isCurrentPlaying();
    hoverStartedPlayback = false;

    if (!hoverWasPlayingBefore) {
      hoverStartedPlayback = await playCurrentTrack();
      if (hoverPreviewActive && hoverStartedPlayback) disc.classList.add('is-hover-preview');
    }
  });

  disc?.addEventListener('pointerleave', () => {
    if (!hoverPreviewActive) return;
    hoverPreviewActive = false;
    disc.classList.remove('is-hover-preview');

    if (hoverStartedPlayback && !hoverWasPlayingBefore) {
      pauseCurrentTrack();
    }

    hoverStartedPlayback = false;
    hoverWasPlayingBefore = false;
  });

  audio?.addEventListener('play', () => {
    activeSource = 'audio';
    stopYouTube();
    setPlaying(true);
  });

  audio?.addEventListener('pause', () => setPlaying(false));
  audio?.addEventListener('ended', () => setPlaying(false));

  audio?.addEventListener('loadedmetadata', () => {
    if (timeDuration) timeDuration.textContent = formatTime(audio.duration);
  });

  audio?.addEventListener('timeupdate', () => {
    if (activeSource !== 'audio' || !progressBar || !audio.duration) return;
    progressBar.value = String((audio.currentTime / audio.duration) * 100);
    if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
  });

  progressBar?.addEventListener('input', () => {
    const amount = Number(progressBar.value) / 100;

    if (activeSource === 'youtube') {
      const duration = youtubePlayer?.getDuration?.();
      if (duration) youtubePlayer.seekTo(amount * duration, true);
      updateYouTubeProgress();
      return;
    }

    if (!audio?.duration) return;
    audio.currentTime = amount * audio.duration;
  });

  volume?.addEventListener('input', () => {
    const value = Number(volume.value);
    if (audio) audio.volume = value;
    try {
      youtubePlayer?.setVolume?.(Math.round(value * 100));
    } catch {
      // Keep the UI responsive even if the iframe is not ready yet.
    }
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file || !audio || !select) return;

    if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    localObjectUrl = URL.createObjectURL(file);

    let option = select.querySelector('option[data-local="true"]');
    if (!option) {
      option = document.createElement('option');
      option.dataset.local = 'true';
      select.append(option);
    }

    option.value = localObjectUrl;
    option.textContent = `File lokal: ${file.name}`;
    option.dataset.type = 'audio';
    option.dataset.title = file.name.replace(/\.[^.]+$/, '');
    option.dataset.artist = 'Lagu pilihan kamu';
    option.dataset.cover = 'assets/images/icons.png';
    option.dataset.loadingTitle = 'false';
    option.selected = true;
    loadFromOption(true);
  });

  addUrl?.addEventListener('click', () => {
    const url = urlInput?.value?.trim();
    if (!url || !select) return;

    const youtubeId = extractYouTubeId(url);
    const option = document.createElement('option');

    if (youtubeId) {
      option.value = `https://www.youtube.com/watch?v=${youtubeId}`;
      option.textContent = 'YouTube: mengambil judul...';
      option.dataset.type = 'youtube';
      option.dataset.youtubeId = youtubeId;
      option.dataset.title = 'Mengambil judul YouTube...';
      option.dataset.artist = 'YouTube video';
      option.dataset.cover = getYouTubeThumbnail(youtubeId);
      option.dataset.loadingTitle = 'true';
    } else {
      option.value = url;
      option.textContent = `Audio URL: ${url.replace(/^https?:\/\//, '').slice(0, 42)}`;
      option.dataset.type = 'audio';
      option.dataset.title = 'Custom URL Track';
      option.dataset.artist = 'Audio URL langsung';
      option.dataset.cover = 'assets/images/icons.png';
      option.dataset.loadingTitle = 'false';
    }

    select.append(option);
    option.selected = true;
    if (urlInput) urlInput.value = '';
    loadFromOption(true);
  });

  loadFromOption(false);
})();
