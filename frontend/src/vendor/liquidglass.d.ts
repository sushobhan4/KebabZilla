export interface GlassConfig {
  blurAmount: number;
  refraction: number;
  chromAberration: number;
  edgeHighlight: number;
  specular: number;
  fresnel: number;
  distortion: number;
  cornerRadius: number;
  zRadius: number;
  opacity: number;
  saturation: number;
  tintStrength: number;
  brightness: number;
  shadowOpacity: number;
  shadowSpread: number;
  shadowOffsetY: number;
  floating: boolean;
  button: boolean;
  bevelMode: number;
  tintColor?: string;
  tintR?: number;
  tintG?: number;
  tintB?: number;
}

export declare const DEFAULTS: GlassConfig;

export declare class GlassRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  width: number;
  height: number;
  contextLost: boolean;

  constructor();

  resize(w: number, h: number): void;
  clear(): void;
  destroy(): void;

  uploadAndBlur(
    source: HTMLCanvasElement | TexImageSource,
    cropX: number,
    cropY: number,
    cropW: number,
    cropH: number,
    blurAmount: number
  ): void;

  renderGlassPanel(
    config: GlassConfig,
    elementW: number,
    elementH: number,
    dpr: number
  ): void;
}

export declare class HtmlCapture {
  readonly root: HTMLElement;
  readonly cache: Map<HTMLElement, { canvas: HTMLCanvasElement; w: number; h: number }>;
  dpr: number;
  onCacheUpdate: ((element: HTMLElement) => void) | null;

  constructor(root: HTMLElement);

  prefetchFontEmbedCSS(): Promise<void>;
  captureElement(element: HTMLElement, force?: boolean): Promise<void>;
  drawCachedElement(
    element: HTMLElement,
    targetCtx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): boolean;
  captureToCanvas(
    element: HTMLElement,
    cssW: number,
    cssH: number,
    hideNodes?: HTMLElement[] | null
  ): Promise<HTMLCanvasElement | null>;
  invalidateCache(element: HTMLElement): void;
  destroy(): void;
}

export interface LiquidGlassOptions {
  root: HTMLElement;
  glassElements?: NodeListOf<HTMLElement> | HTMLElement[];
  defaults?: Partial<GlassConfig>;
}

export declare class LiquidGlass {
  static init(options: LiquidGlassOptions): Promise<LiquidGlass>;
  destroy(): void;
  markChanged(element: HTMLElement): void;
}

export declare function invalidateFontEmbedCache(): void;
