/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1B2340",
        paper: "#F7F8F5",
        card: "#FFFFFF",
        line: "#DCE0E8",
        sidebar: "#1F2540",
        highlight: "#FFC93C",
        coral: "#FF6B5B",
        sage: "#6B9080",
        lavender: "#8C8FE0",
      },
      fontFamily: {
        display: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
      borderRadius: {
        card: "10px",
      },
    },
  },
  plugins: [],
};
