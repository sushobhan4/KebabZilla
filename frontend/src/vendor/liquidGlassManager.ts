/**
 * Liquid Glass WebGL Manager
 * Manages WebGL shader instances for the Navbar and Searchbar.
 * Powered by GlassRenderer (WebGL 1.0 + GLSL ES Shaders).
 */

import {
  GlassRenderer,
  HtmlCapture,
  DEFAULTS,
  type GlassConfig,
} from "./liquidglass.js";

export interface GlassSettings extends GlassConfig {
  applyToNav: boolean;
  applyToSearch: boolean;
  activePreset: string;
}

export const GLASS_PRESETS: Record<string, Partial<GlassSettings>> = {
  crystal: {
    activePreset: "crystal",
    blurAmount: 0.12,
    refraction: 0.85,
    specular: 0.65,
    chromAberration: 0.08,
    edgeHighlight: 0.26,
    cornerRadius: 22,
    zRadius: 36,
    opacity: 0.95,
    fresnel: 0.9,
    tintStrength: 0.04,
    brightness: 0.02,
    shadowOpacity: 0.25,
    shadowSpread: 12,
    shadowOffsetY: 4,
    tintColor: "#ffffff",
  },
  frosted: {
    activePreset: "frosted",
    blurAmount: 0.42,
    refraction: 0.55,
    specular: 0.3,
    chromAberration: 0.04,
    edgeHighlight: 0.14,
    cornerRadius: 18,
    zRadius: 28,
    opacity: 0.88,
    fresnel: 0.7,
    tintStrength: 0.03,
    brightness: 0.04,
    shadowOpacity: 0.2,
    shadowSpread: 14,
    shadowOffsetY: 3,
    tintColor: "#ffffff",
  },
  liquid: {
    activePreset: "liquid",
    blurAmount: 0.15,
    refraction: 0.98,
    specular: 0.85,
    chromAberration: 0.12,
    edgeHighlight: 0.35,
    cornerRadius: 26,
    zRadius: 46,
    opacity: 0.94,
    fresnel: 1.0,
    tintStrength: 0.08,
    brightness: 0.03,
    shadowOpacity: 0.35,
    shadowSpread: 18,
    shadowOffsetY: 6,
    tintColor: "#0071e3",
  },
  obsidian: {
    activePreset: "obsidian",
    blurAmount: 0.25,
    refraction: 0.65,
    specular: 0.55,
    chromAberration: 0.05,
    edgeHighlight: 0.18,
    cornerRadius: 18,
    zRadius: 32,
    opacity: 0.92,
    fresnel: 0.8,
    tintStrength: 0.1,
    brightness: -0.12,
    saturation: -0.15,
    shadowOpacity: 0.45,
    shadowSpread: 16,
    shadowOffsetY: 5,
    tintColor: "#1a1a24",
  },
  prismatic: {
    activePreset: "prismatic",
    blurAmount: 0.18,
    refraction: 0.9,
    specular: 0.78,
    chromAberration: 0.18,
    edgeHighlight: 0.38,
    cornerRadius: 22,
    zRadius: 38,
    opacity: 0.96,
    fresnel: 1.0,
    tintStrength: 0.09,
    brightness: 0.04,
    shadowOpacity: 0.3,
    shadowSpread: 15,
    shadowOffsetY: 4,
    tintColor: "#af52de",
  },
  screenshot: {
    activePreset: "screenshot",
    blurAmount: 0,
    refraction: 1.38,
    chromAberration: 0.095,
    edgeHighlight: 0.78,
    specular: 0,
    fresnel: 1.11,
    distortion: 0,
    cornerRadius: 100,
    zRadius: 19,
    opacity: 1,
    saturation: 0,
    brightness: 0,
    shadowOpacity: 0,
    shadowSpread: 1,
    bevelMode: 0,
    tintColor: "#ffffff",
  },
};

const STORAGE_KEY = "kz_liquid_glass_config_final";

const DEFAULT_SETTINGS: GlassSettings = {
  ...DEFAULTS,
  blurAmount: 0.14,
  refraction: 0.9,
  chromAberration: 0.3,
  edgeHighlight: 0.1,
  specular: 0,
  fresnel: 0,
  distortion: 0.3,
  cornerRadius: 0,
  zRadius: 35,
  opacity: 1,
  saturation: -0.3,
  brightness: 0,
  shadowOpacity: 0,
  shadowSpread: 0,
  bevelMode: 0,
  applyToNav: true,
  applyToSearch: true,
  activePreset: "",
  tintColor: "#000000",
  tintStrength: 0.1,
} as GlassSettings;

const SHADOW_PAD = 20;

class LiquidGlassManager {
  private renderer: GlassRenderer | null = null;
  private capture: HtmlCapture | null = null;
  private settings: GlassSettings = { ...DEFAULT_SETTINGS };
  private listeners: Set<(settings: GlassSettings) => void> = new Set();
  private elementCanvases: Map<HTMLElement, HTMLCanvasElement> = new Map();
  private sceneCanvas: HTMLCanvasElement = document.createElement("canvas");
  private sceneCtx: CanvasRenderingContext2D =
    this.sceneCanvas.getContext("2d")!;
  private isRunning = false;
  private rafId: number | null = null;
  private isDirty = true;
  private dirtyFramesRemaining = 0;
  private mutationObserver: MutationObserver | null = null;
  private isEnabled = true;
  private isThrottled = false;
  private isPausedForVisibility = false;
  private initStartTime = performance.now();
  private lastResizeTime = 0;
  private lastBurstFrameTimestamp = 0;
  private consecutiveLaggedFrames = 0;
  private highRenderDurationStreak = 0;
  private cachedHeaderH = -1;
  private cachedSearchH = -1;
  private lastStuckState: boolean | null = null;
  private activeTransitions = 0;
  private lastTransitionTime = 0;
  private pointerMoveRaf = false;

