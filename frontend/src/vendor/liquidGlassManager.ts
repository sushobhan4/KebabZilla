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
  blurAmount: 0.3,
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
  private lightX = 35;
  private lightY = 25;

  constructor() {
    this.loadFromStorage();
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
    this.applyCSSVariables();
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
    try {
      this.renderer = new GlassRenderer();
    } catch (err) {
      console.warn(
        "LiquidGlassManager: WebGL initialization failed, fallback to CSS glass:",
        err,
      );
      return;
    }

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
    window.addEventListener("mousemove", this.handleMouseMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.handleInteraction, {
      passive: true,
    });
    window.addEventListener("click", this.handleInteraction, { passive: true });
    window.addEventListener("input", this.handleInteraction, { passive: true });

    this.applyCSSVariables();
    setTimeout(() => this.prewarmVisibleCaptures(), 200);
    this.renderLoop();
  }

  private prewarmVisibleCaptures() {
    if (!this.capture) return;
    // Exclude .menu-tabs so it is never frozen into a static snapshot
    const blocks = document.querySelectorAll<HTMLElement>(
      ".hero-section, .value-strip, .food-card",
    );
    for (let i = 0; i < Math.min(blocks.length, 12); i++) {
      const b = blocks[i];
      if (b && !b.closest(".has-liquid-glass")) {
        this.capture.captureElement(b).catch(() => {});
      }
    }
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
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("pointerdown", this.handleInteraction);
    window.removeEventListener("click", this.handleInteraction);
    window.removeEventListener("input", this.handleInteraction);

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

  public requestRender() {
    this.isDirty = true;
    this.dirtyFramesRemaining = 12;
  }

  public invalidateAll() {
    if (this.capture) {
      this.capture.cache.clear();
    }
    this.isDirty = true;
    this.dirtyFramesRemaining = 15;
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
    this.isDirty = true;
    this.dirtyFramesRemaining = 15;
  };

  private handleScrollOrResize = () => {
    this.isDirty = true;
    this.dirtyFramesRemaining = 8;
  };

  private handleMouseMove = (e: MouseEvent) => {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    this.lightX = Math.round((e.clientX / w) * 100);
    this.lightY = Math.round((e.clientY / h) * 100);
    document.documentElement.style.setProperty("--light-x", `${this.lightX}%`);
    document.documentElement.style.setProperty("--light-y", `${this.lightY}%`);
  };

  private applyCSSVariables() {
    const root = document.documentElement;
    root.style.setProperty("--glass-opacity", `${this.settings.opacity}`);
    root.style.setProperty(
      "--glass-blur",
      `${Math.round(this.settings.blurAmount * 50)}px`,
    );
    root.style.setProperty(
      "--glass-specular-intensity",
      `${this.settings.specular}`,
    );
    root.style.setProperty(
      "--glass-corner-radius",
      `${this.settings.cornerRadius}px`,
    );
    if (this.settings.tintColor) {
      root.style.setProperty("--glass-tint-color", this.settings.tintColor);
    }
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

    if (this.settings.applyToSearch) {
      const searchStrip = document.querySelector<HTMLElement>(
        ".storefront-sticky-controls",
      );
      if (searchStrip) targets.push(searchStrip);
    } else {
      const searchStrip = document.querySelector<HTMLElement>(
        ".storefront-sticky-controls",
      );
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

  private renderLoop = () => {
    if (!this.isRunning) return;

    this.discoverElements();

    if ((this.isDirty || this.dirtyFramesRemaining > 0) && this.renderer) {
      if (this.dirtyFramesRemaining > 0) {
        this.dirtyFramesRemaining--;
      }
      this.isDirty = false;
      this.renderElements();
    }

    this.rafId = requestAnimationFrame(this.renderLoop);
  };

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
    let isStuckTogether = false;
    let navRect: DOMRect | null = null;
    let searchRect: DOMRect | null = null;

    if (
      header &&
      searchStrip &&
      this.elementCanvases.has(header) &&
      this.elementCanvases.has(searchStrip)
    ) {
      navRect = header.getBoundingClientRect();
      searchRect = searchStrip.getBoundingClientRect();
      // When the search controls stick directly under the navbar (within 3px tolerance)
      const gap = searchRect.top - navRect.bottom;
      if (Math.abs(gap) <= 3 && navRect.height > 0 && searchRect.height > 0) {
        isStuckTogether = true;
      }
    }

    if (isStuckTogether && header && searchStrip && navRect && searchRect) {
      header.classList.add("is-stuck-together");
      searchStrip.classList.add("is-stuck-together");

      this.renderStuckPair(header, searchStrip, navRect, searchRect, dpr);
      return;
    }

    if (header) header.classList.remove("is-stuck-together");
    if (searchStrip) searchStrip.classList.remove("is-stuck-together");

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

    // Vertical alignment:
    // navCanvas: top shadow padding, flush bottom edge at header boundary (navRect.bottom)
    navCanvas.style.top = `-${SHADOW_PAD}px`;
    navCanvas.style.height = `${navH + SHADOW_PAD}px`;
    const navSplitY = Math.round((SHADOW_PAD + navH) * effDpr);
    if (navCanvas.width !== totalRenderW || navCanvas.height !== navSplitY) {
      navCanvas.width = totalRenderW;
      navCanvas.height = navSplitY;
    }

    // searchCanvas: top flush at navRect.bottom, bottom shadow padding
    const searchTopInSearchStrip = Math.round(navRect.bottom - searchRect.top);
    searchCanvas.style.top = `${searchTopInSearchStrip}px`;
    const searchSliceH = Math.round((searchVisibleH + SHADOW_PAD) * effDpr);
    searchCanvas.style.height = `${searchVisibleH + SHADOW_PAD}px`;
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

    // 5. Blit continuous slices to each element's canvas
    const navCtx = navCanvas.getContext("2d");
    if (navCtx) {
      navCtx.clearRect(0, 0, navCanvas.width, navCanvas.height);
      navCtx.drawImage(
        this.renderer.canvas,
        0,
        0,
        totalRenderW,
        navSplitY,
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
        navSplitY,
        totalRenderW,
        searchSliceH,
        0,
        0,
        searchCanvas.width,
        searchCanvas.height,
      );
    }
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

    // 2. Find candidate content containers underneath the glass (leaf elements only, no wrapper sections)
    const candidateBlocks = document.querySelectorAll<HTMLElement>(
      ".hero-section, .value-strip, .menu-intro, .menu-tabs, .food-card, .story-banner, .store-bottom, .order-success",
    );

    // Filter out nested candidate blocks to prevent duplicate drawing
    const uniqueBlocks: HTMLElement[] = [];
    for (let i = 0; i < candidateBlocks.length; i++) {
      const b = candidateBlocks[i];
      if (
        ignoreElements.includes(b) ||
        ignoreElements.some((ig) => ig.contains(b)) ||
        b.closest(".has-liquid-glass")
      ) {
        continue;
      }
      let isNested = false;
      for (let j = 0; j < candidateBlocks.length; j++) {
        if (i !== j && candidateBlocks[j].contains(b)) {
          isNested = true;
          break;
        }
      }
      if (!isNested) {
        uniqueBlocks.push(b);
      }
    }

    // Render each intersecting block
    for (let i = 0; i < uniqueBlocks.length; i++) {
      const block = uniqueBlocks[i];
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

      let drawnWithCache = false;
      // Do NOT use static cached snapshots for dynamic/scrolling elements like .menu-tabs and .food-card
      // Always render live from DOM so images, badges, and active button highlights update with 0ms delay!
      const isDynamic =
        block.classList.contains("menu-tabs") ||
        block.classList.contains("food-card") ||
        !!block.querySelector(".menu-tabs");

      if (this.capture && !isDynamic) {
        drawnWithCache = this.capture.drawCachedElement(
          block,
          ctx,
          destX,
          destY,
          destW,
          destH,
        );
        if (!drawnWithCache) {
          this.capture.captureElement(block).catch(() => {});
        }
      }

      // If not yet cached by html-to-image or if dynamic, immediately draw with direct Canvas2D
      // (guarantees text, images, and card styling refract with zero blank frames)
      if (!drawnWithCache) {
        this.renderBlockDirect(
          ctx,
          block,
          sampleLeft,
          sampleTop,
          sampleRight,
          sampleBottom,
          dpr,
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

    // 1. Draw block background and border
    const bStyle = window.getComputedStyle(block);
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

    if (hasBlockBg || hasBlockBorder) {
      ctx.save();
      ctx.beginPath();
      if (bRadius > 0 && ctx.roundRect)
        ctx.roundRect(destX, destY, destW, destH, bRadius);
      else ctx.rect(destX, destY, destW, destH);

      if (hasBlockBg) {
        ctx.fillStyle = bBg;
        ctx.fill();
      }
      if (hasBlockBorder) {
        ctx.strokeStyle = bStyle.borderColor;
        ctx.lineWidth = bBorderW;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. Draw nested styled container boxes (e.g. .food-image, .hero-art-bg, buttons, pills, tags)
    const subBoxes = block.querySelectorAll<HTMLElement>(
      ".food-image, .hero-art-bg, .hero-note, .hero-food-main, .diet-dot, .food-best, .value-strip > div, .menu-tab, button, .add-food, .quantity-picker, .social-rating, .hero-delivery",
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

      if (hasBg || hasBorder) {
        ctx.save();
        ctx.beginPath();
        if (sRad > 0 && ctx.roundRect) ctx.roundRect(sx, sy, sw, sh, sRad);
        else ctx.rect(sx, sy, sw, sh);

        if (hasBg) {
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
    }

    // 3. Draw all images inside this block
    const imgs = block.querySelectorAll<HTMLImageElement>("img");
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img.complete || img.naturalWidth === 0) continue;
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
      const imgRadius = (parseFloat(imgStyle.borderRadius) || 0) * dpr;
      if (imgRadius > 0 && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(ix, iy, iw, ih, imgRadius);
        ctx.clip();
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
                const fontSize = (parseFloat(pStyle.fontSize) || 14) * dpr;
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
  }
}

export const liquidGlassManager = new LiquidGlassManager();
