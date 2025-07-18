/**
 * PostCSS configuration.  Tailwind and Autoprefixer are used to
 * process our global styles.  Tailwind 4.1 includes a number of
 * performance improvements and new utilities【893375231563547†L23-L47】, but its usage here remains
 * straightforward.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}