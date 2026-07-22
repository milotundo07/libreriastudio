{
  "name": "biblioteca-dello-studio",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Catalogo personale local-first per libri, edizioni ed esemplari.",
  "scripts": {
    "test": "node --test",
    "check": "find src -name '*.js' -print0 | xargs -0 -n1 node --check && node --check sw.js",
    "serve": "python3 -m http.server 4173"
  },
  "engines": {
    "node": ">=20"
  }
}
