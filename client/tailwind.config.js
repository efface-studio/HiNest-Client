/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    // breakpoint 재정의 — iPad portrait(834px) 까지 모바일 레이아웃으로 끌어들이기 위해
    // md 기준을 기본 768→1024 로 올림. 이렇게 하면 사이드바·하단탭·상단 채팅/알람/프로필
    // 등의 'md:' 분기들이 iPad 에서도 모바일과 같게 동작한다. 일반 데스크탑(1280+)은 영향 없음.
    //   sm = 640  (기본)
    //   md = 1024 (변경: 768→1024)
    //   lg = 1280 (변경: 1024→1280)
    //   xl = 1536 (기본)
    screens: {
      sm: "640px",
      md: "1024px",
      lg: "1280px",
      xl: "1536px",
      "2xl": "1920px",
    },
    extend: {
      colors: {
        // Primary blue (NAVER WORKS 의 UI 느낌은 유지, 컬러는 블루)
        brand: {
          50: "#EEF3FF",
          100: "#D9E3FF",
          200: "#B3C6FF",
          300: "#8AA6FF",
          400: "#5F83FB",
          500: "#3B5CF0",
          600: "#2547DB",
          700: "#1D3AB8",
          800: "#1A2F8C",
          900: "#17266E",
        },
        accent: {
          50: "#E8F1FE",
          100: "#C5DCFB",
          500: "#2962FF",
          600: "#1F51E0",
          700: "#1A43BF",
        },
        // 뉴트럴 (라이트 기준)
        ink: {
          950: "#0B0D12",
          900: "#14161B",
          800: "#1F232A",
          700: "#343942",
          600: "#4A5058",
          500: "#6B7280",
          400: "#8E959E",
          300: "#B9BEC6",
          200: "#DDE0E4",
          150: "#E8EAED",
          100: "#EFF1F3",
          50: "#F7F8FA",
          25: "#FAFBFC",
        },
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
        info: "#0EA5E9",
      },
      boxShadow: {
        flat: "0 0 0 1px rgba(23,25,31,.06)",
        card: "0 1px 2px rgba(23,25,31,.04), 0 2px 6px rgba(23,25,31,.04)",
        raised: "0 2px 8px rgba(23,25,31,.06), 0 1px 2px rgba(23,25,31,.08)",
        pop: "0 10px 28px rgba(23,25,31,.10), 0 2px 6px rgba(23,25,31,.06)",
      },
      borderRadius: {
        md: "8px",
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
      },
      fontFamily: {
        sans: [
          "Pretendard Variable",
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "system-ui",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Monaco",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "14px" }],
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["13px", { lineHeight: "18px" }],
        base: ["14px", { lineHeight: "20px" }],
        md: ["15px", { lineHeight: "22px" }],
        lg: ["17px", { lineHeight: "24px" }],
        xl: ["20px", { lineHeight: "28px" }],
        "2xl": ["24px", { lineHeight: "32px" }],
      },
    },
  },
  plugins: [],
};
