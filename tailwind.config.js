/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B2340",
        paper: "#F3F4F8",
        card: "#FFFFFF",
        line: "#E2E5ED",
        sidebar: "#1B2140",
        highlight: "#FFC93C",
        coral: "#FF6B5B",
        sage: "#6B9080",
        lavender: "#8C8FE0",
      },
      // Классы font-500/600/700/800 используются по всему приложению, но в Tailwind их по умолчанию нет —
      // без этого все заголовки рисовались обычным начертанием
      fontWeight: {
        500: "500",
        600: "600",
        700: "700",
        800: "800",
      },
      fontFamily: {
        display: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        // Мягкая «бумажная» тень — только для того, что лежит поверх (модалки, обложки тетрадей),
        // обычные карточки по-прежнему отделяются тонкой линией
        lift: "0 1px 2px rgb(27 35 64 / 0.06), 0 8px 24px -8px rgb(27 35 64 / 0.18)",
        pop: "0 24px 64px -16px rgb(27 35 64 / 0.35)",
      },
    },
  },
  plugins: [],
};
