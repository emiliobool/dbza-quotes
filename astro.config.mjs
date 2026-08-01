import { defineConfig } from "astro/config";

export default defineConfig({
  // set to the real URL after the first Pages deploy (used for canonical/OG URLs)
  site: "https://dbza-quotes.pages.dev",
  output: "static",
  build: { format: "directory" },
  redirects: { "/browse/": "/quotes/" },
});