  constructor() {
    this.loadFromStorage();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  private loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  public saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Failed to save liquid glass config:", e);
    }
  }

  public getSettings(): GlassSettings {
    return { ...this.settings };
  }

  public subscribe(cb: (settings: GlassSettings) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify() {
    this.listeners.forEach((fn) => fn(this.getSettings()));
    this.saveToStorage();
    this.requestRender();
  }

  public updateSettings(partial: Partial<GlassSettings>) {
    this.settings = {
      ...this.settings,
      ...partial,
      activePreset:
        partial.activePreset !== undefined ? partial.activePreset : "",
    };
    this.notify();
  }

  public applyPreset(name: string) {
    const preset = GLASS_PRESETS[name];
    if (preset) {
      this.settings = {
        ...this.settings,
        ...preset,
        activePreset: name,
      };
      this.notify();
    }
  }

  public resetToDefaults() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.notify();
  }

  public start() {
    if (this.isRunning) return;
    if (!this.isEnabled) {
      this.isRunning = true;
      // Liquid glass effect disabled: attach lightweight scroll listener for the seamless container merge
      window.addEventListener("scroll", this.handleScrollOrResize, {
        passive: true,
      });
      window.addEventListener("resize", this.handleScrollOrResize, {
        passive: true,
      });
      this.updateStuckState();
      return;
    }
    if (this.isThrottled) {
      console.info(
        "LiquidGlassManager: Throttling active; staying on CSS glass fallback.",
      );
      return;
    }
    try {
      this.renderer = new GlassRenderer();
    } catch (err) {
      console.warn(
        "LiquidGlassManager: WebGL initialization failed, fallback to CSS glass:",
        err,
      );
      this.handleThrottlingTrigger("WebGL initialization failure");
      return;
    }

    // Attach WebGL context lost listener if available
    try {
      const glCanvas = (this.renderer as any)?.canvas as
        | HTMLCanvasElement
        | undefined;
      if (glCanvas) {
        glCanvas.addEventListener(
          "webglcontextlost",
          () => {
            this.handleThrottlingTrigger("WebGL context lost");
          },
          { once: true },
        );
      }
    } catch {}



    try {
      this.capture = new HtmlCapture(document.body);
      this.capture.prefetchFontEmbedCSS().catch(() => {});
      this.capture.onCacheUpdate = () => {
        this.isDirty = true;
      };
    } catch (err) {
      console.warn(
        "LiquidGlassManager: HtmlCapture initialization failed, using Canvas2D direct renderer:",
        err,
      );
    }

    this.isRunning = true;
    this.isDirty = true;
    this.dirtyFramesRemaining = 15;

    // Observe DOM mutations so any category changes, card filtering, or UI updates immediately invalidate stale snapshots
    this.mutationObserver = new MutationObserver((mutations) => {
      let relevant = false;
      for (const m of mutations) {
        const target = m.target as HTMLElement;
        if (!target) continue;

        // Skip our own liquid glass canvas or internal elements
        if (
          target.classList?.contains("liquid-glass-webgl-canvas") ||
          (target.closest && target.closest(".liquid-glass-webgl-canvas"))
        ) {
          continue;
        }

        // Invalidate cache for any candidate block that was mutated
        if (this.capture && target.closest) {
          const block = target.closest<HTMLElement>(
            ".hero-section, .value-strip, .menu-intro, .menu-tabs, .food-card, .food-grid, .story-banner, .store-bottom, .order-success",
          );
          if (block) {
            this.capture.invalidateCache(block);
          }
        }

        relevant = true;
      }

      if (relevant) {
        this.isDirty = true;
        this.dirtyFramesRemaining = 12;
      }
    });

    try {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "src",
          "disabled",
          "checked",
          "hidden",
        ],
      });
    } catch (e) {
      console.warn("LiquidGlassManager: MutationObserver setup failed:", e);
    }

    window.addEventListener("scroll", this.handleScrollOrResize, {
      passive: true,
    });
    window.addEventListener("resize", this.handleScrollOrResize, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.handleInteraction, {
      passive: true,
    });
    window.addEventListener("click", this.handleInteraction, { passive: true });
    window.addEventListener("input", this.handleInteraction, { passive: true });
    window.addEventListener("wheel", this.handleInteraction, { passive: true });
    window.addEventListener("touchmove", this.handleInteraction, { passive: true });
    window.addEventListener("touchstart", this.handleInteraction, { passive: true });
    window.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    window.addEventListener("pointerover", this.handleHover, { passive: true });
    window.addEventListener("pointerout", this.handleHover, { passive: true });
    window.addEventListener("mouseover", this.handleHover, { passive: true });
    window.addEventListener("mouseout", this.handleHover, { passive: true });
    window.addEventListener("transitionrun", this.handleTransition, { passive: true });
    window.addEventListener("transitionstart", this.handleTransition, { passive: true });
    window.addEventListener("transitionend", this.handleTransitionEnd, { passive: true });
    window.addEventListener("transitioncancel", this.handleTransitionEnd, { passive: true });
    window.addEventListener("animationstart", this.handleTransition, { passive: true });
    window.addEventListener("animationend", this.handleTransitionEnd, { passive: true });

    this.scheduleRender(8);
  }

  public stop() {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    window.removeEventListener("scroll", this.handleScrollOrResize);
    window.removeEventListener("resize", this.handleScrollOrResize);
    window.removeEventListener("pointerdown", this.handleInteraction);
    window.removeEventListener("click", this.handleInteraction);
    window.removeEventListener("input", this.handleInteraction);
    window.removeEventListener("change", this.handleInteraction);
    window.removeEventListener("keyup", this.handleInteraction);
    window.removeEventListener("wheel", this.handleInteraction);
    window.removeEventListener("touchmove", this.handleInteraction);
    window.removeEventListener("touchstart", this.handleInteraction);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerover", this.handleHover);
    window.removeEventListener("pointerout", this.handleHover);
    window.removeEventListener("mouseover", this.handleHover);
    window.removeEventListener("mouseout", this.handleHover);
    window.removeEventListener("transitionrun", this.handleTransition);
    window.removeEventListener("transitionstart", this.handleTransition);
    window.removeEventListener("transitionend", this.handleTransitionEnd);
    window.removeEventListener("transitioncancel", this.handleTransitionEnd);
    window.removeEventListener("animationstart", this.handleTransition);
    window.removeEventListener("animationend", this.handleTransitionEnd);

    for (const [el, canvas] of this.elementCanvases) {
      canvas.remove();
      el.classList.remove("has-liquid-glass");
    }
    this.elementCanvases.clear();

    if (this.capture) {
      this.capture.destroy();
      this.capture = null;
    }

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.pauseForVisibility();
    } else {
      this.resumeFromVisibility();
    }
  };

  private pauseForVisibility() {
    if (!this.isRunning) return;
    this.isPausedForVisibility = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const [el, canvas] of this.elementCanvases) {
      canvas.remove();
      el.classList.remove("has-liquid-glass");
    }
    this.elementCanvases.clear();
  }

  private resumeFromVisibility() {
    if (!this.isPausedForVisibility && !this.isThrottled) return;
    this.isPausedForVisibility = false;

    // Reset performance tracking metrics for a fresh evaluation
    this.isThrottled = false;
    this.initStartTime = performance.now();
    this.lastBurstFrameTimestamp = 0;
    this.consecutiveLaggedFrames = 0;
    this.highRenderDurationStreak = 0;
    document.documentElement.style.removeProperty("--liquid-glass-throttled");
    document.documentElement.removeAttribute("data-liquid-glass-throttled");

    this.start();
    this.scheduleRender(12);
  }

  public scheduleRender(frames = 6) {
    this.dirtyFramesRemaining = Math.max(this.dirtyFramesRemaining, frames);
    this.isDirty = true;
    if (this.isRunning && !this.rafId) {
      this.rafId = requestAnimationFrame(this.renderLoop);
    }
  }

  public requestRender(frames = 6) {
    this.scheduleRender(frames);
  }

  public invalidateAll() {
    if (this.capture) {
      this.capture.cache.clear();
    }
    this.scheduleRender(8);
  }

  private handleInteraction = (e?: Event) => {
    if (e && e.target instanceof HTMLElement && this.capture) {
      const block = e.target.closest<HTMLElement>(
        ".hero-section, .value-strip, .menu-intro, .menu-tabs, .food-card, .food-grid, .story-banner, .store-bottom, .order-success",
      );
      if (block) {
        this.capture.invalidateCache(block);
      }
    }
    this.scheduleRender(8);
  };

  private handlePointerMove = () => {
    if (this.pointerMoveRaf) return;
    this.pointerMoveRaf = true;
    requestAnimationFrame(() => {
      this.pointerMoveRaf = false;
      if (!this.isRunning) return;
      this.scheduleRender(14);
    });
  };

  private handleHover = () => {
    if (!this.isRunning) return;
    // Provide a burst covering full CSS hover transitions (~300ms)
    this.scheduleRender(22);
  };

  private handleTransition = () => {
    if (!this.isRunning) return;
    this.activeTransitions = Math.min(25, this.activeTransitions + 1);
    this.lastTransitionTime = performance.now();
    this.scheduleRender(20);
  };

  private handleTransitionEnd = () => {
    if (!this.isRunning) return;
    this.activeTransitions = Math.max(0, this.activeTransitions - 1);
    this.scheduleRender(6);
  };

  private handleScrollOrResize = (e?: Event) => {
    if (e && e.type === "resize") {
      this.lastResizeTime = performance.now();
    }
    this.updateStuckState();
    this.scheduleRender(6);
  };

  /**
   * Evaluates if navbar and search controls are physically touching/stuck together.
   * Keeps .is-stuck-together class in sync in both WebGL and CSS-only fallback modes.
   */
  public updateStuckState(): boolean {
    const header = document.querySelector<HTMLElement>(".app-header");
    const searchStrip = document.querySelector<HTMLElement>(
      ".storefront-sticky-controls",
    );
    if (!header || !searchStrip) return false;

    const baseHeaderH = header.getBoundingClientRect().height;

    if (baseHeaderH > 0) {
      const roundedH = Math.round(baseHeaderH);
      if (this.cachedHeaderH !== roundedH) {
        this.cachedHeaderH = roundedH;
        document.documentElement.style.setProperty(
          "--app-header-height",
          `${roundedH}px`,
        );
      }
    }

    const searchRect = searchStrip.getBoundingClientRect();
    if (searchRect.height > 0) {
      const roundedSearchH = Math.round(searchRect.height);
      if (this.cachedSearchH !== roundedSearchH) {
        this.cachedSearchH = roundedSearchH;
        document.documentElement.style.setProperty(
          "--sticky-controls-height",
          `${roundedSearchH}px`,
        );
      }
    }

    const navRect = header.getBoundingClientRect();
    const gap = searchRect.top - navRect.bottom;
    const isStuck =
      Math.abs(gap) <= 4 && navRect.height > 0 && searchRect.height > 0;

    if (this.lastStuckState !== isStuck) {
      this.lastStuckState = isStuck;
      if (isStuck) {
        header.classList.add("is-stuck-together");
        searchStrip.classList.add("is-stuck-together");
      } else {
        header.classList.remove("is-stuck-together");
        searchStrip.classList.remove("is-stuck-together");
      }
    }

    return isStuck;
  }


  private discoverElements() {
    const targets: HTMLElement[] = [];

    if (this.settings.applyToNav) {
      const header = document.querySelector<HTMLElement>(".app-header");
      if (header) targets.push(header);
    } else {
      const header = document.querySelector<HTMLElement>(".app-header");
      if (header && this.elementCanvases.has(header)) {
        this.removeElementCanvas(header);
      }
    }

    const searchStrip = document.querySelector<HTMLElement>(
      ".storefront-sticky-controls",
    );
    if (this.settings.applyToSearch) {
      if (searchStrip) targets.push(searchStrip);
    } else {
      if (searchStrip && this.elementCanvases.has(searchStrip)) {
        this.removeElementCanvas(searchStrip);
      }
    }

    // Ensure search input and sort button NEVER have liquid glass canvas attached
    const searchInput = document.querySelector<HTMLElement>(".menu-search");
    if (searchInput && this.elementCanvases.has(searchInput)) {
      this.removeElementCanvas(searchInput);
    }
    const sortSelect = document.querySelector<HTMLElement>(
      ".menu-sort-select, .rounded-select-trigger",
    );
    if (sortSelect && this.elementCanvases.has(sortSelect)) {
      this.removeElementCanvas(sortSelect);
    }

    for (const el of targets) {
      if (!this.elementCanvases.has(el)) {
        this.attachElementCanvas(el);
      }
    }

    // Clean up detached elements
    for (const [el] of this.elementCanvases) {
      if (!document.contains(el) || !targets.includes(el)) {
        this.removeElementCanvas(el);
      }
    }
  }

  private attachElementCanvas(el: HTMLElement) {
    const canvas = document.createElement("canvas");
    canvas.className = "liquid-glass-webgl-canvas";
    canvas.style.cssText =
      [
        "position: absolute",
        `left: -${SHADOW_PAD}px`,
        `top: -${SHADOW_PAD}px`,
        `width: calc(100% + ${SHADOW_PAD * 2}px)`,
        `height: calc(100% + ${SHADOW_PAD * 2}px)`,
        "pointer-events: none",
        "z-index: 0",
        "border-radius: 0",
      ].join(";") + ";";

    const curPos = window.getComputedStyle(el).position;
    if (curPos === "static") {
      el.style.position = "relative";
    }
    el.style.overflow = "visible";
    el.classList.add("has-liquid-glass");

    el.insertBefore(canvas, el.firstChild);
    this.elementCanvases.set(el, canvas);
  }

  private removeElementCanvas(el: HTMLElement) {
    const canvas = this.elementCanvases.get(el);
    if (canvas) {
      canvas.remove();
      this.elementCanvases.delete(el);
    }
    el.classList.remove("has-liquid-glass");
  }

  private renderLoop = (timestamp?: number) => {
    if (!this.isRunning) return;

    const now = typeof timestamp === "number" ? timestamp : performance.now();
    const isStartupGracePeriod = now - this.initStartTime < 2500;
    const isRecentResize = now - this.lastResizeTime < 800; // Protect against DevTools inspect open / window resize

    // Safety timeout for active CSS transitions: auto-expire after 1.5s
    if (this.activeTransitions > 0 && now - this.lastTransitionTime > 1500) {
      this.activeTransitions = 0;
    }

    // Monitor frame performance during active rendering bursts
    if (!isStartupGracePeriod && !isRecentResize) {
      if (this.lastBurstFrameTimestamp > 0) {
        const frameInterval = now - this.lastBurstFrameTimestamp;
        // Only evaluate frame drops when interval <= 150ms (idle pauses between user events are NOT lag!)
        if (frameInterval <= 150) {
          if (frameInterval > 65) {
            this.consecutiveLaggedFrames++;
            if (this.consecutiveLaggedFrames >= 5) {
              this.handleThrottlingTrigger(
                `Active render frame interval dropped (${Math.round(1000 / frameInterval)} FPS / ${Math.round(frameInterval)}ms)`,
              );
              return;
            }
          } else if (frameInterval <= 35) {
            this.consecutiveLaggedFrames = Math.max(0, this.consecutiveLaggedFrames - 1);
          }
        } else {
          this.consecutiveLaggedFrames = 0;
        }
      }
      this.lastBurstFrameTimestamp = now;
    }

    const hasActiveAnimation = this.activeTransitions > 0;
    if ((this.isDirty || this.dirtyFramesRemaining > 0 || hasActiveAnimation) && this.renderer) {
      if (this.dirtyFramesRemaining > 0) {
        this.dirtyFramesRemaining--;
      }
      this.isDirty = false;
      try {
        const renderStart = performance.now();
        this.discoverElements();
        this.renderElements();
        const renderDuration = performance.now() - renderStart;

        // If the execution time of rendering itself exceeds 35ms (> 2 frames of CPU/GPU work)
        if (!isStartupGracePeriod && renderDuration > 35) {
          this.highRenderDurationStreak++;
          if (this.highRenderDurationStreak >= 4) {
            this.handleThrottlingTrigger(
              `Rendering duration exceeded budget (${Math.round(renderDuration)}ms)`,
            );
            return;
          }
        } else if (renderDuration <= 18) {
          this.highRenderDurationStreak = Math.max(0, this.highRenderDurationStreak - 1);
        }
      } catch (err: any) {
        console.warn("LiquidGlassManager: WebGL render failed, falling back to CSS glass:", err);
        this.handleThrottlingTrigger(`Render error: ${err?.message || err}`);
        return;
      }
    }

    if (this.dirtyFramesRemaining > 0 || this.isDirty || this.activeTransitions > 0) {
      this.rafId = requestAnimationFrame(this.renderLoop);
    } else {
      this.rafId = null;
      // Burst has completed and rendering is now idle. Reset burst frame timestamp so
      // the idle time between events is NEVER counted as lag!
      this.lastBurstFrameTimestamp = 0;
    }
  };

  /**
   * Automatically triggered when device throttling or low FPS is detected.
   * Completely tears down WebGL liquid glass and falls back smoothly to standard CSS.
   */
  private handleThrottlingTrigger(reason: string) {
    if (this.isThrottled) return;
    this.isThrottled = true;
    console.warn(
      `LiquidGlassManager: Performance throttling detected (${reason}). Falling back to regular CSS styling.`,
    );

    // Stop WebGL loop and remove canvas overlays
    this.stop();

    // Re-attach lightweight scroll/resize listener specifically for the CSS stuck-together effect
    window.addEventListener("scroll", this.handleScrollOrResize, {
      passive: true,
    });
    window.addEventListener("resize", this.handleScrollOrResize, {
      passive: true,
    });
    this.updateStuckState();

    // Remove WebGL styling classes so regular CSS takes over
    const header = document.querySelector<HTMLElement>(".app-header");
    const searchStrip = document.querySelector<HTMLElement>(
      ".storefront-sticky-controls",
    );
    if (header) {
      header.classList.remove("has-liquid-glass");
    }
    if (searchStrip) {
      searchStrip.classList.remove("has-liquid-glass");
    }

    // Set fallback CSS variable flag and attribute
    document.documentElement.style.setProperty("--liquid-glass-throttled", "1");
    document.documentElement.setAttribute("data-liquid-glass-throttled", "true");
  }

  public isPerformanceThrottled(): boolean {
    return this.isThrottled;
  }

  public resetThrottling() {
    this.isThrottled = false;
    this.initStartTime = performance.now();
    this.lastBurstFrameTimestamp = 0;
    this.consecutiveLaggedFrames = 0;
    this.highRenderDurationStreak = 0;
    document.documentElement.style.removeProperty("--liquid-glass-throttled");
    document.documentElement.removeAttribute("data-liquid-glass-throttled");
    this.start();
  }

  private renderElements() {
    if (!this.renderer || this.elementCanvases.size === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const header = document.querySelector<HTMLElement>(".app-header");
    const searchStrip = document.querySelector<HTMLElement>(
      ".storefront-sticky-controls",
    );

    // Dynamically sync --app-header-height to exact header height so sticky position matches perfectly
    if (header) {
      const headerH = Math.round(header.getBoundingClientRect().height);
      if (headerH > 0) {
        document.documentElement.style.setProperty(
          "--app-header-height",
          `${headerH}px`,
        );
      }
    }

    // Check if both elements are currently active and stuck together
    let isStuckTogether = this.updateStuckState();
    let navRect: DOMRect | null = header
      ? header.getBoundingClientRect()
      : null;
    let searchRect: DOMRect | null = searchStrip
      ? searchStrip.getBoundingClientRect()
      : null;

    if (
      isStuckTogether &&
      header &&
      searchStrip &&
      this.elementCanvases.has(header) &&
      this.elementCanvases.has(searchStrip) &&
      navRect &&
      searchRect
    ) {
      this.renderStuckPair(header, searchStrip, navRect, searchRect, dpr);
      return;
    }

    // Render independent elements when apart
    for (const [el, canvas] of this.elementCanvases) {
      const rect = el.getBoundingClientRect();
      const elW = Math.round(rect.width);
      const elH = Math.round(rect.height);

      if (elW <= 0 || elH <= 0) continue;

      const padW = SHADOW_PAD * 2;
      const padH = SHADOW_PAD * 2;

      let effDpr = dpr;
      if ((elW + padW) * effDpr > 2560) {
        effDpr = 1;
      }

      const targetCanvasW = Math.round((elW + padW) * effDpr);
      const targetCanvasH = Math.round((elH + padH) * effDpr);

      // Restore normal standalone canvas positioning
      canvas.style.left = `-${SHADOW_PAD}px`;
      canvas.style.width = `calc(100% + ${SHADOW_PAD * 2}px)`;
      canvas.style.top = `-${SHADOW_PAD}px`;
      canvas.style.height = `calc(100% + ${SHADOW_PAD * 2}px)`;

      if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
        canvas.width = targetCanvasW;
        canvas.height = targetCanvasH;
      }

      const sampleLeft = rect.left - SHADOW_PAD;
      const sampleTop = rect.top - SHADOW_PAD;
      const sampleRight = rect.right + SHADOW_PAD;
      const sampleBottom = rect.bottom + SHADOW_PAD;

      this.composeSceneForBounds(
        sampleLeft,
        sampleTop,
        sampleRight,
        sampleBottom,
        targetCanvasW,
        targetCanvasH,
        effDpr,
        [el],
      );



      this.renderer.uploadAndBlur(
        this.sceneCanvas,
        0,
        0,
        targetCanvasW,
        targetCanvasH,
        this.settings.blurAmount,
      );

      this.renderer.clear();
      this.renderer.renderGlassPanel(this.settings, elW, elH, effDpr);

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          this.renderer.canvas,
          0,
          0,
          targetCanvasW,
          targetCanvasH,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }
    }
  }

  private renderStuckPair(
    header: HTMLElement,
    searchStrip: HTMLElement,
    navRect: DOMRect,
    searchRect: DOMRect,
    dpr: number,
  ) {
    const navCanvas = this.elementCanvases.get(header);
    const searchCanvas = this.elementCanvases.get(searchStrip);
    if (!navCanvas || !searchCanvas || !this.renderer) return;

    // Viewport bounds of both elements combined
    const commonLeft = Math.min(navRect.left, searchRect.left);
    const commonRight = Math.max(navRect.right, searchRect.right);
    const combinedW = Math.max(1, Math.round(commonRight - commonLeft));
    const navH = Math.max(1, Math.round(navRect.height));
    const searchVisibleH = Math.max(
      1,
      Math.round(searchRect.bottom - navRect.bottom),
    );
    const combinedH = navH + searchVisibleH;

    const padW = SHADOW_PAD * 2;
    const padH = SHADOW_PAD * 2;

    let effDpr = dpr;
    if ((combinedW + padW) * effDpr > 2560) {
      effDpr = 1;
    }

    const totalRenderW = Math.round((combinedW + padW) * effDpr);
    const totalRenderH = Math.round((combinedH + padH) * effDpr);

    // 1. Position both canvases to align to the EXACT SAME common viewport bounds
    // Horizontal alignment: both canvases start at commonLeft - SHADOW_PAD in viewport
    navCanvas.style.left = `${commonLeft - navRect.left - SHADOW_PAD}px`;
    navCanvas.style.width = `${combinedW + padW}px`;
    searchCanvas.style.left = `${commonLeft - searchRect.left - SHADOW_PAD}px`;
    searchCanvas.style.width = `${combinedW + padW}px`;

    // Vertical alignment with overlap:
    // navCanvas extends down by OVERLAP px
    const OVERLAP = 3;
    const overlapDpr = Math.round(OVERLAP * effDpr);
    navCanvas.style.top = `-${SHADOW_PAD}px`;
    navCanvas.style.height = `${navH + SHADOW_PAD + OVERLAP}px`;
    const navSplitY = Math.round((SHADOW_PAD + navH) * effDpr);
    const navCanvasH = Math.round((SHADOW_PAD + navH + OVERLAP) * effDpr);
    if (navCanvas.width !== totalRenderW || navCanvas.height !== navCanvasH) {
      navCanvas.width = totalRenderW;
      navCanvas.height = navCanvasH;
    }

    // searchCanvas extends up by OVERLAP px so the two canvases overlap seamlessly
    const searchTopInSearchStrip = Math.round(navRect.bottom - searchRect.top);
    searchCanvas.style.top = `${searchTopInSearchStrip - OVERLAP}px`;
    const searchSliceH = Math.round((searchVisibleH + SHADOW_PAD + OVERLAP) * effDpr);
    searchCanvas.style.height = `${searchVisibleH + SHADOW_PAD + OVERLAP}px`;
    if (
      searchCanvas.width !== totalRenderW ||
      searchCanvas.height !== searchSliceH
    ) {
      searchCanvas.width = totalRenderW;
      searchCanvas.height = searchSliceH;
    }

    // 2. Sample the background scene across the EXACT common viewport area
    const sampleLeft = commonLeft - SHADOW_PAD;
    const sampleTop = navRect.top - SHADOW_PAD;
    const sampleRight = commonRight + SHADOW_PAD;
    const sampleBottom = searchRect.bottom + SHADOW_PAD;

    this.composeSceneForBounds(
      sampleLeft,
      sampleTop,
      sampleRight,
      sampleBottom,
      totalRenderW,
      totalRenderH,
      effDpr,
      [header, searchStrip],
    );



    // 3. Single WebGL pass: upload background & blur
    this.renderer.uploadAndBlur(
      this.sceneCanvas,
      0,
      0,
      totalRenderW,
      totalRenderH,
      this.settings.blurAmount,
    );

    // 4. Render core liquid glass shader for the single combined surface
    // (This produces top bevel on the navbar top, bottom bevel on the searchbar bottom,
    // and completely eliminates the artificial gap and double-bevel seam between them!)
    this.renderer.clear();
    this.renderer.renderGlassPanel(this.settings, combinedW, combinedH, effDpr);

    // 5. Blit continuous overlapping slices to each element's canvas (zero seam)
    const navCtx = navCanvas.getContext("2d");
    if (navCtx) {
      navCtx.clearRect(0, 0, navCanvas.width, navCanvas.height);
      navCtx.drawImage(
        this.renderer.canvas,
        0,
        0,
        totalRenderW,
        navCanvasH,
        0,
        0,
        navCanvas.width,
        navCanvas.height,
      );
    }

    const searchCtx = searchCanvas.getContext("2d");
    if (searchCtx) {
      searchCtx.clearRect(0, 0, searchCanvas.width, searchCanvas.height);
      searchCtx.drawImage(
        this.renderer.canvas,
        0,
        Math.max(0, navSplitY - overlapDpr),
        totalRenderW,
        searchSliceH,
        0,
        0,
        searchCanvas.width,
        searchCanvas.height,
      );
    }
  }

  private canSafelyDrawImage(img: HTMLImageElement): boolean {
    if (!img || !img.complete || img.naturalWidth === 0) return false;
    try {
      const src = img.currentSrc || img.src;
      if (!src) return false;
      if (src.startsWith("data:") || src.startsWith("blob:")) return true;
      const url = new URL(src, window.location.href);
      if (url.origin === window.location.origin) return true;
      if (img.crossOrigin === "anonymous" || img.crossOrigin === "use-credentials") {
        return true;
      }
    } catch {}
    return false;
  }

  private composeSceneForBounds(
    sampleLeft: number,
    sampleTop: number,
    sampleRight: number,
    sampleBottom: number,
    renderW: number,
    renderH: number,
    dpr: number,
    ignoreElements: HTMLElement[],
  ) {
    if (
      this.sceneCanvas.width !== renderW ||
      this.sceneCanvas.height !== renderH
    ) {
      this.sceneCanvas.width = renderW;
      this.sceneCanvas.height = renderH;
    } else {
      this.sceneCtx.clearRect(0, 0, renderW, renderH);
    }

    const ctx = this.sceneCtx;

    // 1. Fill base site background color (#faf9f6)
    const bodyBg =
      window.getComputedStyle(document.body).backgroundColor || "#faf9f6";
    ctx.fillStyle = bodyBg === "rgba(0, 0, 0, 0)" ? "#faf9f6" : bodyBg;
    ctx.fillRect(0, 0, renderW, renderH);

    // 2. Find candidate content containers underneath the glass
    const candidateBlocks = document.querySelectorAll<HTMLElement>(
      ".hero-section, .value-strip, .menu-intro, .notice, .menu-tabs, .food-card, .story-banner, .store-bottom, .order-success, .empty-state, .order-panel, .cart-sheet, .auth-card",
    );

    // Render each intersecting block
    for (let i = 0; i < candidateBlocks.length; i++) {
      const block = candidateBlocks[i];
      if (
        ignoreElements.includes(block) ||
        ignoreElements.some((ig) => ig.contains(block)) ||
        block.closest(".has-liquid-glass")
      ) {
        continue;
      }

      const bRect = block.getBoundingClientRect();

      // Check if block intersects the glass viewport area
      if (
        bRect.right < sampleLeft ||
        bRect.left > sampleRight ||
        bRect.bottom < sampleTop ||
        bRect.top > sampleBottom
      ) {
        continue;
      }

      const destX = Math.round((bRect.left - sampleLeft) * dpr);
      const destY = Math.round((bRect.top - sampleTop) * dpr);
      const destW = Math.round(bRect.width * dpr);
      const destH = Math.round(bRect.height * dpr);

      // Render directly and synchronously using Canvas2D
      // (guarantees text, images, badges, hover transforms and transitions refract in live real-time dynamic)
      let directRendered = false;
      try {
        this.renderBlockDirect(
          ctx,
          block,
          sampleLeft,
          sampleTop,
          sampleRight,
          sampleBottom,
          dpr,
        );
        directRendered = true;
      } catch (err) {
        console.warn("LiquidGlassManager: direct block render fallback:", err);
      }

      if (!directRendered && this.capture) {
        this.capture.drawCachedElement(
          block,
          ctx,
          destX,
          destY,
          destW,
          destH,
        );
      }
    }
  }

  private renderBlockDirect(
    ctx: CanvasRenderingContext2D,
    block: HTMLElement,
    sampleLeft: number,
    sampleTop: number,
    sampleRight: number,
    sampleBottom: number,
    dpr: number,
  ) {
    const bRect = block.getBoundingClientRect();
    const destX = Math.round((bRect.left - sampleLeft) * dpr);
    const destY = Math.round((bRect.top - sampleTop) * dpr);
    const destW = Math.round(bRect.width * dpr);
    const destH = Math.round(bRect.height * dpr);

    if (destW <= 0 || destH <= 0) return;

    // Check block visibility and opacity
    const bStyle = window.getComputedStyle(block);
    if (bStyle.display === "none" || bStyle.visibility === "hidden") return;

    const blockOpacity = parseFloat(bStyle.opacity || "1");
    if (blockOpacity <= 0) return;

    ctx.save();
    if (blockOpacity < 1) {
      ctx.globalAlpha = blockOpacity;
    }

    // Determine if block or context is closed/unavailable (or has CSS filters)
    const isClosedOrUnavailable =
      block.classList.contains("food-card-unavailable") ||
      block.classList.contains("food-grid-closed") ||
      !!block.closest(".food-grid-closed") ||
      !!block.closest(".food-card-unavailable");

    let blockFilter =
      bStyle.filter && bStyle.filter !== "none" ? bStyle.filter : "none";
    if (blockFilter === "none" && isClosedOrUnavailable) {
      blockFilter = "grayscale(0.78)";
    }
    if (blockFilter !== "none") {
      ctx.filter = blockFilter;
    }

    // 1. Draw block background and border
    const bBg = bStyle.backgroundColor;
    const bRadius = (parseFloat(bStyle.borderRadius) || 0) * dpr;
    const bBorderW = (parseFloat(bStyle.borderWidth) || 0) * dpr;
    const hasBlockBg =
      bBg && bBg !== "rgba(0, 0, 0, 0)" && bBg !== "transparent";
    const hasBlockBorder =
      bBorderW > 0 &&
      bStyle.borderColor &&
      bStyle.borderColor !== "transparent" &&
      bStyle.borderColor !== "rgba(0, 0, 0, 0)";

    const isHovered =
      block.matches(":hover") || !!block.querySelector(":hover");

    if (hasBlockBg || hasBlockBorder) {
      ctx.save();
      if (isHovered && block.classList.contains("food-card")) {
        ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
        ctx.shadowBlur = 16 * dpr;
        ctx.shadowOffsetY = 6 * dpr;
      }
      ctx.beginPath();
      if (bRadius > 0 && ctx.roundRect)
        ctx.roundRect(destX, destY, destW, destH, bRadius);
      else ctx.rect(destX, destY, destW, destH);

      if (hasBlockBg) {
        ctx.fillStyle = bBg;
        ctx.fill();
      }
      ctx.shadowColor = "transparent";
      if (hasBlockBorder) {
        ctx.strokeStyle = bStyle.borderColor;
        ctx.lineWidth = bBorderW;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Draw nested styled container boxes (e.g. .food-image, .hero-art-bg, buttons, pills, tags, labels)
    const subBoxes = block.querySelectorAll<HTMLElement>(
      ".food-image, .hero-art-bg, .hero-note, .hero-food-main, .diet-dot, .food-best, .value-strip > div, .menu-tab, button, .add-food, .quantity-picker, .social-rating, .hero-delivery, .closed-menu-label, .notice, .custom-dish-badge, .discount-campaign-label, .food-zilla-pick, .food-image-main-wrap",
    );
    for (let i = 0; i < subBoxes.length; i++) {
      const box = subBoxes[i];
      if (box.closest(".has-liquid-glass")) continue;
      const sRect = box.getBoundingClientRect();
      if (
        sRect.right < sampleLeft ||
        sRect.left > sampleRight ||
        sRect.bottom < sampleTop ||
        sRect.top > sampleBottom
      ) {
        continue;
      }

      const sx = Math.round((sRect.left - sampleLeft) * dpr);
      const sy = Math.round((sRect.top - sampleTop) * dpr);
      const sw = Math.round(sRect.width * dpr);
      const sh = Math.round(sRect.height * dpr);
      if (sw <= 0 || sh <= 0) continue;

      const sStyle = window.getComputedStyle(box);
      const sBg = sStyle.backgroundColor;
      const sRad = (parseFloat(sStyle.borderRadius) || 0) * dpr;
      const sBorderW = (parseFloat(sStyle.borderWidth) || 0) * dpr;
      const hasBg = sBg && sBg !== "rgba(0, 0, 0, 0)" && sBg !== "transparent";
      const hasBorder =
        sBorderW > 0 &&
        sStyle.borderColor &&
        sStyle.borderColor !== "transparent" &&
        sStyle.borderColor !== "rgba(0, 0, 0, 0)";

      ctx.save();
      const sFilter =
        sStyle.filter && sStyle.filter !== "none"
          ? sStyle.filter
          : blockFilter !== "none"
            ? blockFilter
            : isClosedOrUnavailable
              ? "grayscale(0.78)"
              : "none";
      if (sFilter !== "none") {
        ctx.filter = sFilter;
      }
      const sOpacity = parseFloat(sStyle.opacity || "1");
      if (sOpacity < 1 && sOpacity >= 0) {
        ctx.globalAlpha = blockOpacity * sOpacity;
      }

      const stl = (parseFloat(sStyle.borderTopLeftRadius) || parseFloat(sStyle.borderRadius) || 0) * dpr;
      const str = (parseFloat(sStyle.borderTopRightRadius) || parseFloat(sStyle.borderRadius) || 0) * dpr;
      const sbr = (parseFloat(sStyle.borderBottomRightRadius) || parseFloat(sStyle.borderRadius) || 0) * dpr;
      const sbl = (parseFloat(sStyle.borderBottomLeftRadius) || parseFloat(sStyle.borderRadius) || 0) * dpr;

      ctx.beginPath();
      if ((stl > 0 || str > 0 || sbr > 0 || sbl > 0) && ctx.roundRect) {
        ctx.roundRect(sx, sy, sw, sh, [stl, str, sbr, sbl]);
      } else if (sRad > 0 && ctx.roundRect) {
        ctx.roundRect(sx, sy, sw, sh, sRad);
      } else {
        ctx.rect(sx, sy, sw, sh);
      }

      // Check if food-image has a gradient background (e.g. food-red, food-gold)
      if (box.classList.contains("food-red")) {
        const grad = ctx.createRadialGradient(
          sx + sw * 0.53,
          sy + sh * 0.47,
          0,
          sx + sw * 0.53,
          sy + sh * 0.47,
          Math.max(sw, sh) * 0.7,
        );
        grad.addColorStop(0, "#e7ad82");
        grad.addColorStop(0.36, "#d18459");
        grad.addColorStop(1, "#c45a3e");
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (box.classList.contains("food-gold")) {
        const grad = ctx.createRadialGradient(
          sx + sw * 0.5,
          sy + sh * 0.48,
          0,
          sx + sw * 0.5,
          sy + sh * 0.48,
          Math.max(sw, sh) * 0.7,
        );
        grad.addColorStop(0, "#f6d391");
        grad.addColorStop(0.39, "#e9b96e");
        grad.addColorStop(1, "#c88943");
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (hasBg) {
        ctx.fillStyle = sBg;
        ctx.fill();
      }

      if (hasBorder) {
        ctx.strokeStyle = sStyle.borderColor;
        ctx.lineWidth = sBorderW;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Draw all images inside this block
    const imgs = block.querySelectorAll<HTMLImageElement>("img");
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img.complete) {
        img.addEventListener("load", () => this.invalidateAll(), { once: true });
        continue;
      }
      if (img.naturalWidth === 0) continue;
      if (img.closest(".has-liquid-glass")) continue;

      const iRect = img.getBoundingClientRect();
      if (
        iRect.right < sampleLeft ||
        iRect.left > sampleRight ||
        iRect.bottom < sampleTop ||
        iRect.top > sampleBottom
      ) {
        continue;
      }

      const ix = Math.round((iRect.left - sampleLeft) * dpr);
      const iy = Math.round((iRect.top - sampleTop) * dpr);
      const iw = Math.round(iRect.width * dpr);
      const ih = Math.round(iRect.height * dpr);
      if (iw <= 0 || ih <= 0) continue;

      ctx.save();
      const imgStyle = window.getComputedStyle(img);

      // Check if image is contained in an overflow:hidden frame (e.g. .food-image or .food-image-main-wrap)
      const container =
        img.closest<HTMLElement>(".food-image, .food-image-main-wrap") ||
        (img.parentElement && window.getComputedStyle(img.parentElement).overflow === "hidden" ? img.parentElement : null);

      if (container) {
        const cRect = container.getBoundingClientRect();
        const cx = Math.round((cRect.left - sampleLeft) * dpr);
        const cy = Math.round((cRect.top - sampleTop) * dpr);
        const cw = Math.round(cRect.width * dpr);
        const ch = Math.round(cRect.height * dpr);

        const cStyle = window.getComputedStyle(container);
        const pStyle = container.parentElement ? window.getComputedStyle(container.parentElement) : cStyle;

        const ctl = (parseFloat(cStyle.borderTopLeftRadius) || parseFloat(pStyle.borderTopLeftRadius) || parseFloat(bStyle.borderTopLeftRadius) || 14) * dpr;
        const ctr = (parseFloat(cStyle.borderTopRightRadius) || parseFloat(pStyle.borderTopRightRadius) || parseFloat(bStyle.borderTopRightRadius) || 14) * dpr;
        const cbr = (parseFloat(cStyle.borderBottomRightRadius) || parseFloat(pStyle.borderBottomRightRadius) || 0) * dpr;
        const cbl = (parseFloat(cStyle.borderBottomLeftRadius) || parseFloat(pStyle.borderBottomLeftRadius) || 0) * dpr;

        ctx.beginPath();
        if ((ctl > 0 || ctr > 0 || cbr > 0 || cbl > 0) && ctx.roundRect) {
          ctx.roundRect(cx, cy, cw, ch, [ctl, ctr, cbr, cbl]);
        } else if (ctx.roundRect) {
          ctx.roundRect(cx, cy, cw, ch, 0);
        } else {
          ctx.rect(cx, cy, cw, ch);
        }
        ctx.clip();
      } else {
        const imgRadius = (parseFloat(imgStyle.borderRadius) || 0) * dpr;
        if (imgRadius > 0 && ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(ix, iy, iw, ih, imgRadius);
          ctx.clip();
        }
      }

      const imgFilter =
        imgStyle.filter && imgStyle.filter !== "none"
          ? imgStyle.filter
          : blockFilter !== "none"
            ? blockFilter
            : isClosedOrUnavailable
              ? "grayscale(0.78)"
              : "none";
      if (imgFilter !== "none") {
        ctx.filter = imgFilter;
      }
      const imgOpacity = parseFloat(imgStyle.opacity || "1");
      if (imgOpacity < 1 && imgOpacity >= 0) {
        ctx.globalAlpha = blockOpacity * imgOpacity;
      }

      // Check if image can be drawn without tainting the canvas
      if (!this.canSafelyDrawImage(img)) {
        ctx.fillStyle = imgStyle.backgroundColor || "#ece9e2";
        ctx.fillRect(ix, iy, iw, ih);
        ctx.restore();
        continue;
      }

      try {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (
          nw > 0 &&
          nh > 0 &&
          (imgStyle.objectFit === "cover" || imgStyle.objectFit === "")
        ) {
          const renderAspect = iw / ih;
          const naturalAspect = nw / nh;
          let sx = 0,
            sy = 0,
            sw = nw,
            sh = nh;
          if (naturalAspect > renderAspect) {
            sw = nh * renderAspect;
            sx = (nw - sw) / 2;
          } else {
            sh = nw / renderAspect;
            sy = (nh - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, ix, iy, iw, ih);
        } else {
          ctx.drawImage(img, ix, iy, iw, ih);
        }
      } catch {}
      ctx.restore();
    }

    // 4. Draw all text nodes using TreeWalker + Range for exact layout matching
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    const range = document.createRange();

    // Detect if block has a CSS scale factor applied (e.g. scale(1.02) on hover)
    const blockScale =
      block.offsetWidth > 0 && bRect.width > 0
        ? bRect.width / block.offsetWidth
        : 1;

    while (node) {
      const text = (node.textContent || "").trim();
      if (text) {
        const parent = node.parentElement;
        if (parent && !parent.closest(".has-liquid-glass")) {
          try {
            range.selectNodeContents(node);
            const clientRects = range.getClientRects();

            if (clientRects.length > 0) {
              const pStyle = window.getComputedStyle(parent);
              if (
                pStyle.display !== "none" &&
                pStyle.visibility !== "hidden" &&
                parseFloat(pStyle.opacity || "1") > 0
              ) {
                const baseFontSize = parseFloat(pStyle.fontSize) || 14;
                const fontSize = baseFontSize * blockScale * dpr;
                const fontWeight = pStyle.fontWeight || "400";
                const fontFamily =
                  pStyle.fontFamily || "Inter, -apple-system, sans-serif";
                ctx.font = `${pStyle.fontStyle || "normal"} ${fontWeight} ${fontSize}px ${fontFamily}`;
                ctx.fillStyle = pStyle.color || "#1a1a24";
                ctx.textBaseline = "top";

                let renderText = text;
                if (pStyle.textTransform === "uppercase")
                  renderText = renderText.toUpperCase();
                else if (pStyle.textTransform === "lowercase")
                  renderText = renderText.toLowerCase();

                for (let r = 0; r < clientRects.length; r++) {
                  const cRect = clientRects[r];
                  if (
                    cRect.right >= sampleLeft &&
                    cRect.left <= sampleRight &&
                    cRect.bottom >= sampleTop &&
                    cRect.top <= sampleBottom
                  ) {
                    const tx = Math.round((cRect.left - sampleLeft) * dpr);
                    const ty = Math.round((cRect.top - sampleTop) * dpr);
                    const tw = Math.round(cRect.width * dpr);
                    const th = Math.round(cRect.height * dpr);

                    if (clientRects.length === 1) {
                      ctx.fillText(renderText, tx, ty);
                    } else {
                      ctx.save();
                      ctx.beginPath();
                      ctx.rect(tx, ty, tw, th + 4);
                      ctx.clip();
                      ctx.fillText(renderText, tx, ty);
                      ctx.restore();
                    }
                  }
                }
              }
            }
          } catch {}
        }
      }
      node = walker.nextNode();
    }
    ctx.restore();
  }
}

export const liquidGlassManager = new LiquidGlassManager();
