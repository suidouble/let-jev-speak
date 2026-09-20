import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  // Loaded with an empty prefix so non-VITE_ vars are visible here, in the
  // config, which runs in Node. Only the VITE_-prefixed ones reach the browser.
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.TYPESAFE_API_KEY;

  if (!apiKey) {
    console.warn(
      '\n  TYPESAFE_API_KEY is not set — Jev will not answer.' +
      '\n  Copy .env.example to .env and put your key in it.\n',
    );
  }

  return {
    plugins: [vue()],

    resolve: {
      alias: {
        // The icon components in LetJevSpeak.vue are declared with `template:`
        // strings, which need the runtime template compiler. The default
        // bundler build omits it and renders nothing.
        vue: 'vue/dist/vue.esm-bundler.js',
      },
    },

    // The library lives one level up, outside this Vite root.
    server: {
      port: 5173,
      strictPort: true,
      fs: { allow: ['..'] },

      /**
       * api.typesafe.ai sends no Access-Control-Allow-Origin for any origin
       * (checked: localhost, console.typesafe.ai, docs.typesafe.ai), so a
       * browser cannot call it directly — the request is blocked before the
       * response is ever read.
       *
       * This proxy makes the call same-origin. It also means the API key stays
       * in Node and never enters the bundle: the browser talks to /api, and
       * the Authorization header is attached here.
       */
      proxy: {
        '/api': {
          target: 'https://api.typesafe.ai',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('Authorization', `Bearer ${apiKey}`);
            });
          },
        },
      },
    },

    define: {
      // The library falls back to process.env when no key is passed. We always
      // pass one, so this is only here to keep a ReferenceError from masking
      // the library's own error message.
      'process.env': '({})',
    },
  };
});
