import type { StealthOptions, StealthPreset, StealthProfile } from './types.js';

/**
 * Chromium launch flags calibrated for anti-detection while keeping web standards intact.
 */
export const STEALTH_LAUNCH_FLAGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=AutomationControlled,IsolateOrigins,site-per-process,Translate',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--lang=en-US,en;q=0.9',
];

const CHROME_MAJOR = '131';
const CHROME_FULL = '131.0.6778.109';

interface PresetTemplate {
  preset: Exclude<StealthPreset, 'auto'>;
  userAgent: string;
  platform: string;
  platformName: string;
  platformVersion: string;
  architecture: string;
  webglOptions: Array<{ vendor: string; renderer: string }>;
}

const PRESET_TEMPLATES: Record<Exclude<StealthPreset, 'auto'>, PresetTemplate> = {
  macos: {
    preset: 'macos',
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`,
    platform: 'MacIntel',
    platformName: 'macOS',
    platformVersion: '14.6.0',
    architecture: 'arm',
    webglOptions: [
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M3, OpenGL 4.1)' },
    ],
  },
  windows: {
    preset: 'windows',
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`,
    platform: 'Win32',
    platformName: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    webglOptions: [
      {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      {
        vendor: 'Google Inc. (AMD)',
        renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
    ],
  },
  linux: {
    preset: 'linux',
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL} Safari/537.36`,
    platform: 'Linux x86_64',
    platformName: 'Linux',
    platformVersion: '6.8.0',
    architecture: 'x86',
    webglOptions: [
      {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
      },
      {
        vendor: 'Google Inc. (AMD)',
        renderer: 'ANGLE (AMD, AMD Radeon Graphics (radeonsi, navi10), OpenGL 4.6)',
      },
    ],
  },
};

const TIMEZONE_POOL = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
];

const CONCURRENCY_POOL = [4, 8];
const MEMORY_POOL = [4, 8];

export function hashSessionSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveStealthProfile(
  sessionId: string,
  options: StealthOptions = {}
): StealthProfile {
  const seed = options.seed ?? hashSessionSeed(sessionId);
  const presetOrder: Array<Exclude<StealthPreset, 'auto'>> = ['windows', 'macos', 'linux'];

  const chosenPreset: Exclude<StealthPreset, 'auto'> =
    options.preset && options.preset !== 'auto'
      ? options.preset
      : presetOrder[seed % presetOrder.length];

  const tpl = PRESET_TEMPLATES[chosenPreset];
  const locale = options.locale || 'en-US';
  const baseLang = locale.split('-')[0] || 'en';
  const languages = baseLang === locale ? [locale] : [locale, baseLang];
  const acceptLanguage = baseLang === locale ? `${locale};q=0.9` : `${locale},${baseLang};q=0.9`;

  const gpu = tpl.webglOptions[(seed >>> 4) % tpl.webglOptions.length];
  const timezone = options.timezone || TIMEZONE_POOL[(seed >>> 8) % TIMEZONE_POOL.length];
  const hardwareConcurrency = CONCURRENCY_POOL[(seed >>> 12) % CONCURRENCY_POOL.length];
  const deviceMemory = MEMORY_POOL[(seed >>> 13) % MEMORY_POOL.length];
  const userAgent = options.userAgent || tpl.userAgent;

  const brands = [
    { brand: 'Chromium', version: CHROME_MAJOR },
    { brand: 'Google Chrome', version: CHROME_MAJOR },
    { brand: 'Not;A=Brand', version: '24' },
  ];

  const fullVersionList = [
    { brand: 'Chromium', version: CHROME_FULL },
    { brand: 'Google Chrome', version: CHROME_FULL },
    { brand: 'Not;A=Brand', version: '24.0.0.0' },
  ];

  return {
    seed,
    preset: chosenPreset,
    userAgent,
    platform: tpl.platform,
    acceptLanguage,
    languages,
    locale,
    timezone,
    hardwareConcurrency,
    deviceMemory,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    userAgentMetadata: {
      brands,
      fullVersionList,
      platform: tpl.platformName,
      platformVersion: tpl.platformVersion,
      architecture: tpl.architecture,
      model: '',
      mobile: false,
      bitness: '64',
    },
  };
}

/**
 * Generates an initialization script tailored to the session's StealthProfile.
 * Safe against double-injection and preserves standard DOM API contracts.
 */
export function buildStealthScript(profile: StealthProfile): string {
  const serialized = JSON.stringify({
    seed: profile.seed,
    languages: profile.languages,
    platform: profile.platform,
    hardwareConcurrency: profile.hardwareConcurrency,
    deviceMemory: profile.deviceMemory,
    webglVendor: profile.webglVendor,
    webglRenderer: profile.webglRenderer,
  });

  return `(function(cfg) {
  if (window.__openBrowserGridStealth) return;
  Object.defineProperty(window, '__openBrowserGridStealth', {
    value: true,
    enumerable: false,
    configurable: false
  });

  // 1. Seeded deterministic PRNG (Mulberry32) so fingerprints stay stable within a session
  function createPrng(seed) {
    let a = seed >>> 0;
    return function() {
      let t = (a += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2. Remove navigator.webdriver on both Navigator.prototype and instance
  try {
    const navProto = Object.getPrototypeOf(navigator);
    Object.defineProperty(navProto, 'webdriver', {
      get: () => undefined,
      configurable: true
    });
  } catch {}

  // 3. Hardware & language consistency
  const defineNavGetter = (prop, value) => {
    try {
      Object.defineProperty(navigator, prop, {
        get: () => value,
        configurable: true
      });
    } catch {}
  };
  defineNavGetter('languages', Object.freeze(cfg.languages.slice()));
  defineNavGetter('language', cfg.languages[0]);
  defineNavGetter('platform', cfg.platform);
  defineNavGetter('hardwareConcurrency', cfg.hardwareConcurrency);
  defineNavGetter('deviceMemory', cfg.deviceMemory);

  // 4. Mock chrome.runtime and chrome.app when missing in headless mode
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'DISABLED', INSTALLED: 'INSTALLED', NOT_INSTALLED: 'NOT_INSTALLED' },
      RunningState: { CANNOT_RUN: 'CANNOT_RUN', READY_TO_RUN: 'READY_TO_RUN', RUNNING: 'RUNNING' }
    };
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update'
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic'
      },
      PlatformArch: {
        ARM: 'arm',
        ARM64: 'arm64',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64'
      },
      PlatformOs: {
        ANDROID: 'android',
        CROS: 'cros',
        LINUX: 'linux',
        MAC: 'mac',
        OPENBSD: 'openbsd',
        WIN: 'win'
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update',
        THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available'
      }
    };
  }

  // 5. Realistic plugins and mimeTypes
  const pluginData = [
    {
      name: 'PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
    },
    {
      name: 'Chrome PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [{ type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
    },
    {
      name: 'Chromium PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: []
    }
  ];
  defineNavGetter('plugins', pluginData);
  defineNavGetter('mimeTypes', [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginData[0] },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginData[1] }
  ]);

  // 6. Mask Permissions.query for notifications
  if (navigator.permissions && typeof navigator.permissions.query === 'function') {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function(parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({
          state: typeof Notification !== 'undefined' ? Notification.permission : 'default',
          onchange: null
        });
      }
      return origQuery(parameters);
    };
  }

  // 7. Outer window dimensions fallback (headless Chrome often reports 0)
  try {
    if (window.outerWidth === 0) {
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth || 1280,
        configurable: true
      });
    }
    if (window.outerHeight === 0) {
      Object.defineProperty(window, 'outerHeight', {
        get: () => (window.innerHeight ? window.innerHeight + 85 : 885),
        configurable: true
      });
    }
  } catch {}

  // 8. WebGL UNMASKED_VENDOR_WEBGL & UNMASKED_RENDERER_WEBGL masking
  const patchWebGL = (ctor) => {
    if (!ctor || !ctor.prototype || typeof ctor.prototype.getParameter !== 'function') return;
    const origGetParameter = ctor.prototype.getParameter;
    ctor.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return cfg.webglVendor;
      if (parameter === 37446) return cfg.webglRenderer;
      return origGetParameter.apply(this, arguments);
    };
  };
  patchWebGL(window.WebGLRenderingContext);
  patchWebGL(window.WebGL2RenderingContext);

  // 9. Deterministic LSB Canvas fingerprint noise via offscreen clone (preserves visible canvas)
  const addCanvasNoise = (imageData) => {
    const prng = createPrng(cfg.seed ^ (imageData.width << 16) ^ imageData.height);
    const data = imageData.data;
    const step = Math.max(4, Math.floor(data.length / 64) * 4);
    for (let i = 0; i < data.length; i += step) {
      if (data[i + 3] > 0) {
        const delta = prng() > 0.5 ? 1 : -1;
        const next = data[i] + delta;
        data[i] = next < 0 ? 0 : next > 255 ? 255 : next;
      }
    }
  };

  if (typeof HTMLCanvasElement !== 'undefined' && typeof CanvasRenderingContext2D !== 'undefined') {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;

    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
      const imageData = origGetImageData.apply(this, arguments);
      try {
        if (imageData && imageData.width > 0 && imageData.height > 0) {
          addCanvasNoise(imageData);
        }
      } catch {}
      return imageData;
    };

    const getNoisedClone = (canvas) => {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      const clone = document.createElement('canvas');
      clone.width = canvas.width;
      clone.height = canvas.height;
      const cloneCtx = clone.getContext('2d');
      if (!cloneCtx) return null;
      const snapshot = origGetImageData.call(ctx, 0, 0, canvas.width, canvas.height);
      addCanvasNoise(snapshot);
      cloneCtx.putImageData(snapshot, 0, 0);
      return clone;
    };

    HTMLCanvasElement.prototype.toDataURL = function() {
      try {
        const clone = getNoisedClone(this);
        if (clone) return origToDataURL.apply(clone, arguments);
      } catch {}
      return origToDataURL.apply(this, arguments);
    };

    if (typeof origToBlob === 'function') {
      HTMLCanvasElement.prototype.toBlob = function() {
        try {
          const clone = getNoisedClone(this);
          if (clone) return origToBlob.apply(clone, arguments);
        } catch {}
        return origToBlob.apply(this, arguments);
      };
    }
  }

  // 10. AudioContext seeded fingerprint jitter
  if (typeof AudioBuffer !== 'undefined' && typeof AudioBuffer.prototype.getChannelData === 'function') {
    const patchedBuffers = new WeakSet();
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function() {
      const channel = origGetChannelData.apply(this, arguments);
      try {
        if (channel && channel.length > 0 && !patchedBuffers.has(channel)) {
          patchedBuffers.add(channel);
          const prng = createPrng(cfg.seed ^ channel.length);
          const step = Math.max(1, Math.floor(channel.length / 32));
          for (let i = 0; i < channel.length; i += step) {
            channel[i] = channel[i] + (prng() - 0.5) * 1e-6;
          }
        }
      } catch {}
      return channel;
    };
  }
})(${serialized});`;
}

export const STEALTH_INJECTION_SCRIPT = buildStealthScript(
  resolveStealthProfile('default', { preset: 'macos' })
);
