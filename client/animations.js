/* ============================================================================
 * Plenrip Audio — Centralized GSAP Animation Controller (GSAP 3.15.1)
 *
 * Inspired by PlanRift.github.io (CustomEase "inOut" & "outSmooth").
 * Edit the ANIM_CONFIG object below to customize timings, eases, distances,
 * intro text, or toggle individual animations on/off.
 *
 * Performance Architecture:
 * - Strict gsap.context() lifecycle per route & transition (reverted on exit)
 * - 100% GPU-composited transforms (x, y, scale, opacity) + force3D: true
 * - Zero layout-triggering GSAP properties (no width/height/top/left/overflow)
 * - Deferred ScrollTrigger.refresh() via rAF after incoming DOM settles
 * - gsap.quickTo() for high-frequency pointer/drag/scroll interactions
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
        distance: 96,          // Vertical GPU travel distance in pixels
        outDuration: 0.16,     // Snappy GPU exit before single-write DOM swap
        inDuration: 0.52,
        outEase: 'power2.in',
        inEase: 'outSmooth',
      },

      // 2A: Snappy Portfolio Glide (Playlists, Playlist Detail, Favourites, Artist/Album Detail)
      portfolioGlide: {
        outDuration: 0.16,
        outScale: 0.97,
        outEase: 'power1.in',
        inDuration: 0.5,
        inY: 24,
        inEase: 'outSmooth',
        staggerCards: true,
        staggerAmount: 0.022,
        staggerMaxItems: 12,
        staggerY: 14,
        staggerDuration: 0.38,
      },

      // Normal clean fade-in when clicking the song title/cover on the bottom player bar -> Now Playing
      playerTitleFade: {
        outDuration: 0.14,
        inDuration: 0.34,
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

    // Sidebar collapse/expand (GPU-only transform settle, zero width-reflow tweening)
    sidebarCollapse: {
      duration: 0.3,
      shiftX: 10,
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
  // 2. PROTECTED ZONES, GSAP CONFIG & LIFECYCLE STATE
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

  const GPU_CLEAR_PROPS = 'transform,opacity,willChange';

  let easesRegistered = false;
  let introStarted = false;
  let introContext = null;

  // Strict per-route & per-transition gsap.context() handles
  let activeRouteContext = null;
  let activeTransitionContext = null;
  let activeOutgoingEl = null;
  let activeIncomingEl = null;
  let pendingRefreshRafId = null;

  // Tracked overlay & utility handles (prevent orphaned tickers)
  let toastContext = null;
  let sigContext = null;
  let contextMenuContext = null;
  let sidebarContext = null;
  let welcomeStepContext = null;
  const activeModalContexts = new WeakMap();
  const activeDrawerContexts = new WeakMap();
  const activeCoverFlyTimelines = new Set();
  const activeCoverGhostTimers = new Set();

  function hasGsap() {
    return typeof window.gsap !== 'undefined';
  }

  function registerCustomEases() {
    if (easesRegistered || !hasGsap()) return;
    try {
      window.gsap.config({ force3D: true, nullTargetWarn: false });
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

  function revertContext(ctx) {
    if (ctx && typeof ctx.revert === 'function') {
      try {
        ctx.revert();
      } catch {
        // Ignore already-reverted context errors
      }
    }
    return null;
  }

  // Defer ScrollTrigger.refresh() until after incoming DOM & GPU transitions settle
  function scheduleScrollTriggerRefresh() {
    if (pendingRefreshRafId !== null) {
      cancelAnimationFrame(pendingRefreshRafId);
      pendingRefreshRafId = null;
    }
    if (typeof window.ScrollTrigger?.refresh !== 'function') return;
    pendingRefreshRafId = requestAnimationFrame(() => {
      pendingRefreshRafId = null;
      if (typeof window.ScrollTrigger?.refresh === 'function') {
        window.ScrollTrigger.refresh();
      }
    });
  }

  // Register eases & GPU defaults immediately if GSAP is already loaded
  registerCustomEases();

  // ==========================================================================
  // 3. INTRO OVERLAY HELPERS (1A Logged-Out Intro & 1B Logged-In Shell Reveal)
  // ==========================================================================
  function hideIntroImmediately() {
    introStarted = true;
    introContext = revertContext(introContext);
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
    introContext = revertContext(introContext);

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

    let finished = false;
    const onSkipClick = () => finishAll(true);
    const onSkipKey = (e) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        finishAll(true);
      }
    };

    const finishAll = (skipped = false) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', onSkipKey);
      overlay.removeEventListener('click', onSkipClick);

      if (skipped) {
        introContext = revertContext(introContext);
        gsap.to(overlay, {
          opacity: 0,
          duration: 0.3,
          force3D: true,
          ease: resolveEase('outSmooth'),
          onComplete: () => {
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
            overlay.classList.add('hidden');
            gsap.set(overlay, { clearProps: GPU_CLEAR_PROPS });
          },
        });
        if (revealTargets.length > 0) {
          gsap.fromTo(
            revealTargets,
            { opacity: 0, y: 20 },
            {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.45,
              stagger: 0.06,
              force3D: true,
              ease: resolveEase('outSmooth'),
              clearProps: GPU_CLEAR_PROPS,
            }
          );
        }
      } else {
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none';
        overlay.classList.add('hidden');
        if (revealTargets.length > 0) {
          gsap.set(revealTargets, { clearProps: GPU_CLEAR_PROPS });
        }
        introContext = null;
      }
      options.onComplete?.();
    };

    overlay.addEventListener('click', onSkipClick);
    window.addEventListener('keydown', onSkipKey);

    const inOut = resolveEase('inOut', 'power3.inOut');
    const outSmooth = resolveEase('outSmooth', 'power3.out');

    introContext = gsap.context(() => {
      if (revealTargets.length > 0) {
        gsap.set(revealTargets, {
          opacity: 0,
          y: cfg.welcomeRevealY,
          scale: cfg.welcomeRevealScale,
          force3D: true,
          willChange: 'transform, opacity',
        });
      }

      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => finishAll(false),
      });

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

      tl.to({}, { duration: cfg.holdSeconds });

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
            clearProps: GPU_CLEAR_PROPS,
          },
          `-=${Math.max(0.2, cfg.overlayFadeDuration * 0.72)}`
        );
      }

      return () => {
        window.removeEventListener('keydown', onSkipKey);
        overlay.removeEventListener('click', onSkipClick);
      };
    }, document.body);
  }

  // 1B: Quick Shell Reveal (plays EVERY load when already logged in)
  function playLoggedInReveal(options = {}) {
    introStarted = true;
    introContext = revertContext(introContext);

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

    introContext = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.add('hidden');
            gsap.set(overlay, { clearProps: GPU_CLEAR_PROPS });
          }
          introContext = null;
          scheduleScrollTriggerRefresh();
          options.onComplete?.();
        },
      });

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
            { opacity: 0, y: cfg.mainY, willChange: 'transform, opacity' },
            {
              opacity: 1,
              y: 0,
              duration: cfg.mainDuration,
              stagger: 0.07,
              ease: outSmooth,
              clearProps: GPU_CLEAR_PROPS,
            },
            overlay ? `-=${cfg.overlayFadeDuration * 0.75}` : 0
          );
        }
        return;
      }

      addShellEntranceTweens(tl, overlay ? `-=${cfg.overlayFadeDuration * 0.8}` : 0);
    }, document.body);
  }

  // Smooth shell reveal without black veil (used when finishing login/welcome -> home)
  function playShellEntrance() {
    if (isMotionDisabled()) return;
    registerCustomEases();
    introContext = revertContext(introContext);
    introContext = window.gsap.context(() => {
      const tl = window.gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          introContext = null;
          scheduleScrollTriggerRefresh();
        },
      });
      addShellEntranceTweens(tl, 0);
    }, document.body);
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
        { x: cfg.sidebarX, opacity: 0, willChange: 'transform, opacity' },
        {
          x: 0,
          opacity: 1,
          duration: cfg.sidebarDuration,
          ease: outSmooth,
          clearProps: GPU_CLEAR_PROPS,
        },
        pos
      );
      pos = `-=${Math.max(0.1, cfg.sidebarDuration * 0.78)}`;
    }

    if (activeView) {
      tl.fromTo(
        activeView,
        { y: cfg.mainY, opacity: 0, willChange: 'transform, opacity' },
        {
          y: 0,
          opacity: 1,
          duration: cfg.mainDuration,
          ease: outSmooth,
          clearProps: GPU_CLEAR_PROPS,
        },
        pos
      );
    }

    if (playerBar && !playerBar.classList.contains('hidden')) {
      tl.fromTo(
        playerBar,
        { y: cfg.playerBarY, opacity: 0, willChange: 'transform, opacity' },
        {
          y: 0,
          opacity: 1,
          duration: cfg.playerBarDuration,
          ease: outSmooth,
          clearProps: GPU_CLEAR_PROPS,
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
  // 4. STRICT ROUTE LIFECYCLE & ZERO-REFLOW PAGE TRANSITIONS
  //    - Reverts activeRouteContext & activeTransitionContext on every exit
  //    - Pure GPU transforms (y, scale, opacity, force3D: true)
  //    - ZERO position:absolute / top / width / overflowY / offsetParent thrash
  // ==========================================================================
  function clearAllCoverGhosts() {
    for (const timer of activeCoverGhostTimers) {
      clearTimeout(timer);
    }
    activeCoverGhostTimers.clear();
    document.querySelectorAll('.gsap-cover-ghost').forEach((g) => {
      if (hasGsap()) window.gsap.killTweensOf(g);
      g.remove();
    });
  }

  function killAllCoverFlys() {
    for (const entry of activeCoverFlyTimelines) {
      try {
        entry.tl.kill();
      } catch {
        // Ignore
      }
      entry.ghost?.remove();
    }
    activeCoverFlyTimelines.clear();
  }

  // Explicitly tear down all route-scoped GSAP contexts, tweens, ScrollTriggers & timers
  function cleanupActiveRouteTransition() {
    if (pendingRefreshRafId !== null) {
      cancelAnimationFrame(pendingRefreshRafId);
      pendingRefreshRafId = null;
    }

    // 1. Revert view-scoped gsap.context() (kills all view tweens, ScrollTriggers, SplitText, listeners)
    activeRouteContext = revertContext(activeRouteContext);

    // 2. Revert in-flight route transition gsap.context()
    activeTransitionContext = revertContext(activeTransitionContext);

    // 3. Kill any lingering tweens on previous route elements & clear GPU props
    const leftover = [activeOutgoingEl, activeIncomingEl].filter(Boolean);
    if (leftover.length > 0 && hasGsap()) {
      window.gsap.killTweensOf(leftover);
      window.gsap.set(leftover, { clearProps: GPU_CLEAR_PROPS });
    }
    if (activeOutgoingEl && activeOutgoingEl !== activeIncomingEl) {
      activeOutgoingEl.classList.add('hidden');
    }
    activeOutgoingEl = null;
    activeIncomingEl = null;

    // 4. Clean up transient cover ghosts/fly animations from the departing view
    clearAllCoverGhosts();
    killAllCoverFlys();
  }

  // Register view-specific GSAP animations/ScrollTriggers/listeners scoped to the current route
  function createRouteContext(scopeEl, setupFn) {
    activeRouteContext = revertContext(activeRouteContext);
    if (!hasGsap() || typeof setupFn !== 'function') return null;
    registerCustomEases();
    activeRouteContext = window.gsap.context(setupFn, scopeEl || document.body);
    return activeRouteContext;
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

  // Pure DOM-selector collection — ZERO offsetParent / getBoundingClientRect layout reads!
  function collectStaggerChildren(viewEl) {
    if (!viewEl || viewEl.id === 'view-files') return [];
    const cfg = ANIM_CONFIG.routeTransitions.portfolioGlide;
    if (!cfg.staggerCards) return [];
    const candidates = viewEl.querySelectorAll(
      '.radius-card:not(.hidden), .studio-panel:not(.hidden), .mfy-card:not(.hidden), .smart-playlist-card:not(.hidden), .song-row:not(.hidden)'
    );
    const list = [];
    for (let i = 0; i < candidates.length && list.length < cfg.staggerMaxItems; i++) {
      const el = candidates[i];
      if (!el.closest('.hidden')) list.push(el);
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
    // Always revert outgoing route context & kill lingering tweens FIRST
    cleanupActiveRouteTransition();

    const swapDomToTarget = () => {
      for (const el of allViewEls || []) {
        if (!el) continue;
        el.classList.toggle('hidden', el !== toEl);
      }
      if (mainEl && !preserveScroll) mainEl.scrollTop = 0;
    };

    // Instant swap on first bootstrap, disabled motion, or missing elements
    if (immediate || isMotionDisabled() || !toEl) {
      swapDomToTarget();
      scheduleScrollTriggerRefresh();
      return;
    }

    // Same route clicked again (unless explicitly asked to animate e.g. switching playlist A -> B)
    if (fromEl === toEl && !animateSameRoute) {
      swapDomToTarget();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const mode = resolveRouteMode(fromRoute, toRoute, trigger);

    // Leaving welcome -> entering app shell
    if (mode.type === 'shell-enter') {
      swapDomToTarget();
      playShellEntrance();
      return;
    }

    const hasDistinctOutgoing = Boolean(fromEl && fromEl !== toEl && !fromEl.classList.contains('hidden'));
    activeOutgoingEl = hasDistinctOutgoing ? fromEl : null;
    activeIncomingEl = toEl;

    // Ensure no stray 3rd view is visible
    for (const el of allViewEls || []) {
      if (!el || el === toEl || el === fromEl) continue;
      el.classList.add('hidden');
    }

    // Build entire exit -> single-write swap -> GPU entrance inside one revertable gsap.context()
    activeTransitionContext = gsap.context(() => {
      const playIncoming = () => {
        // Single batched DOM write phase (zero interleaved reads, zero position/width/overflow thrash)
        if (hasDistinctOutgoing && fromEl) {
          fromEl.classList.add('hidden');
          gsap.set(fromEl, { clearProps: GPU_CLEAR_PROPS });
        }
        toEl.classList.remove('hidden');
        if (mainEl && !preserveScroll) mainEl.scrollTop = 0;

        const finishIncoming = () => {
          gsap.set(toEl, { clearProps: GPU_CLEAR_PROPS });
          activeOutgoingEl = null;
          activeIncomingEl = null;
          activeTransitionContext = null;
          // Defer ScrollTrigger.refresh() to rAF after incoming DOM has settled
          scheduleScrollTriggerRefresh();
        };

        // ----------------------------------------------------------------
        // MODE A: Normal Fade-In (Player bar song title / cover -> Now Playing)
        // ----------------------------------------------------------------
        if (mode.type === 'fade') {
          const cfg = ANIM_CONFIG.routeTransitions.playerTitleFade;
          gsap.fromTo(
            toEl,
            { opacity: 0, willChange: 'opacity' },
            {
              opacity: 1,
              duration: cfg.inDuration,
              ease: resolveEase(cfg.ease, 'power1.out'),
              force3D: true,
              onComplete: finishIncoming,
            }
          );
          return;
        }

        // ----------------------------------------------------------------
        // MODE B: Directional Vertical Scroll (search -> home -> artists -> albums -> songs -> files)
        //   Scroll UP   (e.g. albums -> artists, files -> home):
        //     incoming glides DOWN from TOP (-dist -> 0)
        //   Scroll DOWN (e.g. home -> songs, search -> files):
        //     incoming glides UP from BOTTOM (+dist -> 0)
        // ----------------------------------------------------------------
        if (mode.type === 'vertical-scroll') {
          const cfg = ANIM_CONFIG.routeTransitions.verticalScroll;
          const inStartY = mode.direction === 'up' ? -cfg.distance : cfg.distance;
          gsap.fromTo(
            toEl,
            { y: inStartY, opacity: 0, willChange: 'transform, opacity' },
            {
              y: 0,
              opacity: 1,
              duration: cfg.inDuration,
              ease: resolveEase(cfg.inEase, 'power3.out'),
              force3D: true,
              onComplete: finishIncoming,
            }
          );
          return;
        }

        // ----------------------------------------------------------------
        // MODE C: 2A Snappy Portfolio Glide (Playlists, Favourites, Detail routes)
        // ----------------------------------------------------------------
        const cfg = ANIM_CONFIG.routeTransitions.portfolioGlide;
        const inEase = resolveEase(cfg.inEase, 'power3.out');
        const tlIn = gsap.timeline({
          defaults: { force3D: true },
          onComplete: finishIncoming,
        });

        tlIn.fromTo(
          toEl,
          { opacity: 0, y: cfg.inY, willChange: 'transform, opacity' },
          {
            opacity: 1,
            y: 0,
            duration: cfg.inDuration,
            ease: inEase,
          },
          0
        );

        const staggerEls = collectStaggerChildren(toEl);
        if (staggerEls.length > 0) {
          tlIn.fromTo(
            staggerEls,
            { opacity: 0, y: cfg.staggerY },
            {
              opacity: 1,
              y: 0,
              duration: cfg.staggerDuration,
              stagger: cfg.staggerAmount,
              ease: inEase,
              clearProps: GPU_CLEAR_PROPS,
            },
            0.03
          );
        }
      };

      // If no distinct outgoing view, jump straight into incoming GPU animation
      if (!hasDistinctOutgoing) {
        playIncoming();
        return;
      }

      // Snappy GPU-only outgoing exit (no position:absolute, no top/width, no overflow toggle!)
      if (mode.type === 'fade') {
        const cfg = ANIM_CONFIG.routeTransitions.playerTitleFade;
        gsap.to(fromEl, {
          opacity: 0,
          duration: cfg.outDuration,
          ease: resolveEase(cfg.ease, 'power1.out'),
          force3D: true,
          willChange: 'opacity',
          onComplete: playIncoming,
        });
        return;
      }

      if (mode.type === 'vertical-scroll') {
        const cfg = ANIM_CONFIG.routeTransitions.verticalScroll;
        const outY = mode.direction === 'up' ? cfg.distance : -cfg.distance;
        gsap.to(fromEl, {
          y: outY,
          opacity: 0,
          duration: cfg.outDuration,
          ease: resolveEase(cfg.outEase, 'power2.in'),
          force3D: true,
          willChange: 'transform, opacity',
          onComplete: playIncoming,
        });
        return;
      }

      // 2A Portfolio Glide exit
      const cfg = ANIM_CONFIG.routeTransitions.portfolioGlide;
      gsap.to(fromEl, {
        opacity: 0,
        scale: cfg.outScale,
        duration: cfg.outDuration,
        ease: resolveEase(cfg.outEase, 'power1.in'),
        force3D: true,
        willChange: 'transform, opacity',
        onComplete: playIncoming,
      });
    }, mainEl || document.body);
  }

  // ==========================================================================
  // 5. FULLSCREEN LISTENING ROOM (#signature-modal) — outSmooth Zoom-In + Fade-In
  // ==========================================================================
  function openSignatureModal(modalEl) {
    if (!modalEl) return;
    sigContext = revertContext(sigContext);

    modalEl.classList.remove('hidden');

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(modalEl, { clearProps: GPU_CLEAR_PROPS });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.fullscreenRoom;
    const ease = resolveEase(cfg.inEase, 'power3.out');

    gsap.killTweensOf(modalEl);
    sigContext = gsap.context(() => {
      gsap.fromTo(
        modalEl,
        {
          opacity: 0,
          scale: cfg.inScale,
          transformOrigin: '50% 50%',
          willChange: 'transform, opacity',
        },
        {
          opacity: 1,
          scale: 1,
          duration: cfg.inDuration,
          ease,
          force3D: true,
          clearProps: GPU_CLEAR_PROPS,
          onComplete: () => {
            sigContext = null;
          },
        }
      );
    }, modalEl);
  }

  function closeSignatureModal(modalEl, onDone) {
    if (!modalEl) {
      onDone?.();
      return;
    }
    sigContext = revertContext(sigContext);

    if (isMotionDisabled() || modalEl.classList.contains('hidden')) {
      modalEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(modalEl, { clearProps: GPU_CLEAR_PROPS });
      onDone?.();
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.fullscreenRoom;
    const ease = resolveEase(cfg.outEase, 'power2.in');

    gsap.killTweensOf(modalEl);
    sigContext = gsap.context(() => {
      gsap.to(modalEl, {
        opacity: 0,
        scale: cfg.outScale,
        transformOrigin: '50% 50%',
        duration: cfg.outDuration,
        ease,
        force3D: true,
        willChange: 'transform, opacity',
        onComplete: () => {
          modalEl.classList.add('hidden');
          gsap.set(modalEl, { clearProps: GPU_CLEAR_PROPS });
          sigContext = null;
          onDone?.();
        },
      });
    }, modalEl);
  }

  // ==========================================================================
  // 6. DRAWERS (#queue-drawer, #lyrics-drawer, mobile sidebar) + quickTo DRAG
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
        { opacity: 1, duration: cfg.backdropDuration, ease: 'power2.out', force3D: true }
      );
    } else if (!backdrop.classList.contains('hidden')) {
      gsap.to(backdrop, {
        opacity: 0,
        duration: cfg.backdropDuration * 0.85,
        ease: 'power2.in',
        force3D: true,
        onComplete: () => {
          backdrop.classList.add('hidden');
          gsap.set(backdrop, { clearProps: 'opacity' });
        },
      });
    }
  }

  function openDrawer(drawerEl) {
    if (!drawerEl) return;
    revertContext(activeDrawerContexts.get(drawerEl));
    activeDrawerContexts.delete(drawerEl);

    drawerEl.classList.remove('hidden');
    showDrawerBackdrop(true);

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(drawerEl, { clearProps: GPU_CLEAR_PROPS });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(drawerEl);

    const ctx = gsap.context(() => {
      gsap.fromTo(
        drawerEl,
        { xPercent: 100, x: 0, opacity: 0.72, willChange: 'transform, opacity' },
        {
          xPercent: 0,
          x: 0,
          opacity: 1,
          duration: cfg.inDuration,
          ease: resolveEase(cfg.inEase, 'power3.out'),
          force3D: true,
          clearProps: GPU_CLEAR_PROPS,
          onComplete: () => activeDrawerContexts.delete(drawerEl),
        }
      );
    }, drawerEl);
    activeDrawerContexts.set(drawerEl, ctx);
  }

  function closeDrawer(drawerEl, options = {}) {
    if (!drawerEl) return;
    revertContext(activeDrawerContexts.get(drawerEl));
    activeDrawerContexts.delete(drawerEl);

    if (!options.keepBackdrop) {
      showDrawerBackdrop(false);
    }

    if (isMotionDisabled() || drawerEl.classList.contains('hidden')) {
      drawerEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(drawerEl, { clearProps: GPU_CLEAR_PROPS });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.drawers;
    gsap.killTweensOf(drawerEl);

    const ctx = gsap.context(() => {
      gsap.to(drawerEl, {
        xPercent: 100,
        opacity: 0.65,
        duration: cfg.outDuration,
        ease: resolveEase(cfg.outEase, 'power2.in'),
        force3D: true,
        willChange: 'transform, opacity',
        onComplete: () => {
          drawerEl.classList.add('hidden');
          gsap.set(drawerEl, { clearProps: GPU_CLEAR_PROPS });
          activeDrawerContexts.delete(drawerEl);
        },
      });
    }, drawerEl);
    activeDrawerContexts.set(drawerEl, ctx);
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
      force3D: true,
      clearProps: 'transform',
    });
  }

  // High-frequency pointer drag helper using gsap.quickTo() (zero per-frame gsap.to allocation)
  function createDrawerDragController(drawerEl) {
    let quickX = null;
    return {
      move(dx) {
        if (!drawerEl) return;
        const clamped = Math.max(0, dx);
        if (isMotionDisabled()) {
          drawerEl.style.transform = `translate3d(${clamped}px, 0, 0)`;
          return;
        }
        if (!quickX) {
          registerCustomEases();
          quickX = window.gsap.quickTo(drawerEl, 'x', {
            duration: 0.08,
            ease: 'power2.out',
            force3D: true,
          });
        }
        quickX(clamped);
      },
      reset() {
        quickX = null;
      },
    };
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
        { xPercent: -100, willChange: 'transform' },
        {
          xPercent: 0,
          duration: cfg.inDuration,
          ease: resolveEase(cfg.inEase, 'power3.out'),
          force3D: true,
          clearProps: 'transform,willChange',
        }
      );
      if (backdropEl) {
        backdropEl.classList.remove('hidden');
        gsap.fromTo(backdropEl, { opacity: 0 }, { opacity: 1, duration: cfg.backdropDuration, force3D: true });
      }
    } else {
      gsap.to(sidebarEl, {
        xPercent: -100,
        duration: cfg.outDuration,
        ease: resolveEase(cfg.outEase, 'power2.in'),
        force3D: true,
        onComplete: () => {
          sidebarEl.classList.add('-translate-x-full');
          sidebarEl.classList.remove('translate-x-0');
          gsap.set(sidebarEl, { clearProps: 'transform,willChange' });
        },
      });
      if (backdropEl && !backdropEl.classList.contains('hidden')) {
        gsap.to(backdropEl, {
          opacity: 0,
          duration: cfg.outDuration,
          force3D: true,
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

    revertContext(activeModalContexts.get(modalEl));
    activeModalContexts.delete(modalEl);

    modalEl.classList.remove('hidden');
    modalEl.style.pointerEvents = '';
    const panel = modalEl.firstElementChild;

    if (isMotionDisabled()) {
      if (hasGsap()) {
        window.gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) window.gsap.set(panel, { clearProps: GPU_CLEAR_PROPS });
      }
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.modals;
    gsap.killTweensOf(modalEl);
    if (panel) gsap.killTweensOf(panel);

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
          if (panel) gsap.set(panel, { clearProps: GPU_CLEAR_PROPS });
          activeModalContexts.delete(modalEl);
        },
      });

      tl.fromTo(
        modalEl,
        { opacity: 0 },
        { opacity: 1, duration: cfg.backdropDuration, ease: 'power2.out' },
        0
      );

      if (panel) {
        tl.fromTo(
          panel,
          { opacity: 0, y: cfg.panelInY, scale: cfg.panelInScale, willChange: 'transform, opacity' },
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
    }, modalEl);
    activeModalContexts.set(modalEl, ctx);
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

    revertContext(activeModalContexts.get(modalEl));
    activeModalContexts.delete(modalEl);

    const panel = modalEl.firstElementChild;

    if (isMotionDisabled() || modalEl.classList.contains('hidden')) {
      delete modalEl.dataset.gsapClosing;
      modalEl.classList.add('hidden');
      if (hasGsap()) {
        window.gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
        if (panel) window.gsap.set(panel, { clearProps: GPU_CLEAR_PROPS });
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

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        defaults: { force3D: true },
        onComplete: () => {
          delete modalEl.dataset.gsapClosing;
          modalEl.classList.add('hidden');
          gsap.set(modalEl, { clearProps: 'opacity,pointerEvents' });
          if (panel) gsap.set(panel, { clearProps: GPU_CLEAR_PROPS });
          activeModalContexts.delete(modalEl);
          onDone?.();
        },
      });

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
    }, modalEl);
    activeModalContexts.set(modalEl, ctx);
  }

  // ==========================================================================
  // 8. CONTEXT MENU & TOAST NOTIFICATION (.overlay-comingSoon inOut style)
  // ==========================================================================
  function openContextMenu(menuEl) {
    if (!menuEl) return;
    delete menuEl.dataset.gsapClosing;
    menuEl.style.pointerEvents = '';
    contextMenuContext = revertContext(contextMenuContext);

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents,willChange' });
      return;
    }

    registerCustomEases();
    const cfg = ANIM_CONFIG.contextMenu;
    contextMenuContext = window.gsap.context(() => {
      window.gsap.fromTo(
        menuEl,
        { opacity: 0, y: cfg.inY, scale: cfg.inScale, transformOrigin: 'top left' },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: cfg.inDuration,
          ease: resolveEase(cfg.inEase, 'power3.out'),
          force3D: true,
          clearProps: 'transform,opacity,pointerEvents,willChange',
          onComplete: () => {
            contextMenuContext = null;
          },
        }
      );
    }, menuEl);
  }

  function closeContextMenu(menuEl) {
    if (!menuEl) return;
    contextMenuContext = revertContext(contextMenuContext);

    if (isMotionDisabled() || menuEl.classList.contains('hidden')) {
      delete menuEl.dataset.gsapClosing;
      menuEl.classList.add('hidden');
      if (hasGsap()) window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents,willChange' });
      return;
    }

    menuEl.dataset.gsapClosing = 'true';
    menuEl.style.pointerEvents = 'none';

    const cfg = ANIM_CONFIG.contextMenu;
    contextMenuContext = window.gsap.context(() => {
      window.gsap.to(menuEl, {
        opacity: 0,
        scale: 0.97,
        duration: cfg.outDuration,
        ease: 'power2.in',
        force3D: true,
        onComplete: () => {
          delete menuEl.dataset.gsapClosing;
          menuEl.classList.add('hidden');
          window.gsap.set(menuEl, { clearProps: 'transform,opacity,pointerEvents,willChange' });
          contextMenuContext = null;
        },
      });
    }, menuEl);
  }

  let fallbackToastTimer = null;
  function showToast(el, message) {
    if (!el) return;
    el.textContent = message;

    toastContext = revertContext(toastContext);
    if (fallbackToastTimer) {
      clearTimeout(fallbackToastTimer);
      fallbackToastTimer = null;
    }

    el.classList.remove('hidden');

    if (isMotionDisabled()) {
      if (hasGsap()) window.gsap.set(el, { clearProps: GPU_CLEAR_PROPS });
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
    toastContext = gsap.context(() => {
      gsap
        .timeline({
          defaults: { force3D: true },
          onComplete: () => {
            el.classList.add('hidden');
            gsap.set(el, { clearProps: GPU_CLEAR_PROPS });
            toastContext = null;
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
    }, el);
  }

  // ==========================================================================
  // 9. SIDEBAR COLLAPSE / EXPAND (GPU-Only Transform Settle — Zero Width Reflow!)
  // ==========================================================================
  function animateSidebarWidth(sidebarEl, collapsed) {
    if (!sidebarEl) return;
    sidebarContext = revertContext(sidebarContext);

    // Toggle layout class once (single layout pass instead of 60fps width reflow)
    sidebarEl.classList.toggle('sidebar-collapsed', collapsed);

    if (isMotionDisabled() || !isDesktop()) {
      if (hasGsap()) window.gsap.set(sidebarEl, { clearProps: 'transform,opacity,width' });
      return;
    }

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.sidebarCollapse;
    const navEl = sidebarEl.querySelector('nav');
    const shiftX = collapsed ? cfg.shiftX : -cfg.shiftX;

    sidebarContext = gsap.context(() => {
      if (navEl) {
        gsap.fromTo(
          navEl,
          { x: shiftX, opacity: 0.72 },
          {
            x: 0,
            opacity: 1,
            duration: cfg.duration,
            ease: resolveEase(cfg.ease, 'power3.out'),
            force3D: true,
            clearProps: GPU_CLEAR_PROPS,
            onComplete: () => {
              sidebarContext = null;
            },
          }
        );
      }
    }, sidebarEl);
  }

  // ==========================================================================
  // 10. PARABOLIC COVER FLY (Batched Reads -> GPU-Only Transform Timeline)
  // ==========================================================================
  function coverFly(sourceEl, targetSelector = '#player-cover-btn') {
    if (!sourceEl || isMotionDisabled()) return;
    const layer = $('cover-fly-layer');
    const targetEl = document.querySelector(targetSelector);
    if (!layer || !targetEl) return;

    // Batch all DOM geometry reads BEFORE any DOM writes
    const sRect = sourceEl.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    if (sRect.width <= 0 || tRect.width <= 0) return;

    const img = sourceEl.tagName === 'IMG' ? sourceEl : sourceEl.querySelector('img:not(.hidden)');
    const imgSrc = img?.src || '';

    registerCustomEases();
    const gsap = window.gsap;
    const cfg = ANIM_CONFIG.coverFly;

    // Single write phase
    const ghost = document.createElement('div');
    ghost.style.cssText =
      `position:fixed;left:${sRect.left}px;top:${sRect.top}px;width:${sRect.width}px;height:${sRect.height}px;` +
      `border-radius:var(--radius-inner);overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.55);` +
      `border:1px solid var(--primary);background:var(--card);pointer-events:none;will-change:transform,opacity;` +
      (imgSrc ? `background-image:url("${imgSrc}");background-size:cover;background-position:center;` : '');
    layer.appendChild(ghost);

    const dx = tRect.left + tRect.width / 2 - (sRect.left + sRect.width / 2);
    const dy = tRect.top + tRect.height / 2 - (sRect.top + sRect.height / 2);
    const lift = Math.min(cfg.arcLiftMax, Math.max(cfg.arcLiftMin, Math.abs(dx) * 0.18));
    const midX = dx * 0.52;
    const midY = dy * 0.5 - lift;

    const ease = resolveEase(cfg.ease, 'power3.out');
    const half = cfg.duration * 0.52;
    const rest = cfg.duration - half;

    const entry = { tl: null, ghost };
    entry.tl = gsap
      .timeline({
        defaults: { force3D: true },
        onComplete: () => {
          activeCoverFlyTimelines.delete(entry);
          ghost.remove();
        },
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

    activeCoverFlyTimelines.add(entry);
  }

  // ==========================================================================
  // 11. COVER ART CROSSFADE (changeImageWithFade style for Now Playing & Room)
  // ==========================================================================
  function clearCoverGhost(imgEl) {
    const parent = imgEl?.parentElement;
    if (!parent) return;
    parent.querySelectorAll('.gsap-cover-ghost').forEach((g) => {
      if (g.dataset.cleanupTimer) {
        const tid = Number(g.dataset.cleanupTimer);
        clearTimeout(tid);
        activeCoverGhostTimers.delete(tid);
      }
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
      activeCoverGhostTimers.delete(timer);
      if (!ghost.isConnected) return;
      window.gsap.to(ghost, {
        opacity: 0,
        duration: ANIM_CONFIG.coverCrossfade.fadeOutDuration,
        ease: 'power2.out',
        force3D: true,
        onComplete: () => ghost.remove(),
      });
    }, 650);
    activeCoverGhostTimers.add(timer);
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
        force3D: true,
        clearProps: GPU_CLEAR_PROPS,
      }
    );

    if (parent) {
      parent.querySelectorAll('.gsap-cover-ghost').forEach((ghost) => {
        if (ghost.dataset.cleanupTimer) {
          const tid = Number(ghost.dataset.cleanupTimer);
          clearTimeout(tid);
          activeCoverGhostTimers.delete(tid);
        }
        gsap.killTweensOf(ghost);
        gsap.to(ghost, {
          opacity: 0,
          duration: cfg.fadeOutDuration,
          ease: 'power2.out',
          force3D: true,
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
    welcomeStepContext = revertContext(welcomeStepContext);

    const cfg = ANIM_CONFIG.welcomeStep;
    const startX = direction >= 0 ? cfg.xOffset : -cfg.xOffset;

    welcomeStepContext = window.gsap.context(() => {
      window.gsap.fromTo(
        panelEl,
        { opacity: 0, x: startX },
        {
          opacity: 1,
          x: 0,
          duration: cfg.duration,
          ease: resolveEase(cfg.ease, 'power3.out'),
          force3D: true,
          clearProps: GPU_CLEAR_PROPS,
          onComplete: () => {
            welcomeStepContext = null;
          },
        }
      );
    }, panelEl);
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
      force3D: true,
      overwrite: 'auto',
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
        force3D: true,
        overwrite: 'auto',
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
          force3D: true,
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
    createRouteContext,
    cleanupActiveRouteTransition,
    scheduleScrollTriggerRefresh,
    transitionRoute,
    resolveRouteMode,
    openSignatureModal,
    closeSignatureModal,
    openDrawer,
    closeDrawer,
    snapBackDrawer,
    createDrawerDragController,
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
