import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    transparent: "transparent",
    current: "currentColor",
    extend: {
      colors: {
        // Surfaces — codeprism dark palette
        background: "#0f1117",
        surface: "#161b22",
        surface2: "#1c2333",
        border: "#30363d",
        border2: "#21262d",

        // Text
        "text-primary": "#e1e4e8",
        "text-secondary": "#c9d1d9",
        "text-muted": "#8b949e",
        "text-ghost": "#484f58",

        // Accents
        accent: "#58a6ff",
        "accent-hover": "#79b8ff",
        success: "#3fb950",
        warning: "#d29922",
        danger: "#f85149",
        purple: "#bc8cff",

        // Tremor compatibility (dark palette)
        tremor: {
          brand: {
            faint: "#0B1229",
            muted: "#172554",
            subtle: "#1e3a8a",
            DEFAULT: "#58a6ff",
            emphasis: "#79b8ff",
            inverted: "#030712",
          },
          background: {
            muted: "#131A2B",
            subtle: "#1c2333",
            DEFAULT: "#161b22",
            emphasis: "#374151",
          },
          border: {
            DEFAULT: "#30363d",
          },
          ring: {
            DEFAULT: "#30363d",
          },
          content: {
            subtle: "#484f58",
            DEFAULT: "#8b949e",
            emphasis: "#e1e4e8",
            strong: "#f0f6fc",
            inverted: "#000000",
          },
        },
        "dark-tremor": {
          brand: {
            faint: "#0B1229",
            muted: "#172554",
            subtle: "#1e3a8a",
            DEFAULT: "#58a6ff",
            emphasis: "#79b8ff",
            inverted: "#030712",
          },
          background: {
            muted: "#0f1117",
            subtle: "#161b22",
            DEFAULT: "#0f1117",
            emphasis: "#374151",
          },
          border: {
            DEFAULT: "#30363d",
          },
          ring: {
            DEFAULT: "#30363d",
          },
          content: {
            subtle: "#484f58",
            DEFAULT: "#8b949e",
            emphasis: "#e1e4e8",
            strong: "#f0f6fc",
            inverted: "#000000",
          },
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"SF Mono"',
          '"Fira Code"',
          '"Fira Mono"',
          '"Roboto Mono"',
          "monospace",
        ],
      },
      boxShadow: {
        "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "tremor-card": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "tremor-dropdown": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        "dark-tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "dark-tremor-card": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
        "dark-tremor-dropdown": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      },
      borderRadius: {
        "tremor-small": "0.375rem",
        "tremor-default": "0.5rem",
        "tremor-full": "9999px",
      },
      fontSize: {
        "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ["hover", "ui-selected"],
    },
    {
      pattern:
        /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],
  plugins: [],
};

export default config;
