/* ============================================================================
 * Plenrip Audio — Centralized GSAP Animation Controller (GSAP 3.15.1)
 *
 * Inspired by PlanRift.github.io (CustomEase "inOut" & "outSmooth").
 * Edit the ANIM_CONFIG object below to customize timings, eases, distances,
 * intro text, or toggle individual animations on/off.
 * ========================================================================== */
(function () {
  'use strict';

  // ==========================================================================
  // 1. USER-EDITABLE ANIMATION CONFIGURATION
  //    Tweak any value here (or live in DevTools via PlenripAnimations.config)
  // ==========================================================================
  const ANIM_CONFIG = {
    // Master toggle — set to false to disable all GSAP animations instantly
    enabled: true,

    // Signature CustomEase curves from PlanRift.github.io
    eases: {
      inOut: 'M0,0 C0.7,0 0.198,1 1,1',
      outSmooth: 'M0,0 C0.139,0.336 0.202,1 1,1',
      exitIn: 'power1.in',
    },

    // 1A: Full Portfolio Opening Intro (plays ONLY when NOT logged in -> reveals Login / Welcome page)
    introLoggedOut: {
      enabled: true,
      line1: 'My Little',
      line2: 'Music Player',
      skipHint: 'Click anywhere or press Esc to skip',
      line1Duration: 1.3,
      line1Y: 42,
      line2Duration: 1.3,
      line2Y: 50,
      line2Overlap: 0.72,      // Seconds line2 overlaps with line1
      holdSeconds: 0.32,       // Brief hold when both lines are visible
      textFadeOutDuration: 0.58,
      textFadeOutY: -22,
      overlayFadeDuration: 0.72,
      welcomeRevealDuration: 0.92,
      welcomeRevealY: 44,
      welcomeRevealScale: 0.98,
    },

    // 1B: Quick Shell Reveal (plays EVERY page load when already logged in)
    introLoggedIn: {
      enabled: true,
      overlayFadeDuration: 0.42,
      sidebarDuration: 0.62,
      sidebarX: -28,
      mainDuration: 0.72,
      mainY: 26,
      playerBarDuration: 0.68,
      playerBarY: 32,
    },

    // Page-to-page route transitions
    routeTransitions: {
      // Exact top-to-bottom sidebar order for directional vertical scroll transitions
      verticalStack: ['search', 'home', 'artists', 'albums', 'songs', 'files'],

      // Detail routes inherit their sidebar section when jumping to ANOTHER stack route
      // (while drilling into/out of detail uses 2A Portfolio Glide)
      stackParentMap: {
        'artist-detail': 'artists',
        'album-detail': 'albums',
      },

      // Single direct scroll UP / DOWN between verticalStack routes (even when skipping levels)
      verticalScroll: {
        distance: 112,         // Vertical travel distance in pixels
        outDuration: 0.36,
        inDuration: 0.56,
        outEase: 'outSmooth',
        inEase: 'outSmooth',
      },

      // 2A: Snappy Portfolio Glide (Playlists, Playlist Detail, Favourites, Artist/Album Detail)
      portfolioGlide: {
        outDuration: 0.24,
        outScale: 0.96,
        outEase: 'power1.in',
        inDuration: 0.52,
        inY: 26,
        inEase: 'outSmooth',
        staggerCards: true,
        staggerAmount: 0.025,
        staggerMaxItems: 16,
        staggerY: 16,
        staggerDuration: 0.42,
      },

      // Normal clean fade-in when clicking the song title/cover on the bottom player bar -> Now Playing
      playerTitleFade: {
        outDuration: 0.2,
        inDuration: 0.36,
        ease: 'power1.out',
      },
    },

    // Fullscreen Listening Room (#signature-modal) opened from player bar: outSmooth zoom-in + fade-in
    fullscreenRoom: {
      inDuration: 0.62,
      inScale: 0.88,
      inEase: 'outSmooth',
      outDuration: 0.3,
      outScale: 0.93,
      outEase: 'power2.in',
    },

    // Slide-out right drawers (#queue-drawer, #lyrics-drawer) & mobile sidebar
    drawers: {
      inDuration: 0.44,
      inEase: 'outSmooth',
      outDuration: 0.28,
      outEase: 'power2.in',
      backdropDuration: 0.28,
      snapBackDuration: 0.36,
    },

    // Modals (Settings, Create Playlist, Save Queue, Add to Playlist, Playlist Cover, Shortcuts, Lyrics Sources)
    modals: {
      backdropDuration: 0.26,
      panelInDuration: 0.44,
      panelInY: 30,
      panelInScale: 0.97,
      panelInEase: 'outSmooth',
      panelOutDuration: 0.2,
      panelOutY: 14,
      panelOutScale: 0.98,
      panelOutEase: 'power2.in',
    },

    // Track context menu pop-in
    contextMenu: {
      inDuration: 0.18,
      inY: -6,
      inScale: 0.96,
      inEase: 'outSmooth',
      outDuration: 0.12,
    },

    // Toast notification (.overlay-comingSoon inOut style)
    toast: {
      inDuration: 0.4,
      holdDuration: 2.3,
      outDuration: 0.4,
      yOffset: -12,
      ease: 'inOut',
    },

    // Sidebar width collapse/expand
    sidebarCollapse: {
      expandedWidth: 240,
      collapsedWidth: 64,
      duration: 0.34,
      ease: 'outSmooth',
    },

    // Parabolic cover-art fly into bottom player bar
    coverFly: {
      duration: 0.48,
      arcLiftMin: 38,
      arcLiftMax: 92,
      ease: 'outSmooth',
    },

    // Smooth artwork crossfade (changeImageWithFade style) for Now Playing & Listening Room
    coverCrossfade: {
      fadeOutDuration: 0.24,
      fadeInDuration: 0.42,
      inScale: 1.03,
      ease: 'outSmooth',
    },

    // Welcome 5-step card transitions
    welcomeStep: {
      duration: 0.38,
      xOffset: 22,
      ease: 'outSmooth',
      progressDuration: 0.42,
    },

    // Subtle tactile button press feedback (strictly skips untouchable zones & player sliders)
    buttonPress: {
      enabled: true,
      pressScale: 0.965,
      downDuration: 0.1,
      upDuration: 0.28,
      upEase: 'outSmooth',
    },
  };

  // ==========================================================================
  // 2. PROTECTED ZONES & GSAP INITIALIZATION
  // ==========================================================================
  const PROTECTED_MODAL_IDS = new Set([
    'files-metadata-modal',
    'ytm-folder-picker-modal',
  ]);

  const PROTECTED_PRESS_SELECTOR = [
    '#view-files',
    '#files-metadata-modal',
    '#ytm-downloader-section',
    '#ytm-folder-picker-modal',
    '#player-seek-row',
    '.volume-group',
    'input[type="range"]',
  ].join(', ');

  let easesRegistered = false;
  let introStarted = false;
  let introTimeline = null;

  let activeRouteTimeline = null;
  let activeOutgoingEl = null;
  let activeIncomingEl = null;
  let activeRouteMainEl = null;

  let toastTimeline = null;
  let activeModalTweens = new WeakMap();
  let activeDrawerTweens = new WeakMap();
  let sigTimeline = null;
  let contextMenuTween = null;

  function hasGsap() {
    return typeof window.gsap !== 'undefined';
  }

  function registerCustomEases() {
    if (easesRegistered || !hasGsap()) return;
    try {
      if (typeof window.CustomEase !== 'undefined') {
        window.gsap.registerPlugin(window.CustomEase);
        window.CustomEase.create('inOut', ANIM_CONFIG.eases.inOut);
        window.CustomEase.create('outSmooth', ANIM_CONFIG.eases.outSmooth);
      }
      easesRegistered = true;
    } catch {
      easesRegistered = true;
    }
  }

  function resolveEase(name, fallback = 'power3.out') {
    registerCustomEases();
    if (!name) return fallback;
    if (typeof window.CustomEase === 'undefined') {
      if (name === 'inOut') return 'power3.inOut';
      if (name === 'outSmooth') return 'power3.out';
    }
    return name;
  }

  function isMotionDisabled() {
    if (!ANIM_CONFIG.enabled || !hasGsap()) return true;
    if (document.documentElement.hasAttribute('data-motion-paused')) return true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return true;
    return false;
  }

  function isDesktop() {
    return window.innerWidth >= 768;
  }

  function $(id) {
    return document.getElementById(id);
  }

  // Register eases immediately if GSAP is already loaded
  registerCustomEases();

  // ==========================================================================
  // 3. INTRO OVERLAY HELPERS (1A Logged-Out Intro & 1B Logged-In Shell Reveal)
  // ==========================================================================
  function hideIntroImmediately() {
    introStarted = true;
    if (introTimeline) {
      introTimeline.kill();
      introTimeline = null;
    }
    const overlay = $('app-intro-overlay');
    if (overlay) {
      if (hasGsap()) window.gsap.killTweensOf(overlay);
      overlay.style.display = 'none';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      overlay.classList.add('hidden');
    }
  }

  function getActiveMainViewEl() {
    const mount = $('view-mount');
    if (!mount) return null;
    for (const child of mount.children) {
      if (!child.classList.contains('hidden')) return child;
    }
    return null;
  }

  // 1A: Full Portfolio Intro -> reveals Login / Welcome view (when NOT logged in)
  function playLoggedOutIntro(options = {}) {
    introStarted = true;
    const cfg = ANIM_CONFIG.introLoggedOut;
    const overlay = $('app-intro-overlay');
    const welcomeEl = options.welcomeEl || $('view-welcome');

    if (isMotionDisabled() || !cfg.enabled || !overlay) {
      hideIntroImmediately();
      options.onComplete?.();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;

    const textWrap = overlay.querySelector('.intro-text-wrap');
    const line1El = overlay.querySelector('.intro-line-1');
    const line2El = overlay.querySelector('.intro-line-2');
    const skipHintEl = overlay.querySelector('.intro-skip-hint');

    if (line1El) line1El.textContent = cfg.line1;
    if (line2El) line2El.textContent = cfg.line2;
    if (skipHintEl) skipHintEl.textContent = cfg.skipHint;

    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    if (textWrap) textWrap.classList.remove('hidden');

    const welcomeCard = welcomeEl?.querySelector('#welcome-card');
    const welcomeHeader = welcomeEl?.querySelector('header');
    const revealTargets = [welcomeHeader, welcomeCard].filter(Boolean);

    if (revealTargets.length > 0) {
      gsap.set(revealTargets, { opacity: 0, y: cfg.welcomeRevealY, scale: cfg.welcomeRevealScale });
    }

    let finished = false;
    const finishAll = (skipped = false) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', onSkipKey);
      overlay.removeEventListener('click', onSkipClick);
      if (introTimeline) {
        introTimeline.kill();
        introTimeline = null;
      }

      if (skipped) {
        gsap.to(overlay, {
          opacity: 0,
          duration: 0.3,
          ease: resolveEase('outSmooth'),
          onComplete: () => {
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
            overlay.classList.add('hidden');
          },
        });
        if (revealTargets.length > 0) {
          gsap.to(revealTargets, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.45,
            stagger: 0.06,
            ease: resolveEase('outSmooth'),
            clearProps: 'transform,opacity',
          });
        }
      } else {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('hidden');
        if (revealTargets.length > 0) {
          gsap.set(revealTargets, { clearProps: 'transform,opacity' });
        }
      }
      options.onComplete?.();
    };

    const onSkipClick = () => finishAll(true);
    const onSkipKey = (e) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        finishAll(true);
      }
    };
    overlay.addEventListener('click', onSkipClick);
    window.addEventListener('keydown', onSkipKey);

    const inOut = resolveEase('inOut', 'power3.inOut');
    const outSmooth = resolveEase('outSmooth', 'power3.out');

    const tl = gsap.timeline({
      onComplete: () => finishAll(false),
    });
    introTimeline = tl;

    if (line1El) {
      tl.fromTo(
        line1El,
        { opacity: 0, y: cfg.line1Y },
        { opacity: 1, y: 0, duration: cfg.line1Duration, ease: inOut }
      );
    }
    if (line2El) {
      tl.fromTo(
        line2El,
        { opacity: 0, y: cfg.line2Y },
        { opacity: 1, y: 0, duration: cfg.line2Duration, ease: inOut },
        `-=${cfg.line2Overlap}`
      );
    }
    if (skipHintEl) {
      tl.fromTo(
        skipHintEl,
        { opacity: 0 },
        { opacity: 0.55, duration: 0.45, ease: 'power1.out' },
        '-=0.7'
      );
    }

    // Brief cinematic hold
    tl.to({}, { duration: cfg.holdSeconds });

    // Lift text out cleanly
    const textEls = [line1El, line2El, skipHintEl].filter(Boolean);
    if (textEls.length > 0) {
      tl.to(textEls, {
        opacity: 0,
        y: cfg.textFadeOutY,
        duration: cfg.textFadeOutDuration,
        stagger: 0.06,
        ease: inOut,
      });
    }

    // Dissolve black veil & allow interaction right away
    tl.set(overlay, { pointerEvents: 'none' }, '-=0.25');
    tl.to(
      overlay,
      {
        opacity: 0,
        duration: cfg.overlayFadeDuration,
        ease: outSmooth,
      },
      '-=0.28'
    );

    // Smoothly glide in the Welcome / Login card with outSmooth
    if (revealTargets.length > 0) {
      tl.to(
        revealTargets,
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: cfg.welcomeRevealDuration,
          stagger: 0.08,
          ease: outSmooth,
          clearProps: 'transform,opacity',
        },
        `-=${Math.max(0.2, cfg.overlayFadeDuration * 0.72)}`
      );
    }
  }

  // 1B: Quick Shell Reveal (plays EVERY load when already logged in)
  function playLoggedInReveal(options = {}) {
    introStarted = true;
    const cfg = ANIM_CONFIG.introLoggedIn;
    const overlay = $('app-intro-overlay');

    if (isMotionDisabled() || !cfg.enabled) {
      hideIntroImmediately();
      options.onComplete?.();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const outSmooth = resolveEase('outSmooth', 'power3.out');

    if (overlay) {
      const textWrap = overlay.querySelector('.intro-text-wrap');
      if (textWrap) textWrap.classList.add('hidden');
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'none';
    }

    const tl = gsap.timeline({
      onComplete: () => {
        if (overlay) {
          overlay.style.display = 'none';
          overlay.classList.add('hidden');
        }
        introTimeline = null;
        options.onComplete?.();
      },
    });
    introTimeline = tl;

    if (overlay) {
      tl.to(overlay, {
        opacity: 0,
        duration: cfg.overlayFadeDuration,
        ease: outSmooth,
      });
    }

    if (options.isWelcome) {
      const welcomeEl = $('view-welcome');
      const targets = [welcomeEl?.querySelector('header'), welcomeEl?.querySelector('#welcome-card')].filter(Boolean);
      if (targets.length > 0) {
        tl.fromTo(
          targets,
          { opacity: 0, y: cfg.mainY },
          {
            opacity: 1,
            y: 0,
            duration: cfg.mainDuration,
            stagger: 0.07,
            ease: outSmooth,
            clearProps: 'transform,opacity',
          },
          overlay ? `-=${cfg.overlayFadeDuration * 0.75}` : 0
        );
      }
      return;
    }

    addShellEntranceTweens(tl, overlay ? `-=${cfg.overlayFadeDuration * 0.8}` : 0);
  }

  // Smooth shell reveal without black veil (used when finishing login/welcome -> home)
  function playShellEntrance() {
    if (isMotionDisabled()) return;
    registerCustomEases();
    const tl = window.gsap.timeline();
    addShellEntranceTweens(tl, 0);
  }

  function addShellEntranceTweens(tl, startPos) {
    const cfg = ANIM_CONFIG.introLoggedIn;
    const outSmooth = resolveEase('outSmooth', 'power3.out');
    const sidebar = $('sidebar');
    const activeView = getActiveMainViewEl();
    const playerBar = $('bottom-player-bar');

    let pos = startPos;

    if (sidebar && !sidebar.classList.contains('hidden') && isDesktop()) {
      tl.fromTo(
        sidebar,
        { x: cfg.sidebarX, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: cfg.sidebarDuration,
          ease: outSmooth,
          clearProps: 'transform,opacity',
        },
        pos
      );
      pos = `-=${Math.max(0.1, cfg.sidebarDuration * 0.78)}`;
    }

    if (activeView) {
      tl.fromTo(
        activeView,
        { y: cfg.mainY, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: cfg.mainDuration,
          ease: outSmooth,
          clearProps: 'transform,opacity',
        },
        pos
      );
    }

    if (playerBar && !playerBar.classList.contains('hidden')) {
      tl.fromTo(
        playerBar,
        { y: cfg.playerBarY, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: cfg.playerBarDuration,
          ease: outSmooth,
          clearProps: 'transform,opacity',
        },
        `-=${Math.max(0.1, cfg.mainDuration * 0.8)}`
      );
    }
  }

  // Safety net: never leave the user staring at #app-intro-overlay if app init errors out
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (!introStarted) hideIntroImmediately();
    }, 4000);
  });

  // ==========================================================================
  // 4. PAGE-TO-PAGE ROUTE TRANSITIONS
  //    - Vertical stack (search -> home -> artists -> albums -> songs -> files):
  //      Single direct scroll UP or DOWN straight to the destination
  //    - Playlists / Favourites / Details: 2A Snappy Portfolio Glide
  //    - Player bar song title / cover -> Now Playing: Normal fade-in
  // ==========================================================================
  const ROUTE_CLEAR_PROPS = 'transform,opacity,position,top,left,right,width,zIndex,pointerEvents';

  function cleanupActiveRouteTransition() {
    if (activeRouteTimeline) {
      activeRouteTimeline.kill();
      activeRouteTimeline = null;
    }
    if (activeOutgoingEl) {
      activeOutgoingEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(activeOutgoingEl, { clearProps: ROUTE_CLEAR_PROPS });
      activeOutgoingEl = null;
    }
    if (activeIncomingEl) {
      if (hasGsap()) window.gsap.set(activeIncomingEl, { clearProps: ROUTE_CLEAR_PROPS });
      activeIncomingEl = null;
    }
    if (activeRouteMainEl) {
      activeRouteMainEl.style.overflowY = '';
      activeRouteMainEl = null;
    }
  }

  function resolveRouteMode(fromRoute, toRoute, trigger) {
    // 1. Pressing song title / cover on the bottom player bar -> Now Playing: Normal fade-in
    if (trigger === 'player-title' || toRoute === 'now-playing') {
      return { type: 'fade' };
    }

    // 2. Completing welcome/login -> main app: shell entrance
    if (fromRoute === 'welcome' && toRoute !== 'welcome') {
      return { type: 'shell-enter' };
    }

    // 3. Directional vertical scroll stack (search -> home -> artists -> albums -> songs -> files)
    const stack = ANIM_CONFIG.routeTransitions.verticalStack || [];
    const parentMap = ANIM_CONFIG.routeTransitions.stackParentMap || {};
    const toDirectIdx = stack.indexOf(toRoute);
    const fromDirectIdx = stack.indexOf(fromRoute);
    const fromEffectiveIdx =
      fromDirectIdx !== -1
        ? fromDirectIdx
        : parentMap[fromRoute]
          ? stack.indexOf(parentMap[fromRoute])
          : -1;

    if (toDirectIdx !== -1 && fromEffectiveIdx !== -1 && toDirectIdx !== fromEffectiveIdx) {
      // toDirectIdx < fromEffectiveIdx -> destination is ABOVE current -> Scroll UP
      // toDirectIdx > fromEffectiveIdx -> destination is BELOW current -> Scroll DOWN
      return {
        type: 'vertical-scroll',
        direction: toDirectIdx < fromEffectiveIdx ? 'up' : 'down',
      };
    }

    // 4. Everything else (playlists, playlist-detail, favourites, artist-detail, album-detail) -> 2A
    return { type: 'portfolio-glide' };
  }

  function collectStaggerChildren(viewEl) {
    if (!viewEl || viewEl.id === 'view-files') return [];
    const cfg = ANIM_CONFIG.routeTransitions.portfolioGlide;
    if (!cfg.staggerCards) return [];
    const candidates = viewEl.querySelectorAll(
      '.radius-card, .studio-panel, .mfy-card, .smart-playlist-card, .song-row'
    );
    const list = [];
    for (const el of candidates) {
      if (list.length >= cfg.staggerMaxItems) break;
      if (el.offsetParent !== null) list.push(el);
    }
    return list;
  }

  function transitionRoute({
    fromRoute,
    toRoute,
    fromEl,
    toEl,
    mainEl,
    allViewEls,
    trigger,
    preserveScroll,
    immediate,
    animateSameRoute,
  }) {
    cleanupActiveRouteTransition();

    const showOnlyTarget = () => {
      for (const el of allViewEls || []) {
        if (!el) continue;
        el.classList.toggle('hidden', el !== toEl);
      }
      if (mainEl && !preserveScroll) mainEl.scrollTop = 0;
    };

    // Instant swap on first bootstrap, disabled motion, or missing elements
    if (immediate || isMotionDisabled() || !toEl) {
      showOnlyTarget();
      return;
    }

    // Same route clicked again (unless explicitly asked to animate e.g. switching playlist A -> B)
    if (fromEl === toEl && !animateSameRoute) {
      showOnlyTarget();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const mode = resolveRouteMode(fromRoute, toRoute, trigger);

    // Hide any stray views other than fromEl and toEl
    for (const el of allViewEls || []) {
      if (!el || el === toEl || el === fromEl) continue;
      el.classList.add('hidden');
    }

    // Leaving welcome -> entering app shell
    if (mode.type === 'shell-enter') {
      showOnlyTarget();
      playShellEntrance();
      return;
    }

    const prevScrollTop = mainEl ? mainEl.scrollTop : 0;
    const hasDistinctOutgoing = Boolean(fromEl && fromEl !== toEl && !fromEl.classList.contains('hidden'));

    // Pin outgoing view visually in place before resetting mainEl.scrollTop so there is ZERO jump
    if (hasDistinctOutgoing) {
      gsap.set(fromEl, {
        position: 'absolute',
        top: -prevScrollTop,
        left: 0,
        right: 0,
        width: '100%',
        zIndex: 1,
        pointerEvents: 'none',
      });
    }

    toEl.classList.remove('hidden');
    if (mainEl && !preserveScroll) mainEl.scrollTop = 0;

    gsap.set(toEl, {
      position: 'relative',
      zIndex: 2,
    });

    if (mainEl && hasDistinctOutgoing) {
      mainEl.style.overflowY = 'hidden';
      activeRouteMainEl = mainEl;
    }

    activeOutgoingEl = hasDistinctOutgoing ? fromEl : null;
    activeIncomingEl = toEl;

    const tl = gsap.timeline({
      onComplete: () => {
        if (hasDistinctOutgoing && fromEl) {
          fromEl.classList.add('hidden');
          gsap.set(fromEl, { clearProps: ROUTE_CLEAR_PROPS });
        }
        gsap.set(toEl, { clearProps: ROUTE_CLEAR_PROPS });
        if (mainEl) mainEl.style.overflowY = '';
        activeRouteTimeline = null;
        activeOutgoingEl = null;
        activeIncomingEl = null;
        activeRouteMainEl = null;
      },
    });
    activeRouteTimeline = tl;

    // ------------------------------------------------------------------
    // MODE A: Normal Fade-In (Player bar song title / cover -> Now Playing)
    // ------------------------------------------------------------------
    if (mode.type === 'fade') {
      const cfg = ANIM_CONFIG.routeTransitions.playerTitleFade;
      const ease = resolveEase(cfg.ease, 'power1.out');
      if (hasDistinctOutgoing) {
        tl.to(fromEl, { opacity: 0, duration: cfg.outDuration, ease }, 0);
      }
      tl.fromTo(
        toEl,
        { opacity: 0 },
        { opacity: 1, duration: cfg.inDuration, ease },
        0
      );
      return;
    }

    // ------------------------------------------------------------------
    // MODE B: Directional Vertical Scroll (search -> home -> artists -> albums -> songs -> files)
    //   Scroll UP   (e.g. albums -> artists, files -> home):
    //     outgoing slides DOWN (+dist), incoming slides DOWN from TOP (-dist -> 0)
    //   Scroll DOWN (e.g. home -> songs, search -> files):
    //     outgoing slides UP (-dist),   incoming slides UP from BOTTOM (+dist -> 0)
    // ------------------------------------------------------------------
    if (mode.type === 'vertical-scroll') {
      const cfg = ANIM_CONFIG.routeTransitions.verticalScroll;
      const dist = cfg.distance;
      const outY = mode.direction === 'up' ? dist : -dist;
      const inStartY = mode.direction === 'up' ? -dist : dist;
      const outEase = resolveEase(cfg.outEase, 'power3.out');
      const inEase = resolveEase(cfg.inEase, 'power3.out');

      if (hasDistinctOutgoing) {
        tl.to(
          fromEl,
          {
            y: outY,
            opacity: 0,
            duration: cfg.outDuration,
            ease: outEase,
          },
          0
        );
      }

      tl.fromTo(
        toEl,
        { y: inStartY, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: cfg.inDuration,
          ease: inEase,
        },
        0
      );
      return;
    }

    // ------------------------------------------------------------------
    // MODE C: 2A Snappy Portfolio Glide (Playlists, Favourites, Detail routes)
    // ------------------------------------------------------------------
    const cfg = ANIM_CONFIG.routeTransitions.portfolioGlide;
    const outEase = resolveEase(cfg.outEase, 'power1.in');
    const inEase = resolveEase(cfg.inEase, 'power3.out');

    if (hasDistinctOutgoing) {
      tl.to(
        fromEl,
        {
          opacity: 0,
          scale: cfg.outScale,
          duration: cfg.outDuration,
          ease: outEase,
        },
        0
      );
    }

    const enterAt = hasDistinctOutgoing ? Math.max(0, cfg.outDuration * 0.45) : 0;
    tl.fromTo(
      toEl,
      { opacity: 0, y: cfg.inY },
      {
        opacity: 1,
        y: 0,
        duration: cfg.inDuration,
        ease: inEase,
      },
      enterAt
    );

    const staggerEls = collectStaggerChildren(toEl);
    if (staggerEls.length > 0) {
      tl.fromTo(
        staggerEls,
        { opacity: 0, y: cfg.staggerY },
        {
          opacity: 1,
          y: 0,
          duration: cfg.staggerDuration,
          stagger: cfg.staggerAmount,
          ease: inEase,
          clearProps: 'transform,opacity',
        },
        enterAt + 0.04
      );
    }
  }

  // ==========================================================================
  // 5. FULLSCREEN LISTENING ROOM (#signature-modal) — outSmooth Zoom-In + Fade-In
  // ==========================================================================
  function openSignatureModal(modalEl) {
    if (!modalEl) return;
    if (sigTimeline) {
      sigTimeline.kill();
      sigTimeline = null;
    }

    modalEl.classList.remove('hidden');

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(modalEl, { clearProps: 'transform,opacity' });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.fullscreenRoom;
    const ease = resolveEase(cfg.inEase, 'power3.out');

    gsap.killTweensOf(modalEl);
    sigTimeline = gsap.fromTo(
      modalEl,
      {
        opacity: 0,
        scale: cfg.inScale,
        transformOrigin: '50% 50%',
      },
      {
        opacity: 1,
        scale: 1,
        duration: cfg.inDuration,
        ease,
        clearProps: 'transform,opacity',
        onComplete: () => {
          sigTimeline = null;
        },
      }
    );
  }

  function closeSignatureModal(modalEl, onDone) {
    if (!modalEl) {
      onDone?.();
      return;
    }
    if (sigTimeline) {
      sigTimeline.kill();
      sigTimeline = null;
    }

    if (isMotionDisabled() || modalEl.classList.contains('hidden')) {
      modalEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(modalEl, { clearProps: 'transform,opacity' });
      onDone?.();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.fullscreenRoom;
    const ease = resolveEase(cfg.outEase, 'power2.in');

    gsap.killTweensOf(modalEl);
    sigTimeline = gsap.to(modalEl, {
      opacity: 0,
      scale: cfg.outScale,
      transformOrigin: '50% 50%',
      duration: cfg.outDuration,
      ease,
      onComplete: () => {
        modalEl.classList.add('hidden');
        gsap.set(modalEl, { clearProps: 'transform,opacity' });
        sigTimeline = null;
        onDone?.();
      },
    });
  }

  // ==========================================================================
  // 6. DRAWERS (#queue-drawer, #lyrics-drawer, mobile sidebar) + BLUR BACKDROP
  // ==========================================================================
  function showDrawerBackdrop(visible) {
    const backdrop = $('drawer-backdrop');
    if (!backdrop) return;

    if (isMotionDisabled()) {
      backdrop.classList.toggle('hidden', !visible);
      return;
    }

    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(backdrop);

    if (visible) {
      backdrop.classList.remove('hidden');
      gsap.fromTo(
        backdrop,
        { opacity: 0 },
        { opacity: 1, duration: cfg.backdropDuration, ease: 'power2.out' }
      );
    } else if (!backdrop.classList.contains('hidden')) {
      gsap.to(backdrop, {
        opacity: 0,
        duration: cfg.backdropDuration * 0.85,
        ease: 'power2.in',
        onComplete: () => {
          backdrop.classList.add('hidden');
          gsap.set(backdrop, { clearProps: 'opacity' });
        },
      });
    }
  }

  function openDrawer(drawerEl) {
    if (!drawerEl) return;
    const prev = activeDrawerTweens.get(drawerEl);
    if (prev) prev.kill();

    drawerEl.classList.remove('hidden');
    showDrawerBackdrop(true);

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(drawerEl, { clearProps: 'transform,opacity' });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(drawerEl);

    const tw = gsap.fromTo(
      drawerEl,
      { xPercent: 100, x: 0, opacity: 0.72 },
      {
        xPercent: 0,
        x: 0,
        opacity: 1,
        duration: cfg.inDuration,
        ease: resolveEase(cfg.inEase, 'power3.out'),
        clearProps: 'transform,opacity',
        onComplete: () => activeDrawerTweens.delete(drawerEl),
      }
    );
    activeDrawerTweens.set(drawerEl, tw);
  }

  function closeDrawer(drawerEl, options = {}) {
    if (!drawerEl) return;
    const prev = activeDrawerTweens.get(drawerEl);
    if (prev) prev.kill();

    if (!options.keepBackdrop) {
      showDrawerBackdrop(false);
    }

    if (isMotionDisabled() || drawerEl.classList.contains('hidden')) {
      drawerEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(drawerEl, { clearProps: 'transform,opacity' });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(drawerEl);

    const tw = gsap.to(drawerEl, {
      xPercent: 100,
      opacity: 0.65,
      duration: cfg.outDuration,
      ease: resolveEase(cfg.outEase, 'power2.in'),
      onComplete: () => {
        drawerEl.classList.add('hidden');
        gsap.set(drawerEl, { clearProps: 'transform,opacity' });
        activeDrawerTweens.delete(drawerEl);
      },
    });
    activeDrawerTweens.set(drawerEl, tw);
  }

  function snapBackDrawer(drawerEl) {
    if (!drawerEl) return;
    if (isMotionDisabled()) {
      drawerEl.style.transform = '';
      return;
    }
    registerCustomEases();
    window.gsap.to(drawerEl, {
      x: 0,
      duration: ANIM_CONFIG.drawers.snapBackDuration,
      ease: resolveEase('outSmooth', 'power3.out'),
      clearProps: 'transform',
    });
  }

  function setMobileSidebar(sidebarEl, backdropEl, open) {
    if (!sidebarEl) return;
    if (isDesktop()) {
      sidebarEl.classList.remove('-translate-x-full');
      sidebarEl.classList.add('translate-x-0');
      backdropEl?.classList.add('hidden');
      return;
    }

    if (isMotionDisabled()) {
      sidebarEl.classList.toggle('-translate-x-full', !open);
      sidebarEl.classList.toggle('translate-x-0', open);
      backdropEl?.classList.toggle('hidden', !open);
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(sidebarEl);
    if (backdropEl) gsap.killTweensOf(backdropEl);

    if (open) {
      sidebarEl.classList.remove('-translate-x-full');
      sidebarEl.classList.add('translate-x-0');
      gsap.fromTo(
        sidebarEl,
        { xPercent: -100 },
        {
          xPercent: 0,
          duration: cfg.inDuration,
          ease: resolveEase(cfg.inEase, 'power3.out'),
          clearProps: 'transform',
        }
      );
      if (backdropEl) {
        backdropEl.classList.remove('hidden');
        gsap.fromTo(backdropEl, { opacity: 0 }, { opacity: 1, duration: cfg.backdropDuration });
      }
    } else {
      gsap.to(sidebarEl, {
        xPercent: -100,
        duration: cfg.outDuration,
        ease: resolveEase(cfg.outEase, 'power2.in'),
        onComplete: () => {
          sidebarEl.classList.add('-translate-x-full');
          sidebarEl.classList.remove('translate-x-0');
          gsap.set(sidebarEl, { clearProps: 'transform' });
        },
      });
      if (backdropEl && !backdropEl.classList.contains('hidden')) {
        gsap.to(backdropEl, {
          opacity: 0,
          duration: cfg.outDuration,
          onComplete: () => {
            backdropEl.classList.add('hidden');
            gsap.set(backdropEl, { clearProps: 'opacity' });
          },
        });
      }
    }
  }

  // ==========================================================================
  // 7. MODALS (Portfolio Backdrop Fade + Vertical Rise)
  //    Strictly excludes #files-metadata-modal & #ytm-folder-picker-modal.
  // ==========================================================================
  function isOverlayOpen(el) {
    return Boolean(el && !el.classList.contains('hidden') && el.dataset.gsapClosing !== 'true');
  }

  function openModal(modalEl) {
    if (!modalEl) return;
    delete modalEl.dataset.gsapClosing;
    if (PROTECTED_MODAL_IDS.has(modalEl.id)) {
      modalEl.classList.remove('hidden');
      return;
    }

    const prev = activeModalTweens.get(modalEl);
    if (prev) prev.kill();

    modalEl.classList.remove('hidden');
    modalEl.style.pointerEvents = '';
    const panel = modalEl.firstElementChild;

    if (isMotionDisabled()) {
      if (hasGsap()) {
        window.gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) window.gsap.set(panel, { clearProps: 'transform,opacity' });
      }
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.modals;
    gsap.killTweensOf(modalEl);
    if (panel) gsap.killTweensOf(panel);

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) gsap.set(panel, { clearProps: 'transform,opacity' });
        activeModalTweens.delete(modalEl);
      },
    });
    activeModalTweens.set(modalEl, tl);

    tl.fromTo(
      modalEl,
      { opacity: 0 },
      { opacity: 1, duration: cfg.backdropDuration, ease: 'power2.out' },
      0
    );

    if (panel) {
      tl.fromTo(
        panel,
        { opacity: 0, y: cfg.panelInY, scale: cfg.panelInScale },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: cfg.panelInDuration,
          ease: resolveEase(cfg.panelInEase, 'power3.out'),
        },
        0
      );
    }
  }

  function closeModal(modalEl, onDone) {
    if (!modalEl) {
      onDone?.();
      return;
    }
    if (PROTECTED_MODAL_IDS.has(modalEl.id)) {
      delete modalEl.dataset.gsapClosing;
      modalEl.classList.add('hidden');
      onDone?.();
      return;
    }

    const prev = activeModalTweens.get(modalEl);
    if (prev) prev.kill();

    const panel = modalEl.firstElementChild;

    if (isMotionDisabled() || modalEl.classList.contains('hidden')) {
      delete modalEl.dataset.gsapClosing;
      modalEl.classList.add('hidden');
      if (hasGsap()) {
        window.gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) window.gsap.set(panel, { clearProps: 'transform,opacity' });
      }
      onDone?.();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.modals;
    gsap.killTweensOf(modalEl);
    if (panel) gsap.killTweensOf(panel);

    modalEl.dataset.gsapClosing = 'true';
    modalEl.style.pointerEvents = 'none';

    const tl = gsap.timeline({
      onComplete: () => {
        delete modalEl.dataset.gsapClosing;
        modalEl.classList.add('hidden');
        gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) gsap.set(panel, { clearProps: 'transform,opacity' });
        activeModalTweens.delete(modalEl);
        onDone?.();
      },
    });
    activeModalTweens.set(modalEl, tl);

    if (panel) {
      tl.to(
        panel,
        {
          opacity: 0,
          y: cfg.panelOutY,
          scale: cfg.panelOutScale,
          duration: cfg.panelOutDuration,
          ease: resolveEase(cfg.panelOutEase, 'power2.in'),
        },
        0
      );
    }
    tl.to(
      modalEl,
      {
        opacity: 0,
        duration: cfg.panelOutDuration + 0.04,
        ease: 'power2.in',
      },
      0
    );
  }

  // ==========================================================================
  // 8. CONTEXT MENU & TOAST NOTIFICATION (.overlay-comingSoon inOut style)
  // ==========================================================================
  function openContextMenu(menuEl) {
    if (!menuEl) return;
    delete menuEl.dataset.gsapClosing;
    menuEl.style.pointerEvents = '';
    if (contextMenuTween) {
      contextMenuTween.kill();
      contextMenuTween = null;
    }
    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents' });
      return;
    }

    registerCustomEases();
    const cfg = ANIM_CONFIG.contextMenu;
    contextMenuTween = window.gsap.fromTo(
      menuEl,
      { opacity: 0, y: cfg.inY, scale: cfg.inScale, transformOrigin: 'top left' },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: cfg.inDuration,
        ease: resolveEase(cfg.inEase, 'power3.out'),
        clearProps: 'transform,opacity,pointerEvents',
        onComplete: () => {
          contextMenuTween = null;
        },
      }
    );
  }

  function closeContextMenu(menuEl) {
    if (!menuEl) return;
    if (contextMenuTween) {
      contextMenuTween.kill();
      contextMenuTween = null;
    }
    if (isMotionDisabled() || menuEl.classList.contains('hidden')) {
      delete menuEl.dataset.gsapClosing;
      menuEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents' });
      return;
    }

    menuEl.dataset.gsapClosing = 'true';
    menuEl.style.pointerEvents = 'none';

    const cfg = ANIM_CONFIG.contextMenu;
    contextMenuTween = window.gsap.to(menuEl, {
      opacity: 0,
      scale: 0.97,
      duration: cfg.outDuration,
      ease: 'power2.in',
      onComplete: () => {
        delete menuEl.dataset.gsapClosing;
        menuEl.classList.add('hidden');
        window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents' });
        contextMenuTween = null;
      },
    });
  }

  let fallbackToastTimer = null;
  function showToast(el, message) {
    if (!el) return;
    el.textContent = message;

    if (toastTimeline) {
      toastTimeline.kill();
      toastTimeline = null;
    }
    if (fallbackToastTimer) {
      clearTimeout(fallbackToastTimer);
      fallbackToastTimer = null;
    }

    el.classList.remove('hidden');

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(el, { clearProps: 'transform,opacity' });
      fallbackToastTimer = setTimeout(() => {
        el.classList.add('hidden');
        fallbackToastTimer = null;
      }, Math.round((ANIM_CONFIG.toast.holdDuration + 0.5) * 1000));
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.toast;
    const ease = resolveEase(cfg.ease, 'power3.inOut');

    gsap.killTweensOf(el);
    toastTimeline = gsap
      .timeline({
        onComplete: () => {
          el.classList.add('hidden');
          gsap.set(el, { clearProps: 'transform,opacity' });
          toastTimeline = null;
        },
      })
      .fromTo(
        el,
        { opacity: 0, y: cfg.yOffset },
        { opacity: 1, y: 0, duration: cfg.inDuration, ease }
      )
      .to({}, { duration: cfg.holdDuration })
      .to(el, {
        opacity: 0,
        y: cfg.yOffset * 0.65,
        duration: cfg.outDuration,
        ease,
      });
  }

  // ==========================================================================
  // 9. SIDEBAR WIDTH COLLAPSE / EXPAND (GSAP outSmooth)
  // ==========================================================================
  function animateSidebarWidth(sidebarEl, collapsed) {
    if (!sidebarEl) return;

    if (isMotionDisabled() || !isDesktop()) {
      sidebarEl.classList.toggle('sidebar-collapsed', collapsed);
      if (hasGsap()) window.gsap.set(sidebarEl, { clearProps: 'width' });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.sidebarCollapse;
    const startW = sidebarEl.getBoundingClientRect().width || (collapsed ? cfg.expandedWidth : cfg.collapsedWidth);
    const targetW = collapsed ? cfg.collapsedWidth : cfg.expandedWidth;

    gsap.killTweensOf(sidebarEl, 'width');
    sidebarEl.classList.toggle('sidebar-collapsed', collapsed);

    gsap.fromTo(
      sidebarEl,
      { width: startW },
      {
        width: targetW,
        duration: cfg.duration,
        ease: resolveEase(cfg.ease, 'power3.out'),
        clearProps: 'width',
      }
    );
  }

  // ==========================================================================
  // 10. PARABOLIC COVER FLY (Migrated from WAAPI to GSAP)
  // ==========================================================================
  function coverFly(sourceEl, targetSelector = '#player-cover-btn') {
    if (!sourceEl || isMotionDisabled()) return;
    const layer = $('cover-fly-layer');
    const targetEl = document.querySelector(targetSelector);
    if (!layer || !targetEl) return;

    const sRect = sourceEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    if (sRect.width <= 0 || tRect.width <= 0) return;

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.coverFly;

    const ghost = document.createElement('div');
    const img = sourceEl.tagName === 'IMG' ? sourceEl : sourceEl.querySelector('img:not(.hidden)');
    ghost.style.position = 'fixed';
    ghost.style.left = `${sRect.left}px`;
    ghost.style.top = `${sRect.top}px`;
    ghost.style.width = `${sRect.width}px`;
    ghost.style.height = `${sRect.height}px`;
    ghost.style.borderRadius = 'var(--radius-inner)';
    ghost.style.overflow = 'hidden';
    ghost.style.boxShadow = '0 10px 30px rgba(0,0,0,0.55)';
    ghost.style.border = '1px solid var(--primary)';
    ghost.style.background = 'var(--card)';
    ghost.style.pointerEvents = 'none';
    if (img?.src) {
      ghost.style.backgroundImage = `url("${img.src}")`;
      ghost.style.backgroundSize = 'cover';
      ghost.style.backgroundPosition = 'center';
    }
    layer.appendChild(ghost);

    const dx = tRect.left + tRect.width / 2 - (sRect.left + sRect.width / 2);
    const dy = tRect.top + tRect.height / 2 - (sRect.top + sRect.height / 2);
    const lift = Math.min(cfg.arcLiftMax, Math.max(cfg.arcLiftMin, Math.abs(dx) * 0.18));
    const midX = dx * 0.52;
    const midY = dy * 0.5 - lift;

    const ease = resolveEase(cfg.ease, 'power3.out');
    const half = cfg.duration * 0.52;
    const rest = cfg.duration - half;

    gsap
      .timeline({
        onComplete: () => ghost.remove(),
      })
      .set(ghost, { x: 0, y: 0, scale: 1, opacity: 0.95 })
      .to(ghost, {
        x: midX,
        y: midY,
        scale: 0.72,
        opacity: 0.9,
        duration: half,
        ease: 'power2.out',
      })
      .to(ghost, {
        x: dx,
        y: dy,
        scale: 0.32,
        opacity: 0.12,
        duration: rest,
        ease,
      });
  }

  // ==========================================================================
  // 11. COVER ART CROSSFADE (changeImageWithFade style for Now Playing & Room)
  // ==========================================================================
  function clearCoverGhost(imgEl) {
    const parent = imgEl?.parentElement;
    if (!parent) return;
    parent.querySelectorAll('.gsap-cover-ghost').forEach((g) => {
      if (hasGsap()) window.gsap.killTweensOf(g);
      g.remove();
    });
  }

  function prepareCoverCrossfade(imgEl) {
    if (!imgEl || isMotionDisabled()) return;
    const parent = imgEl.parentElement;
    if (!parent) return;
    clearCoverGhost(imgEl);

    const currentUrl = imgEl.currentSrc || imgEl.getAttribute('src');
    if (!currentUrl || imgEl.classList.contains('hidden')) return;

    const ghost = document.createElement('img');
    ghost.src = currentUrl;
    ghost.alt = '';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.className = 'gsap-cover-ghost absolute inset-0 w-full h-full object-cover pointer-events-none z-10';
    parent.appendChild(ghost);

    // Safety cleanup in case the incoming track has no artwork and never calls finishCoverCrossfade
    const timer = setTimeout(() => {
      if (!ghost.isConnected) return;
      window.gsap.to(ghost, {
        opacity: 0,
        duration: ANIM_CONFIG.coverCrossfade.fadeOutDuration,
        ease: 'power2.out',
        onComplete: () => ghost.remove(),
      });
    }, 650);
    ghost.dataset.cleanupTimer = String(timer);
  }

  function finishCoverCrossfade(imgEl) {
    if (!imgEl) return;
    const parent = imgEl.parentElement;

    if (isMotionDisabled()) {
      clearCoverGhost(imgEl);
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.coverCrossfade;
    const ease = resolveEase(cfg.ease, 'power3.out');

    gsap.killTweensOf(imgEl);
    gsap.fromTo(
      imgEl,
      { opacity: 0, scale: cfg.inScale },
      {
        opacity: 1,
        scale: 1,
        duration: cfg.fadeInDuration,
        ease,
        clearProps: 'transform,opacity',
      }
    );

    if (parent) {
      parent.querySelectorAll('.gsap-cover-ghost').forEach((ghost) => {
        if (ghost.dataset.cleanupTimer) clearTimeout(Number(ghost.dataset.cleanupTimer));
        gsap.killTweensOf(ghost);
        gsap.to(ghost, {
          opacity: 0,
          duration: cfg.fadeOutDuration,
          ease: 'power2.out',
          onComplete: () => ghost.remove(),
        });
      });
    }
  }

  // ==========================================================================
  // 12. WELCOME WALKTHROUGH STEP TRANSITIONS
  // ==========================================================================
  function animateWelcomeStep(panelEl, direction = 1) {
    if (!panelEl || isMotionDisabled()) return;
    registerCustomEases();
    const cfg = ANIM_CONFIG.welcomeStep;
    const startX = direction >= 0 ? cfg.xOffset : -cfg.xOffset;

    window.gsap.killTweensOf(panelEl);
    window.gsap.fromTo(
      panelEl,
      { opacity: 0, x: startX },
      {
        opacity: 1,
        x: 0,
        duration: cfg.duration,
        ease: resolveEase(cfg.ease, 'power3.out'),
        clearProps: 'transform,opacity',
      }
    );
  }

  function animateWelcomeProgress(fillEl, ratio) {
    if (!fillEl) return;
    const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
    if (isMotionDisabled()) {
      fillEl.style.transform = `scaleX(${clamped})`;
      return;
    }
    registerCustomEases();
    window.gsap.to(fillEl, {
      scaleX: clamped,
      duration: ANIM_CONFIG.welcomeStep.progressDuration,
      ease: resolveEase('outSmooth', 'power3.out'),
    });
  }

  // ==========================================================================
  // 13. SUBTLE BUTTON PRESS MICRO-INTERACTION (Delegated, Protected-Zone Safe)
  // ==========================================================================
  let pressBound = false;
  function bindButtonPressFeedback() {
    if (pressBound) return;
    pressBound = true;

    const getPressTarget = (target) => {
      if (!ANIM_CONFIG.buttonPress.enabled || isMotionDisabled()) return null;
      const btn = target?.closest?.('button:not(:disabled)');
      if (!btn) return null;
      if (btn.closest(PROTECTED_PRESS_SELECTOR)) return null;
      if (btn.classList.contains('song-row') || btn.classList.contains('queue-row')) return null;
      return btn;
    };

    let pressedBtn = null;

    const releaseBtn = () => {
      if (!pressedBtn) return;
      const el = pressedBtn;
      pressedBtn = null;
      if (!hasGsap()) return;
      registerCustomEases();
      window.gsap.to(el, {
        scale: 1,
        duration: ANIM_CONFIG.buttonPress.upDuration,
        ease: resolveEase(ANIM_CONFIG.buttonPress.upEase, 'power3.out'),
        clearProps: 'transform',
      });
    };

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        const btn = getPressTarget(e.target);
        if (!btn) return;
        pressedBtn = btn;
        window.gsap.to(btn, {
          scale: ANIM_CONFIG.buttonPress.pressScale,
          duration: ANIM_CONFIG.buttonPress.downDuration,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      },
      { passive: true }
    );

    window.addEventListener('pointerup', releaseBtn, { passive: true });
    window.addEventListener('pointercancel', releaseBtn, { passive: true });
  }

  // Auto-bind micro-interactions when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtonPressFeedback);
  } else {
    bindButtonPressFeedback();
  }

  // ==========================================================================
  // 14. PUBLIC API (window.PlenripAnimations)
  // ==========================================================================
  window.PlenripAnimations = {
    config: ANIM_CONFIG,
    isMotionDisabled,
    isOverlayOpen,
    hideIntroImmediately,
    playLoggedOutIntro,
    playLoggedInReveal,
    playShellEntrance,
    transitionRoute,
    resolveRouteMode,
    openSignatureModal,
    closeSignatureModal,
    openDrawer,
    closeDrawer,
    snapBackDrawer,
    setMobileSidebar,
    openModal,
    closeModal,
    openContextMenu,
    closeContextMenu,
    showToast,
    animateSidebarWidth,
    coverFly,
    prepareCoverCrossfade,
    finishCoverCrossfade,
    clearCoverGhost,
    animateWelcomeStep,
    animateWelcomeProgress,
  };
})();
